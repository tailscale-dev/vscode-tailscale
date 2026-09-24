package handler

import (
	"context"
	"testing"

	"github.com/tailscale-dev/vscode-tailscale/tsrelay/logger"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/types/key"
)

// newStatusHandler returns a handler whose mock LocalClient reports st.
func newStatusHandler(st *ipnstate.Status) *handler {
	return &handler{
		l:  logger.Nop,
		lc: &mockClient{p: &profile{Status: st, ServeConfig: &ipn.ServeConfig{}}},
	}
}

// onePeer returns a peer map containing a single online peer.
func onePeer() map[key.NodePublic]*ipnstate.PeerStatus {
	return map[key.NodePublic]*ipnstate.PeerStatus{
		key.NewNode().Public(): {
			ID:       "n1",
			HostName: "peer",
			DNSName:  "peer.example.ts.net.",
			Online:   true,
			UserID:   1,
		},
	}
}

func TestGetPeersNilCurrentTailnet(t *testing.T) {
	h := newStatusHandler(&ipnstate.Status{
		BackendState: "Running",
		Self:         &ipnstate.PeerStatus{Online: true, UserID: 1},
		Peer:         onePeer(),
	})
	if _, err := h.getPeers(context.Background(), nil); err == nil {
		t.Fatal("getPeers returned nil error for a running status without CurrentTailnet")
	}
}

func TestGetPeersNilCurrentTailnetLoggedOut(t *testing.T) {
	h := newStatusHandler(&ipnstate.Status{
		BackendState: "NeedsLogin",
		Self:         &ipnstate.PeerStatus{},
	})
	resp, err := h.getPeers(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Errors) != 1 || resp.Errors[0].Type != Offline {
		t.Errorf("Errors = %+v, want a single %s error", resp.Errors, Offline)
	}
	if len(resp.PeerGroups) != 0 {
		t.Errorf("PeerGroups = %+v, want none", resp.PeerGroups)
	}
}

// Self is always set by tailscaled; these cover the defensive nil checks.

func TestGetPeersNilSelf(t *testing.T) {
	h := newStatusHandler(&ipnstate.Status{
		BackendState:   "Running",
		CurrentTailnet: &ipnstate.TailnetStatus{Name: "example.com", MagicDNSSuffix: "example.ts.net"},
		Peer:           onePeer(),
	})
	resp, err := h.getPeers(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.PeerGroups) != 1 || resp.PeerGroups[0].Name != "All machines" {
		t.Errorf("PeerGroups = %+v, want the peer under %q", resp.PeerGroups, "All machines")
	}
}

func TestGetServeNilSelf(t *testing.T) {
	h := newStatusHandler(&ipnstate.Status{BackendState: "Running"})
	resp, err := h.getServe(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Self != nil {
		t.Errorf("Self = %+v, want nil", resp.Self)
	}
}

func TestServeConfigDNSNilSelf(t *testing.T) {
	h := newStatusHandler(&ipnstate.Status{BackendState: "Running"})
	if _, _, err := h.serveConfigDNS(context.Background()); err == nil {
		t.Fatal("serveConfigDNS returned nil error for a status without Self")
	}
}
