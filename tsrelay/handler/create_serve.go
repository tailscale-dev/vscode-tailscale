package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"tailscale.com/client/tailscale"
	"tailscale.com/ipn"
)

type serveRequest struct {
	Protocol   string
	Source     string
	Port       uint16
	MountPoint string
	Funnel     bool
}

func (h *handler) createServeHandler(w http.ResponseWriter, r *http.Request) {
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
}

// createServe is the programtic equivalent of "tailscale serve --set-raw"
// it returns the config as json in case of an error.
func (h *handler) createServe(ctx context.Context, body io.Reader) error {
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

func (h *handler) serveConfigDNS(ctx context.Context) (*ipn.ServeConfig, string, error) {
	st, sc, err := h.getConfigs(ctx, false)
	if err != nil {
		return nil, "", fmt.Errorf("error getting configs: %w", err)
	}
	if sc == nil {
		sc = &ipn.ServeConfig{}
	}
	dns := strings.TrimSuffix(st.Self.DNSName, ".")
	return sc, dns, nil
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
