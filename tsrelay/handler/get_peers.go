package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
)

// getPeersResponse is a subset of ipnstate.Status
// which contains only what the plugin needs
// to reduce serialization size in addition
// to some helper fields for the typescript frontend
type getPeersResponse struct {
	Peers          []*peerStatus
	CurrentTailnet *currentTailnet
	Errors         []Error `json:",omitempty"`
}

type currentTailnet struct {
	Name            string
	MagicDNSSuffix  string
	MagicDNSEnabled bool
}

func (h *handler) getPeersHandler(w http.ResponseWriter, r *http.Request) {
	s, err := h.getPeers(r.Context(), r.Body)
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

func (h *handler) getPeers(ctx context.Context, body io.Reader) (*getPeersResponse, error) {
	if h.requiresRestart {
		return nil, RelayError{
			statusCode: http.StatusPreconditionFailed,
			Errors:     []Error{{Type: FlatpakRequiresRestart}},
		}
	}

	st, err := h.lc.Status(ctx)
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

	s := getPeersResponse{
		CurrentTailnet: &currentTailnet{
			Name:            st.CurrentTailnet.Name,
			MagicDNSSuffix:  st.CurrentTailnet.MagicDNSSuffix,
			MagicDNSEnabled: st.CurrentTailnet.MagicDNSEnabled,
		},
		Peers: make([]*peerStatus, 0, len(st.Peer)),
	}

	for _, p := range st.Peer {
		// ShareeNode indicates this node exists in the netmap because
		// it's owned by a shared-to user and that node might connect
		// to us. These nodes are hidden by "tailscale status", but present
		// in JSON output so we should filter out.
		if p.ShareeNode {
			continue
		}

		serverName := p.HostName
		if p.DNSName != "" {
			parts := strings.SplitN(p.DNSName, ".", 2)
			if len(parts) > 0 {
				serverName = parts[0]
			}
		}

		// removes the root label/trailing period from the DNSName
		// before: "amalie.foo.ts.net.", after: "amalie.foo.ts.net"
		dnsNameNoRootLabel := strings.TrimSuffix(p.DNSName, ".")

		// if the DNSName does not end with the magic DNS suffix, it is an external peer
		isExternal := !strings.HasSuffix(dnsNameNoRootLabel, st.CurrentTailnet.MagicDNSSuffix)

		s.Peers = append(s.Peers, &peerStatus{
			DNSName:      p.DNSName,
			ServerName:   serverName,
			Online:       p.Online,
			ID:           p.ID,
			HostName:     p.HostName,
			TailscaleIPs: p.TailscaleIPs,
			IsExternal:   isExternal,
			SSHEnabled:   len(p.SSH_HostKeys) > 0,
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

	if st.BackendState == "NeedsLogin" || (st.Self != nil && !st.Self.Online) {
		s.Errors = append(s.Errors, Error{
			Type: Offline,
		})
	}

	return &s, nil
}
