package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"tailscale.com/client/tailscale"
	"tailscale.com/ipn"
)

func (h *handler) setServeCfg(ctx context.Context, sc *ipn.ServeConfig) error {
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
