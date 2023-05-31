package main

import (
	"encoding/base64"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"tailscale.com/portlist"
)

func TestServe(t *testing.T) {
	portCh := make(chan struct{}, 1)
	srv := httptest.NewServer(&httpHandler{
		nonce:        "123",
		l:            &logger{Logger: log.New(os.Stderr, "", 0)},
		pids:         make(map[int]struct{}),
		prev:         make(map[uint16]portlist.Port),
		onPortUpdate: func() { portCh <- struct{}{} },
	})
	t.Cleanup(srv.Close)

	headers := http.Header{}
	headers.Set("Authorization", "Basic "+basicAuth("123", ""))
	wsUR := strings.Replace(srv.URL, "http://", "ws://", 1)
	conn, _, err := websocket.DefaultDialer.Dial(wsUR+"/portdisco", headers)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	err = conn.WriteJSON(&wsMessage{
		Type: "addPID",
		PID:  os.Getpid(),
	})
	if err != nil {
		t.Fatal(err)
	}
	<-portCh

	lst, err := net.Listen("tcp", "127.0.0.1:4593")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lst.Close() })
	wantPort := lst.Addr().(*net.TCPAddr).Port

	err = conn.SetReadDeadline(time.Now().Add(time.Second * 15))
	if err != nil {
		t.Fatal(err)
	}
	var msg wsMessage
	err = conn.ReadJSON(&msg)
	if err != nil {
		t.Fatal(err)
	}
	if msg.Type != "newPort" {
		t.Fatalf("expected newPort type but got %q", msg.Type)
	}
	if msg.Port != wantPort {
		t.Fatalf("expected port to be %q but got %q", wantPort, msg.Port)
	}
}

func basicAuth(username, password string) string {
	auth := username + ":" + password
	return base64.StdEncoding.EncodeToString([]byte(auth))
}
