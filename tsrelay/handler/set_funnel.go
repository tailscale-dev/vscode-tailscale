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

func (h *handler) setFunnelHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	err := h.setFunnel(r.Context(), r.Body)
	if err != nil {
		var re RelayError
		if errors.As(err, &re) {
			w.WriteHeader(re.statusCode)
			json.NewEncoder(w).Encode(re)
			return
		}
		h.l.Println("error toggling funnel:", err)
		http.Error(w, err.Error(), 500)
		return
	}
	w.Write([]byte(`{}`))
}

type setFunnelRequest struct {
	On   bool `json:"on"`
	Port int  `json:"port"`
}

func (h *handler) setFunnel(ctx context.Context, body io.Reader) error {
	var req setFunnelRequest
	err := json.NewDecoder(body).Decode(&req)
	if err != nil {
		return fmt.Errorf("error decoding body: %w", err)
	}
	sc, dns, err := h.serveConfigDNS(ctx)
	if err != nil {
		return fmt.Errorf("error getting serve config: %w", err)
	}
	hp := ipn.HostPort(fmt.Sprintf("%s:%d", dns, req.Port))
	if req.On {
		if sc.AllowFunnel == nil {
			sc.AllowFunnel = make(map[ipn.HostPort]bool)
		}
		sc.AllowFunnel[hp] = true
	} else {
		delete(sc.AllowFunnel, hp)
		if len(sc.AllowFunnel) == 0 {
			sc.AllowFunnel = nil
		}
	}
	err = h.setServeCfg(ctx, sc)
	if err != nil {
		return fmt.Errorf("error setting serve config: %w", err)
	}
	return nil
}
