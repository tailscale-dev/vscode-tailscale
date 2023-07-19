package handler

import (
	"context"
	"fmt"

	"golang.org/x/sync/errgroup"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
)

func (h *handler) getConfigs(ctx context.Context) (*ipnstate.Status, *ipn.ServeConfig, error) {
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
