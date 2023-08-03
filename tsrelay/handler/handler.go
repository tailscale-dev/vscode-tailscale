package handler

import (
	"net/http"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/tailscale-dev/vscode-tailscale/tsrelay/logger"
	"tailscale.com/portlist"
)

// NewHandler returns a new http handler for interactions between
// the typescript extension and the Go tsrelay server.
func NewHandler(lc LocalClient, nonce string, l logger.Logger, requiresRestart bool) http.Handler {
	return newHandler(&handler{
		nonce:           nonce,
		lc:              lc,
		l:               l,
		pids:            make(map[int]struct{}),
		prev:            make(map[uint16]portlist.Port),
		onPortUpdate:    func() {},
		requiresRestart: requiresRestart,
	})
}

type handler struct {
	sync.Mutex
	nonce           string
	lc              LocalClient
	l               logger.Logger
	u               websocket.Upgrader
	pids            map[int]struct{}
	prev            map[uint16]portlist.Port
	onPortUpdate    func() // callback for async testing
	requiresRestart bool
}

func newHandler(h *handler) http.Handler {
	r := chi.NewRouter()
	r.Use(h.authMiddleware)
	r.Get("/peers", h.getPeersHandler)
	r.Get("/serve", h.getServeHandler)
	r.Post("/serve", h.createServeHandler)
	r.Delete("/serve", h.deleteServeHandler)
	r.Post("/funnel", h.setFunnelHandler)
	r.Get("/portdisco", h.portDiscoHandler)
	return r
}
