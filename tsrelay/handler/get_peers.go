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

	"tailscale.com/ipn/ipnstate"
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

	s := getPeersResponse{PeerGroups: []*peerGroup{}}
	peerGroups := [...]*peerGroup{
		{Name: "Managed by you"},
		{Name: "All machines"},
		{Name: "Offline machines"},
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

	appendPeer(st.Self, peerGroups[:], st)

	for _, p := range st.Peer {
		appendPeer(p, peerGroups[:], st)
	}

	for _, pg := range peerGroups {
		if len(pg.Peers) > 0 {
			s.PeerGroups = append(s.PeerGroups, pg)
		}
	}

	for _, pg := range s.PeerGroups {
		peers := pg.Peers
		sort.Slice(peers, func(i, j int) bool {
			// the comparison function always returns the current node (st.Self)
			// to be the smallest one, so return true (self < anything) if self
			// is on LHS, and false (anything !< self) if self is on RHS
			if peers[i].ID == st.Self.ID {
				return true
			}
			if peers[j].ID == st.Self.ID {
				return false
			}
			return peers[i].ServerName < peers[j].ServerName
		})
	}

	return &s, nil
}

func appendPeer(p *ipnstate.PeerStatus, peerGroups []*peerGroup, st *ipnstate.Status) {
	// ShareeNode indicates this node exists in the netmap because
	// it's owned by a shared-to user and that node might connect
	// to us. These nodes are hidden by "tailscale status", but present
	// in JSON output so we should filter out.
	if p.ShareeNode {
		return
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

	addr := dnsNameNoRootLabel
	if addr == "" && len(p.TailscaleIPs) > 0 {
		addr = p.TailscaleIPs[0].String()
	}
	peer := &peerStatus{
		DNSName:      dnsNameNoRootLabel,
		ServerName:   serverName,
		Online:       p.Online,
		ID:           p.ID,
		HostName:     p.HostName,
		TailscaleIPs: p.TailscaleIPs,
		IsExternal:   isExternal,
		SSHEnabled:   len(p.SSH_HostKeys) > 0,
		Address:      addr,
	}

	if !p.Online {
		peerGroups[2].Peers = append(peerGroups[2].Peers, peer)
	} else if p.UserID == st.Self.UserID {
		peerGroups[0].Peers = append(peerGroups[0].Peers, peer)
	} else {
		peerGroups[1].Peers = append(peerGroups[1].Peers, peer)
	}
}
