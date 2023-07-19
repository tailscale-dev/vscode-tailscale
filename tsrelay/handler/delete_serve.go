package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"tailscale.com/ipn"
)

func (h *handler) deleteServeHandler(w http.ResponseWriter, r *http.Request) {
	if err := h.deleteServe(r.Context(), r.Body); err != nil {
		var re RelayError
		if errors.As(err, &re) {
			w.WriteHeader(re.statusCode)
			json.NewEncoder(w).Encode(re)
			return
		}
		h.l.Println("error deleting serve:", err)
		http.Error(w, err.Error(), 500)
		return
	}
	w.Write([]byte(`{}`))
}

func (h *handler) deleteServe(ctx context.Context, body io.Reader) error {
	var req serveRequest
	if body != nil && body != http.NoBody {
		err := json.NewDecoder(body).Decode(&req)
		if err != nil {
			return fmt.Errorf("error decoding request body: %w", err)
		}
	}

	// reset serve config if no request body
	if (req == serveRequest{}) {
		sc := &ipn.ServeConfig{}
		err := h.setServeCfg(ctx, sc)
		if err != nil {
			return fmt.Errorf("error setting serve config: %w", err)
		}
		return nil
	}

	if req.Protocol != "https" {
		return fmt.Errorf("unsupported protocol: %q", req.Protocol)
	}
	sc, dns, err := h.serveConfigDNS(ctx)
	if err != nil {
		return fmt.Errorf("error getting config: %w", err)
	}
	hostPort := ipn.HostPort(fmt.Sprintf("%s:%d", dns, req.Port))
	deleteFromConfig(sc, hostPort, req)
	delete(sc.AllowFunnel, hostPort)
	if len(sc.AllowFunnel) == 0 {
		sc.AllowFunnel = nil
	}
	err = h.setServeCfg(ctx, sc)
	if err != nil {
		return fmt.Errorf("error setting serve config: %w", err)
	}
	return nil
}

func deleteFromConfig(sc *ipn.ServeConfig, newHP ipn.HostPort, req serveRequest) {
	delete(sc.AllowFunnel, newHP)
	if sc.TCP != nil {
		delete(sc.TCP, req.Port)
	}
	if sc.Web == nil {
		return
	}
	if sc.Web[newHP] == nil {
		return
	}
	wsc, ok := sc.Web[newHP]
	if !ok {
		return
	}
	if wsc.Handlers == nil {
		return
	}
	_, ok = wsc.Handlers[req.MountPoint]
	if !ok {
		return
	}
	delete(wsc.Handlers, req.MountPoint)
	if len(wsc.Handlers) == 0 {
		delete(sc.Web, newHP)
	}
}
