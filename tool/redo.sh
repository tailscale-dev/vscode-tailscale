#!/bin/sh
set -e

REDO="$HOME/.cache/tailscale-redo"

# Inner shell to prevent namespace pollution when scripts import this.
(
	REV=redo-0.42d

	# Detect when system Python binary moves (e.g. macOS 12.3 update, which removes /usr/bin/python)
	if [ -e "$REDO/redo/whichpython" ] && [ ! -x $(cat "$REDO/redo/whichpython") ]; then
		echo "Previously cached Python location invalid; nuking redo cache..." >&2
		rm -rf -- "$REDO"
	fi

	if [ ! -d "$REDO" ]; then
		echo "Need to download redo." >&2
		git -c advice.detachedHead=false clone https://github.com/apenwarr/redo.git -b $REV "$REDO"
		(cd "$REDO" && ./do build)
	fi

	CUR_REV="$(cd $REDO; git describe --tags)"
	if [ "$REV" != "$CUR_REV" ]; then
		echo "redo version '$CUR_REV' doesn't match '$REV'; building." >&2
		(
			cd "$REDO"
			git fetch
			git -c advice.detachedHead=false checkout "$REV"
			./do build
		)
	fi
)
export PATH="$REDO/bin:$PATH"
