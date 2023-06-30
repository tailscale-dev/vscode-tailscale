package main

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mitchellh/go-ps"
	"tailscale.com/portlist"
)

func (h *httpHandler) portDiscoHandler(w http.ResponseWriter, r *http.Request) {
	c, err := h.u.Upgrade(w, r, nil)
	if err != nil {
		h.l.Printf("error upgrading to websocket: %v", err)
		return
	}
	err = h.runPortDisco(r.Context(), c)
	if err != nil {
		h.l.Printf("error running port discovery: %v", err)
		return
	}
}

type wsMessage struct {
	Type    string `json:"type"`
	PID     int    `json:"pid"`
	Port    int    `json:"port"`
	Message string `json:"message"`
}

func (h *httpHandler) runPortDisco(ctx context.Context, c *websocket.Conn) error {
	defer c.Close()
	closeCh := make(chan struct{})
	go func() {
		defer close(closeCh)
		for {
			if ctx.Err() != nil {
				return
			}
			var msg wsMessage
			err := c.ReadJSON(&msg)
			if err != nil {
				// TOOD: handle connection closed
				if !websocket.IsUnexpectedCloseError(err) {
					h.l.VPrintf("error reading json: %v", err)
				}
				return
			}
			h.Lock()
			switch msg.Type {
			case "addPID":
				h.l.VPrintln("adding pid", msg.PID)
				h.pids[msg.PID] = struct{}{}
				h.onPortUpdate()
			case "removePID":
				h.l.VPrintln("removing pid", msg.PID)
				delete(h.pids, msg.PID)
				h.onPortUpdate()
			default:
				h.l.Printf("unrecognized websocket message: %q", msg.Type)
			}
			h.Unlock()
		}
	}()

	p := &portlist.Poller{
		IncludeLocalhost: true,
	}
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	// eagerly load already open ports to avoid spam notifications
	ports, _, err := p.Poll()
	if err != nil {
		return fmt.Errorf("error running initial poll: %w", err)
	}
	for _, p := range ports {
		if p.Proto != "tcp" {
			continue
		}
		h.l.VPrintln("pre-setting", p.Port, p.Pid, p.Process)
		h.prev[p.Port] = p
	}
	h.l.Println("initial ports are set")

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-closeCh:
			h.l.Println("portdisco reader is closed")
			return nil
		case <-ticker.C:
			ports, changed, err := p.Poll()
			if err != nil {
				h.l.Printf("error receiving portlist update: %v", err)
				continue
			}
			if !changed {
				continue
			}
			err = h.handlePortUpdates(c, ports)
			if err != nil {
				return fmt.Errorf("error handling port updates: %w", err)
			}
		}
	}
}

func (h *httpHandler) handlePortUpdates(c *websocket.Conn, up []portlist.Port) error {
	h.l.VPrintln("ports were updated")
	h.Lock()
	h.l.VPrintln("up is", len(up))
	for _, p := range up {
		if p.Proto != "tcp" {
			h.l.VPrintln("skipping", p.Port, "of", p.Proto)
			continue
		}
		if _, ok := h.prev[p.Port]; ok {
			h.l.VPrintln("skipping", p.Port, "because it already exists")
			continue
		}
		ok, err := h.matchesPID(p.Pid)
		if err != nil {
			h.l.Printf("error matching pid: %v", err)
			continue
		}
		if !ok {
			h.l.VPrintf("skipping unrelated port %d / %d", p.Port, p.Pid)
			continue
		}
		h.l.VPrintf("port %d matches pid %d", p.Port, p.Pid)
		h.prev[p.Port] = p
		err = c.WriteJSON(&wsMessage{
			Type:    "newPort",
			Port:    int(p.Port),
			Message: fmt.Sprintf("Port %d was started by %q, would you like to share it over the internet with Tailscale Funnel?", p.Port, p.Process),
		})
		if err != nil {
			h.Unlock()
			return fmt.Errorf("error notifying client: %w", err)
		}
	}
	h.Unlock()
	return nil
}

func (h *httpHandler) matchesPID(pid int) (bool, error) {
	if _, ok := h.pids[pid]; ok {
		return true, nil
	}
	proc, err := ps.FindProcess(pid)
	if err != nil {
		return false, fmt.Errorf("error finding process: %w", err)
	} else if proc == nil {
		h.l.VPrintf("proc %d could not be found", pid)
		return false, nil
	} else if proc.PPid() == 0 {
		h.l.VPrintf("proc %d has no parent", pid)
		return false, nil
	}
	return h.matchesPID(proc.PPid())
}
