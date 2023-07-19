package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"time"

	"github.com/tailscale-dev/vscode-tailscale/tsrelay/handler"
	"github.com/tailscale-dev/vscode-tailscale/tsrelay/logger"
	"tailscale.com/client/tailscale"
)

var (
	logfile  = flag.String("logfile", "", "send logs to a file instead of stderr")
	verbose  = flag.Bool("v", false, "verbose logging")
	port     = flag.Int("port", 0, "port for http server. If 0, one will be chosen")
	nonce    = flag.String("nonce", "", "nonce for the http server")
	socket   = flag.String("socket", "", "alternative path for local api socket")
	mockFile = flag.String("mockfile", "", "a profile file to mock LocalClient responses")
)

var requiresRestart bool

func main() {
	must(run())
}

func run() error {
	flag.Parse()
	var logOut io.Writer = os.Stderr
	if *logfile != "" {
		f, err := os.Create(*logfile)
		if err != nil {
			return fmt.Errorf("could not create log file: %w", err)
		}
		defer f.Close()
		logOut = f
	}

	lggr := logger.New(logOut, *verbose)

	flatpakID := os.Getenv("FLATPAK_ID")
	isFlatpak := os.Getenv("container") == "flatpak" && strings.HasPrefix(flatpakID, "com.visualstudio.code")
	if isFlatpak {
		lggr.Println("running inside flatpak")
		var err error
		requiresRestart, err = ensureTailscaledAccessible(lggr, flatpakID)
		if err != nil {
			return err
		}
		lggr.Printf("requires restart: %v", requiresRestart)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	return runHTTPServer(ctx, lggr, *port, *nonce)
}

func ensureTailscaledAccessible(lggr logger.Logger, flatpakID string) (bool, error) {
	_, err := os.Stat("/run/tailscale")
	if err == nil {
		lggr.Println("tailscaled is accessible")
		return false, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return false, fmt.Errorf("error checking /run/tailscale: %w", err)
	}
	lggr.Println("running flatpak override")
	cmd := exec.Command(
		"flatpak-spawn",
		"--host",
		"flatpak",
		"override",
		"--user",
		flatpakID,
		"--filesystem=/run/tailscale",
	)
	output, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("error running flatpak override: %s - %w", output, err)
	}
	return true, nil
}

type serverDetails struct {
	Address string `json:"address,omitempty"`
	Nonce   string `json:"nonce,omitempty"`
	Port    string `json:"port,omitempty"`
}

func runHTTPServer(ctx context.Context, lggr logger.Logger, port int, nonce string) error {
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return fmt.Errorf("error listening on port %d: %w", port, err)
	}
	u, err := url.Parse("http://" + l.Addr().String())
	if err != nil {
		return fmt.Errorf("error parsing addr %q: %w", l.Addr().String(), err)
	}
	if nonce == "" {
		nonce = getNonce()
	}
	sd := serverDetails{
		Address: fmt.Sprintf("http://127.0.0.1:%s", u.Port()),
		Port:    u.Port(),
		Nonce:   nonce,
	}
	json.NewEncoder(os.Stdout).Encode(sd)
	var lc handler.LocalClient = &tailscale.LocalClient{
		Socket: *socket,
	}
	if *mockFile != "" {
		lc, err = handler.NewMockClient(*mockFile)
		if err != nil {
			return fmt.Errorf("error creating mock client: %w", err)
		}
	}
	h := handler.NewHandler(lc, nonce, lggr, requiresRestart)
	s := &http.Server{Handler: h}
	return serve(ctx, lggr, l, s, time.Second)
}

func serve(ctx context.Context, lggr logger.Logger, l net.Listener, s *http.Server, timeout time.Duration) error {
	serverErr := make(chan error, 1)
	go func() {
		// Capture ListenAndServe errors such as "port already in use".
		// However, when a server is gracefully shutdown, it is safe to ignore errors
		// returned from this method (given the select logic below), because
		// Shutdown causes ListenAndServe to always return http.ErrServerClosed.
		serverErr <- s.Serve(l)
	}()
	var err error
	select {
	case <-ctx.Done():
		lggr.Println("received interrupt signal")
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		err = s.Shutdown(ctx)
	case err = <-serverErr:
	}
	return err
}

func getNonce() string {
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	var b strings.Builder
	for i := 0; i < 32; i++ {
		b.WriteByte(possible[rand.Intn(len(possible))])
	}
	return b.String()
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
