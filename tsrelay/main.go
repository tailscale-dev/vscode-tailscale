package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/exp/slices"
	"golang.org/x/sync/errgroup"
	"tailscale.com/client/tailscale"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/portlist"
	"tailscale.com/tailcfg"
)

var (
	logfile  = flag.String("logfile", "", "send logs to a file instead of stderr")
	verbose  = flag.Bool("v", false, "verbose logging")
	port     = flag.Int("port", 0, "port for http server. If 0, one will be chosen")
	nonce    = flag.String("nonce", "", "nonce for the http server")
	socket   = flag.String("socket", "", "alternative path for local api socket")
	mockFile = flag.String("mockfile", "", "a profile file to mock LocalClient responses")
)

// ErrorTypes for signaling
// invalid states to the VSCode
// extension.
const (
	// FunnelOff means the user does not have
	// funnel in their ACLs.
	FunnelOff = "FUNNEL_OFF"
	// HTTPSOff means the user has not enabled
	// https in the DNS section of the UI
	HTTPSOff = "HTTPS_OFF"
	// Offline can mean a user is not logged in
	// or is logged in but their key has expired.
	Offline = "OFFLINE"
	// RequiresSudo for when LocalBackend is run
	// with sudo but tsrelay is not
	RequiresSudo = "REQUIRES_SUDO"
	// NotRunning indicates tailscaled is
	// not running
	NotRunning = "NOT_RUNNING"
	// FlatpakRequiresRestart indicates that the flatpak
	// container needs to be fully restarted
	FlatpakRequiresRestart = "FLATPAK_REQUIRES_RESTART"
)

var requiresRestart bool

func main() {
	must(run())
}

func run() error {
	flag.Parse()
	var logOut io.Writer = os.Stderr
	if *logfile != "" {
		f, err := os.Create(*logfile)
		if err != nil {
			return fmt.Errorf("could not create log file: %w", err)
		}
		defer f.Close()
		logOut = f
	}

	lggr := &logger{
		Logger: log.New(logOut, "", 0),
	}

	flatpakID := os.Getenv("FLATPAK_ID")
	isFlatpak := os.Getenv("container") == "flatpak" && strings.HasPrefix(flatpakID, "com.visualstudio.code")
	if isFlatpak {
		lggr.Println("running inside flatpak")
		var err error
		requiresRestart, err = ensureTailscaledAccessible(lggr, flatpakID)
		if err != nil {
			return err
		}
		lggr.Printf("requires restart: %v", requiresRestart)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	return runHTTPServer(ctx, lggr, *port, *nonce)
}

func ensureTailscaledAccessible(lggr *logger, flatpakID string) (bool, error) {
	_, err := os.Stat("/run/tailscale")
	if err == nil {
		lggr.Println("tailscaled is accessible")
		return false, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return false, fmt.Errorf("error checking /run/tailscale: %w", err)
	}
	lggr.Println("running flatpak override")
	cmd := exec.Command(
		"flatpak-spawn",
		"--host",
		"flatpak",
		"override",
		"--user",
		flatpakID,
		"--filesystem=/run/tailscale",
	)
	output, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("error running flatpak override: %s - %w", output, err)
	}
	return true, nil
}

type serverDetails struct {
	Address string `json:"address,omitempty"`
	Nonce   string `json:"nonce,omitempty"`
	Port    string `json:"port,omitempty"`
}

func runHTTPServer(ctx context.Context, lggr *logger, port int, nonce string) error {
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return fmt.Errorf("error listening on port %d: %w", port, err)
	}
	u, err := url.Parse("http://" + l.Addr().String())
	if err != nil {
		return fmt.Errorf("error parsing addr %q: %w", l.Addr().String(), err)
	}
	if nonce == "" {
		nonce = getNonce()
	}
	sd := serverDetails{
		Address: fmt.Sprintf("http://127.0.0.1:%s", u.Port()),
		Port:    u.Port(),
		Nonce:   nonce,
	}
	json.NewEncoder(os.Stdout).Encode(sd)
	var lc localClient = &tailscale.LocalClient{
		Socket: *socket,
	}
	if *mockFile != "" {
		lc, err = NewMockClient(*mockFile)
		if err != nil {
			return fmt.Errorf("error creating mock client: %w", err)
		}
	}
	s := &http.Server{
		Handler: &httpHandler{
			lc:           lc,
			nonce:        nonce,
			l:            lggr,
			pids:         make(map[int]struct{}),
			prev:         make(map[uint16]portlist.Port),
			onPortUpdate: func() {},
		},
	}
	return serve(ctx, lggr, l, s, time.Second)
}

