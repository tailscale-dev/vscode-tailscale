package logger

import (
	"io"
	"log"
)

// Logger interface for handler routes
type Logger interface {
	Println(v ...any)
	Printf(format string, v ...any)
	VPrintf(format string, v ...any)
	VPrintln(v ...any)
}

// New returns a new logger that logs to the given out.
func New(out io.Writer, verbose bool) Logger {
	return &logger{
		verbose: verbose,
		Logger:  log.New(out, "", 0),
	}
}

type logger struct {
	verbose bool
	*log.Logger
}

func (l *logger) VPrintf(format string, v ...any) {
	if l.verbose {
		l.Printf(format, v...)
	}
}

func (l *logger) VPrintln(v ...any) {
	if l.verbose {
		l.Println(v...)
	}
}

// Nop is a logger that doesn't print to anywhere
var Nop Logger = nopLogger{}

type nopLogger struct {
}

func (nopLogger) Println(v ...any)                {}
func (nopLogger) Printf(format string, v ...any)  {}
func (nopLogger) VPrintf(format string, v ...any) {}
func (nopLogger) VPrintln(v ...any)               {}
