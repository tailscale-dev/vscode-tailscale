package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/exp/slices"
	"tailscale.com/ipn"
	"tailscale.com/portlist"
	"tailscale.com/tailcfg"
)

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

type peerStatus struct {
	DNSName string
	Online  bool

	// For node explorer
	ID           tailcfg.StableNodeID
	ServerName   string
	HostName     string
	TailscaleIPs []netip.Addr
	IsExternal   bool
	SSHEnabled   bool
}

func (h *handler) getServeHandler(w http.ResponseWriter, r *http.Request) {
	s, err := h.getServe(r.Context(), r.Body)
	if err != nil {
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

	json.NewEncoder(w).Encode(s)
}

func (h *handler) getServe(ctx context.Context, body io.Reader) (*serveStatus, error) {
	if h.requiresRestart {
		return nil, RelayError{
			statusCode: http.StatusPreconditionFailed,
			Errors:     []Error{{Type: FlatpakRequiresRestart}},
		}
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
			return nil, RelayError{
				statusCode: http.StatusServiceUnavailable,
				Errors:     []Error{{Type: NotRunning}},
			}
		}
		return nil, err
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
			DNSName:      st.Self.DNSName,
			Online:       st.Self.Online,
			ID:           st.Self.ID,
			HostName:     st.Self.HostName,
			TailscaleIPs: st.Self.TailscaleIPs,
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
			return nil, err
		}

		ports := strings.Split(strings.TrimSpace(u.Query().Get("ports")), ",")

		for _, ps := range ports {
			p, err := strconv.Atoi(ps)
			if err != nil {
				return nil, err
			}

			s.FunnelPorts = append(s.FunnelPorts, p)
		}
	}

	return &s, nil
}