func getNonce() string {
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	var b strings.Builder
	for i := 0; i < 32; i++ {
		b.WriteByte(possible[rand.Intn(len(possible))])
	}
	return b.String()
}

type httpHandler struct {
	sync.Mutex
	nonce        string
	lc           localClient
	l            *logger
	u            websocket.Upgrader
	pids         map[int]struct{}
	prev         map[uint16]portlist.Port
	onPortUpdate func() // callback for async testing
}

// serveStatus is a subset of ipnstate.Status
// which contains only what the plugin needs
// to reduce serialization size in addition
// to some helper fields for the typescript frontend
type serveStatus struct {
	ServeConfig  *ipn.ServeConfig
	Services     map[uint16]string
	BackendState string
	Self         *peerStatus
	FunnelPorts  []int
	Errors       []Error `json:",omitempty"`
}

// RelayError is a wrapper for Error
type RelayError struct {
	statusCode int
	Errors     []Error
}

// Error implements error. It returns a
// static string as it is only needed to be
// used for programatic type assertion.
func (RelayError) Error() string {
	return "relay error"
}

// Error is a programmable error returned
// to the typescript client
type Error struct {
	Type    string `json:",omitempty"`
	Command string `json:",omitempty"`
}

type peerStatus struct {
	DNSName string
	Online  bool
}

