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
	PeerGroups     []*peerGroup
	CurrentTailnet *currentTailnet
	Errors         []Error `json:",omitempty"`
}

type currentTailnet struct {
	Name            string
	MagicDNSSuffix  string
	MagicDNSEnabled bool
}

type peerGroup struct {
	Name  string
	Peers []*peerStatus
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
		PeerGroups: []*peerGroup{
			{Name: "My nodes"},
			{Name: "All nodes"},
		},
	}

	if st.BackendState == "NeedsLogin" || (st.Self != nil && !st.Self.Online) {
		s.Errors = append(s.Errors, Error{
			Type: Offline,
		})
	}

	// CurrentTailnet can be offline when you are logged out
	if st.CurrentTailnet != nil {
		s.CurrentTailnet = &currentTailnet{
			Name:            st.CurrentTailnet.Name,
			MagicDNSSuffix:  st.CurrentTailnet.MagicDNSSuffix,
			MagicDNSEnabled: st.CurrentTailnet.MagicDNSEnabled,
		}
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

		addr := p.DNSName
		if addr == "" && len(p.TailscaleIPs) > 0 {
			addr = p.TailscaleIPs[0].String()
		}
		peer := &peerStatus{
			DNSName:      p.DNSName,
			ServerName:   serverName,
			Online:       p.Online,
			ID:           p.ID,
			HostName:     p.HostName,
			TailscaleIPs: p.TailscaleIPs,
			IsExternal:   isExternal,
			SSHEnabled:   len(p.SSH_HostKeys) > 0,
			Address:      addr,
		}
		if p.UserID == st.Self.UserID {
			s.PeerGroups[0].Peers = append(s.PeerGroups[0].Peers, peer)
		} else {
			s.PeerGroups[1].Peers = append(s.PeerGroups[1].Peers, peer)
		}
	}

	myNodes := len(s.PeerGroups[0].Peers)
	allNodes := len(s.PeerGroups[1].Peers)
	if myNodes == 0 && allNodes > 0 {
		s.PeerGroups = s.PeerGroups[1:]
	} else if allNodes == 0 && myNodes > 0 {
		s.PeerGroups = s.PeerGroups[0:1]
	} else if myNodes == 0 && allNodes == 0 {
		s.PeerGroups = nil
	}

	for _, pg := range s.PeerGroups {
		peers := pg.Peers
		sort.Slice(peers, func(i, j int) bool {
			if peers[i].Online && !peers[j].Online {
				return true
			}
			if peers[j].Online && !peers[i].Online {
				return false
			}
			return peers[i].HostName < peers[j].HostName
		})
	}

	return &s, nil
}
