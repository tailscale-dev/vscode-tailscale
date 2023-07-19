package handler

// ErrorTypes for signaling
// invalid states to the VSCode
// extension.
const (
	// FunnelOff means the user does not have
	// funnel in their ACLs.
	FunnelOff = "FUNNEL_OFF"
	// HTTPSOff means the user has not enabled
	// https in the DNS section of the UI
	HTTPSOff = "HTTPS_OFF"
	// Offline can mean a user is not logged in
	// or is logged in but their key has expired.
	Offline = "OFFLINE"
	// RequiresSudo for when LocalBackend is run
	// with sudo but tsrelay is not
	RequiresSudo = "REQUIRES_SUDO"
	// NotRunning indicates tailscaled is
	// not running
	NotRunning = "NOT_RUNNING"
	// FlatpakRequiresRestart indicates that the flatpak
	// container needs to be fully restarted
	FlatpakRequiresRestart = "FLATPAK_REQUIRES_RESTART"
)

// RelayError is a wrapper for Error
type RelayError struct {
	statusCode int
	Errors     []Error
}

// Error implements error. It returns a
// static string as it is only needed to be
// used for programatic type assertion.
func (RelayError) Error() string {
	return "relay error"
}

// Error is a programmable error returned
// to the typescript client
type Error struct {
	Type    string `json:",omitempty"`
	Command string `json:",omitempty"`
}