func (h *httpHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	user, _, ok := r.BasicAuth()

	// TODO: consider locking down to vscode-webviews://* URLs by checking
	// r.Header.Get("Origin") only in production builds.
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == http.MethodOptions {
		// Handle preflight request
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if !ok {
		w.Header().Set("WWW-Authenticate", `Basic realm="restricted", charset="UTF-8"`)
	}

	if user != h.nonce {
		// TODO: return JSON for all errors
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	ctx := r.Context()
	// TODO(marwan): maybe we can use httputil.ReverseProxy
	switch r.URL.Path {
	case "/localapi/v0/status":
		st, err := h.lc.Status(ctx)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		json.NewEncoder(w).Encode(st)
	case "/localapi/v0/serve-config":
		sc, err := h.lc.GetServeConfig(ctx)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		json.NewEncoder(w).Encode(sc)
	case "/serve":
		switch r.Method {
		case http.MethodPost:
			if err := h.createServe(r.Context(), r.Body); err != nil {
				var re RelayError
				if errors.As(err, &re) {
					w.WriteHeader(re.statusCode)
					json.NewEncoder(w).Encode(re)
					return
				}
				h.l.Println("error creating serve:", err)
				http.Error(w, err.Error(), 500)
				return
			}
			w.Write([]byte(`{}`))
		case http.MethodDelete:
			if err := h.deleteServe(r.Context(), r.Body); err != nil {
				var re RelayError
				if errors.As(err, &re) {
					w.WriteHeader(re.statusCode)
					json.NewEncoder(w).Encode(re)
					return
				}
				h.l.Println("error deleting serve:", err)
				http.Error(w, err.Error(), 500)
				return
			}
			w.Write([]byte(`{}`))
		case http.MethodGet:
			if requiresRestart {
				json.NewEncoder(w).Encode(RelayError{
					Errors: []Error{{Type: FlatpakRequiresRestart}},
				})
				return
			}
			var wg sync.WaitGroup
			wg.Add(1)
			portMap := map[uint16]string{}
			go func() {
				defer wg.Done()
				p := &portlist.Poller{IncludeLocalhost: true}
				defer p.Close()
				ports, _, err := p.Poll()
				if err != nil {
					h.l.Printf("error polling for serve: %v", err)
					return
				}
				for _, p := range ports {
					portMap[p.Port] = p.Process
				}
			}()

			st, sc, err := h.getConfigs(ctx)
			if err != nil {
				var oe *net.OpError
				if errors.As(err, &oe) && oe.Op == "dial" {
					w.WriteHeader(http.StatusServiceUnavailable)
					json.NewEncoder(w).Encode(RelayError{
						Errors: []Error{{Type: NotRunning}},
					})
				} else {
					http.Error(w, err.Error(), 500)
				}
				return
			}

			s := serveStatus{
				ServeConfig:  sc,
				Services:     make(map[uint16]string),
				BackendState: st.BackendState,
				FunnelPorts:  []int{},
			}

			wg.Wait()
			if sc != nil {
				for _, webCfg := range sc.Web {
					for _, addr := range webCfg.Handlers {
						if addr.Proxy == "" {
							continue
						}
						u, err := url.Parse(addr.Proxy)
						if err != nil {
							h.l.Printf("error parsing address proxy %q: %v", addr.Proxy, err)
							continue
						}
						portInt, err := strconv.Atoi(u.Port())
						if err != nil {
							h.l.Printf("error parsing port %q of proxy %q: %v", u.Port(), addr.Proxy, err)
							continue
						}
						port := uint16(portInt)
						if process, ok := portMap[port]; ok {
							s.Services[port] = process
						}
					}
				}
			}

			if st.Self != nil {
				s.Self = &peerStatus{
					DNSName: st.Self.DNSName,
					Online:  st.Self.Online,
				}
				capabilities := st.Self.Capabilities
				if slices.Contains(capabilities, tailcfg.CapabilityWarnFunnelNoInvite) ||
					!slices.Contains(capabilities, tailcfg.NodeAttrFunnel) {
					s.Errors = append(s.Errors, Error{
						Type: FunnelOff,
					})
				}
				if slices.Contains(capabilities, tailcfg.CapabilityWarnFunnelNoHTTPS) {
					s.Errors = append(s.Errors, Error{
						Type: HTTPSOff,
					})
				}
				if !st.Self.Online || s.BackendState == "NeedsLogin" {
					s.Errors = append(s.Errors, Error{
						Type: Offline,
					})
				}
			}

			idx := slices.IndexFunc(st.Self.Capabilities, func(s string) bool {
				return strings.HasPrefix(s, "https://tailscale.com/cap/funnel-ports")
			})

			if idx >= 0 {
				u, err := url.Parse(st.Self.Capabilities[idx])
				if err != nil {
					http.Error(w, err.Error(), 500)
					return
				}

				ports := strings.Split(strings.TrimSpace(u.Query().Get("ports")), ",")

				for _, ps := range ports {
					p, err := strconv.Atoi(ps)
					if err != nil {
						http.Error(w, err.Error(), 500)
						return
					}

					s.FunnelPorts = append(s.FunnelPorts, p)
				}
			}

			json.NewEncoder(w).Encode(s)
		}
	case "/funnel":
		if r.Method != http.MethodPost {
			http.NotFound(w, r)
			return
		}
		err := h.setFunnel(r.Context(), r.Body)
		if err != nil {
			var re RelayError
			if errors.As(err, &re) {
				w.WriteHeader(re.statusCode)
				json.NewEncoder(w).Encode(re)
				return
			}
			h.l.Println("error toggling funnel:", err)
			http.Error(w, err.Error(), 500)
			return
		}
		w.Write([]byte(`{}`))
	case "/portdisco":
		h.portDiscoHandler(w, r)
	default:
		http.NotFound(w, r)
	}
}

type serveRequest struct {
	Protocol   string
	Source     string
	Port       uint16
	MountPoint string
	Funnel     bool
}

func (h *httpHandler) serveConfigDNS(ctx context.Context) (*ipn.ServeConfig, string, error) {
	st, sc, err := h.getConfigs(ctx)
	if err != nil {
		return nil, "", fmt.Errorf("error getting configs: %w", err)
	}
	if sc == nil {
		sc = &ipn.ServeConfig{}
	}
	dns := strings.TrimSuffix(st.Self.DNSName, ".")
	return sc, dns, nil
}

func (h *httpHandler) getConfigs(ctx context.Context) (*ipnstate.Status, *ipn.ServeConfig, error) {
	var (
		st *ipnstate.Status
		sc *ipn.ServeConfig
	)
	g, ctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		var err error
		sc, err = h.lc.GetServeConfig(ctx)
		if err != nil {
			return fmt.Errorf("error getting serve config: %w", err)
		}
		return nil
	})
	g.Go(func() error {
		var err error
		st, err = h.lc.StatusWithoutPeers(ctx)
		if err != nil {
			return fmt.Errorf("error getting status: %w", err)
		}
		return nil
	})

	return st, sc, g.Wait()
}
func (h *httpHandler) deleteServe(ctx context.Context, body io.Reader) error {
	var req serveRequest
	if body != nil && body != http.NoBody {
		err := json.NewDecoder(body).Decode(&req)
		if err != nil {
			return fmt.Errorf("error decoding request body: %w", err)
		}
	}

	// reset serve config if no request body
	if (req == serveRequest{}) {
		sc := &ipn.ServeConfig{}
		err := h.setServeCfg(ctx, sc)
		if err != nil {
			return fmt.Errorf("error setting serve config: %w", err)
		}
		return nil
	}

	if req.Protocol != "https" {
		return fmt.Errorf("unsupported protocol: %q", req.Protocol)
	}
	sc, dns, err := h.serveConfigDNS(ctx)
	if err != nil {
		return fmt.Errorf("error getting config: %w", err)
	}
	hostPort := ipn.HostPort(fmt.Sprintf("%s:%d", dns, req.Port))
	deleteHandler(sc, hostPort, req)
	delete(sc.AllowFunnel, hostPort)
	if len(sc.AllowFunnel) == 0 {
		sc.AllowFunnel = nil
	}
	err = h.setServeCfg(ctx, sc)
	if err != nil {
		return fmt.Errorf("error setting serve config: %w", err)
	}
	return nil
}

