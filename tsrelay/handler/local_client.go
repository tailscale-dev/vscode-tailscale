package handler

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"sync"

	"tailscale.com/client/tailscale"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
)

// static check for local client interface implementation
var _ LocalClient = (*tailscale.LocalClient)(nil)

// LocalClient is an abstraction of tailscale.LocalClient
type LocalClient interface {
	Status(ctx context.Context) (*ipnstate.Status, error)
	GetServeConfig(ctx context.Context) (*ipn.ServeConfig, error)
	StatusWithoutPeers(ctx context.Context) (*ipnstate.Status, error)
	SetServeConfig(ctx context.Context, config *ipn.ServeConfig) error
}

type profile struct {
	Status           *ipnstate.Status
	ServeConfig      *ipn.ServeConfig
	MockOffline      bool
	MockAccessDenied bool
}

// NewMockClient returns a mock localClient
// based on the given json file. The format of the file
// is described in the profile struct. Note that SET
// operations update the given input in memory.
func NewMockClient(file string) (LocalClient, error) {
	bts, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	var p profile
	return &mockClient{p: &p}, json.Unmarshal(bts, &p)
}

type mockClient struct {
	sync.Mutex
	p *profile
}

// GetServeConfig implements localClient.
func (m *mockClient) GetServeConfig(ctx context.Context) (*ipn.ServeConfig, error) {
	if m.p.MockOffline {
		return nil, &net.OpError{Op: "dial"}
	}
	return m.p.ServeConfig, nil
}

// SetServeConfig implements localClient.
func (m *mockClient) SetServeConfig(ctx context.Context, config *ipn.ServeConfig) error {
	if m.p.MockAccessDenied {
		return &tailscale.AccessDeniedError{}
	}
	m.Lock()
	defer m.Unlock()
	m.p.ServeConfig = config
	return nil
}

// Status implements localClient.
func (m *mockClient) Status(ctx context.Context) (*ipnstate.Status, error) {
	if m.p.MockOffline || m.p.Status == nil {
		return nil, &net.OpError{Op: "dial"}
	}
	return m.p.Status, nil
}

// StatusWithoutPeers implements localClient.
func (m *mockClient) StatusWithoutPeers(ctx context.Context) (*ipnstate.Status, error) {
	if m.p.MockOffline || m.p.Status == nil {
		return nil, &net.OpError{Op: "dial"}
	}
	copy := *(m.p.Status)
	copy.Peer = nil
	return &copy, nil
}
