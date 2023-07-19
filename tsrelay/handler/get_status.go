package handler

import (
	"encoding/json"
	"net/http"
)

func (h *handler) getStatusHandler(w http.ResponseWriter, r *http.Request) {
	st, err := h.lc.Status(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	json.NewEncoder(w).Encode(st)
}