// createServe is the programtic equivalent of "tailscale serve --set-raw"
// it returns the config as json in case of an error.
func (h *httpHandler) createServe(ctx context.Context, body io.Reader) error {
	var req serveRequest
	err := json.NewDecoder(body).Decode(&req)
	if err != nil {
		return fmt.Errorf("error decoding request body: %w", err)
	}
	if req.Protocol != "https" {
		return fmt.Errorf("unsupported protocol: %q", req.Protocol)
	}
	sc, dns, err := h.serveConfigDNS(ctx)
	if err != nil {
		return fmt.Errorf("error getting config: %w", err)
	}
	hostPort := ipn.HostPort(fmt.Sprintf("%s:%d", dns, req.Port))
	setHandler(sc, hostPort, req)
	if req.Funnel {
		if sc.AllowFunnel == nil {
			sc.AllowFunnel = make(map[ipn.HostPort]bool)
		}
		sc.AllowFunnel[hostPort] = true
	} else {
		delete(sc.AllowFunnel, hostPort)
	}
	err = h.setServeCfg(ctx, sc)
	if err != nil {
		if tailscale.IsAccessDeniedError(err) {
			cfgJSON, err := json.Marshal(sc)
			if err != nil {
				return fmt.Errorf("error marshaling own config: %w", err)
			}
			re := RelayError{
				statusCode: http.StatusForbidden,
				Errors: []Error{{
					Type:    RequiresSudo,
					Command: fmt.Sprintf(`echo %s | sudo tailscale serve --set-raw`, cfgJSON),
				}},
			}
			return re
		}
		if err != nil {
			return fmt.Errorf("error marshaling config: %w", err)
		}
		return fmt.Errorf("error setting serve config: %w", err)
	}
	return nil
}

type setFunnelRequest struct {
	On   bool `json:"on"`
	Port int  `json:"port"`
}

