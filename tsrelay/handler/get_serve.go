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
	"sort"
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
	Self         *selfStatus
	Peers        []*peerStatus
	FunnelPorts  []int
	Errors       []Error `json:",omitempty"`
}

type currentTailnet struct {
	Name            string
	MagicDNSSuffix  string
	MagicDNSEnabled bool
}

type selfStatus struct {
	peerStatus
	CurrentTailnet currentTailnet
}

type peerStatus struct {
	DNSName    string
	Online     bool
	ServerName string

	// For node explorer
	ID           tailcfg.StableNodeID
	HostName     string
	TailscaleIPs []netip.Addr
	TailnetName  string
	IsExternal   bool
}

// TODO(marwan): since this endpoint serves both the Node Explorer and Funnel,
// we should either:
// 1. Pass a "with-config" option and change endpoint to be a generic /status. Or,
// 2. Make a new endpoint if the logic ends up being overly complex for one endpoint.
func (h *handler) getServeHandler(w http.ResponseWriter, r *http.Request) {
	s, err := h.getServe(r.Context(), r.Body, r.FormValue("with-peers") == "1")
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

func (h *handler) getServe(ctx context.Context, body io.Reader, withPeers bool) (*serveStatus, error) {
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

	st, sc, err := h.getConfigs(ctx, withPeers)
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
		Peers:        make([]*peerStatus, 0, len(st.Peer)),
	}

	for _, p := range st.Peer {
		// ShareeNode indicates this node exists in the netmap because
		// it's owned by a shared-to user and that node might connect
		// to us. These nodes are hidden by "tailscale status", but present
		// in JSON output so we should filter out.
		if p.ShareeNode {
			continue
		}

		ServerName := p.HostName
		if p.DNSName != "" {
			parts := strings.SplitN(p.DNSName, ".", 2)
			if len(parts) > 0 {
				ServerName = parts[0]
			}
		}

		// removes the root label/trailing period from the DNSName
		// before: "amalie.foo.ts.net.", after: "amalie.foo.ts.net"
		dnsNameNoRootLabel := strings.TrimSuffix(p.DNSName, ".")

		// if the DNSName does not end with the magic DNS suffix, it is an external peer
		isExternal := !strings.HasSuffix(dnsNameNoRootLabel, st.CurrentTailnet.MagicDNSSuffix)

		s.Peers = append(s.Peers, &peerStatus{
			DNSName:      p.DNSName,
			ServerName:   ServerName,
			Online:       p.Online,
			ID:           p.ID,
			HostName:     p.HostName,
			TailscaleIPs: p.TailscaleIPs,
			IsExternal:   isExternal,
		})
	}

	sort.Slice(s.Peers, func(i, j int) bool {
		if s.Peers[i].Online && !s.Peers[j].Online {
			return true
		}
		if s.Peers[j].Online && !s.Peers[i].Online {
			return false
		}
		return s.Peers[i].HostName < s.Peers[j].HostName
	})

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
		s.Self = &selfStatus{
			peerStatus: peerStatus{
				DNSName:      st.Self.DNSName,
				Online:       st.Self.Online,
				ID:           st.Self.ID,
				HostName:     st.Self.HostName,
				TailscaleIPs: st.Self.TailscaleIPs,
			},
			CurrentTailnet: currentTailnet{
				Name:            st.CurrentTailnet.Name,
				MagicDNSSuffix:  st.CurrentTailnet.MagicDNSSuffix,
				MagicDNSEnabled: st.CurrentTailnet.MagicDNSEnabled,
			},
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