func (h *httpHandler) setFunnel(ctx context.Context, body io.Reader) error {
	var req setFunnelRequest
	err := json.NewDecoder(body).Decode(&req)
	if err != nil {
		return fmt.Errorf("error decoding body: %w", err)
	}
	sc, dns, err := h.serveConfigDNS(ctx)
	if err != nil {
		return fmt.Errorf("error getting serve config: %w", err)
	}
	hp := ipn.HostPort(fmt.Sprintf("%s:%d", dns, req.Port))
	if req.On {
		if sc.AllowFunnel == nil {
			sc.AllowFunnel = make(map[ipn.HostPort]bool)
		}
		sc.AllowFunnel[hp] = true
	} else {
		delete(sc.AllowFunnel, hp)
		if len(sc.AllowFunnel) == 0 {
			sc.AllowFunnel = nil
		}
	}
	err = h.setServeCfg(ctx, sc)
	if err != nil {
		return fmt.Errorf("error setting serve config: %w", err)
	}
	return nil
}

func (h *httpHandler) setServeCfg(ctx context.Context, sc *ipn.ServeConfig) error {
	err := h.lc.SetServeConfig(ctx, sc)
	if err != nil {
		if tailscale.IsAccessDeniedError(err) {
			cfgJSON, err := json.Marshal(sc)
			if err != nil {
				return fmt.Errorf("error marshaling own config: %w", err)
			}
			re := RelayError{
				statusCode: http.StatusForbidden,
				Errors: []Error{{
					Type:    RequiresSudo,
					Command: fmt.Sprintf(`echo %s | sudo tailscale serve --set-raw`, cfgJSON),
				}},
			}
			return re
		}
		if err != nil {
			return fmt.Errorf("error marshaling config: %w", err)
		}
		return fmt.Errorf("error setting serve config: %w", err)
	}
	return nil
}

func setHandler(sc *ipn.ServeConfig, newHP ipn.HostPort, req serveRequest) {
	if sc.TCP == nil {
		sc.TCP = make(map[uint16]*ipn.TCPPortHandler)
	}
	if _, ok := sc.TCP[req.Port]; !ok {
		sc.TCP[req.Port] = &ipn.TCPPortHandler{
			HTTPS: true,
		}
	}
	if sc.Web == nil {
		sc.Web = make(map[ipn.HostPort]*ipn.WebServerConfig)
	}
	wsc, ok := sc.Web[newHP]
	if !ok {
		wsc = &ipn.WebServerConfig{}
		sc.Web[newHP] = wsc
	}
	if wsc.Handlers == nil {
		wsc.Handlers = make(map[string]*ipn.HTTPHandler)
	}
	wsc.Handlers[req.MountPoint] = &ipn.HTTPHandler{
		Proxy: req.Source,
	}
}

func deleteHandler(sc *ipn.ServeConfig, newHP ipn.HostPort, req serveRequest) {
	delete(sc.AllowFunnel, newHP)
	if sc.TCP != nil {
		delete(sc.TCP, req.Port)
	}
	if sc.Web == nil {
		return
	}
	if sc.Web[newHP] == nil {
		return
	}
	wsc, ok := sc.Web[newHP]
	if !ok {
		return
	}
	if wsc.Handlers == nil {
		return
	}
	_, ok = wsc.Handlers[req.MountPoint]
	if !ok {
		return
	}
	delete(wsc.Handlers, req.MountPoint)
	if len(wsc.Handlers) == 0 {
		delete(sc.Web, newHP)
	}
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func serve(ctx context.Context, lggr *logger, l net.Listener, s *http.Server, timeout time.Duration) error {
	serverErr := make(chan error, 1)
	go func() {
		// Capture ListenAndServe errors such as "port already in use".
		// However, when a server is gracefully shutdown, it is safe to ignore errors
		// returned from this method (given the select logic below), because
		// Shutdown causes ListenAndServe to always return http.ErrServerClosed.
		serverErr <- s.Serve(l)
	}()
	var err error
	select {
	case <-ctx.Done():
		lggr.Println("received interrupt signal")
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		err = s.Shutdown(ctx)
	case err = <-serverErr:
	}
	return err
}

type logger struct{ *log.Logger }

func (l *logger) VPrintf(format string, v ...any) {
	if *verbose {
		l.Printf(format, v...)
	}
}

func (l *logger) VPrintln(v ...any) {
	if *verbose {
		l.Println(v...)
	}
}
