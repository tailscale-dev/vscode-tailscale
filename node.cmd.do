exec >&2

# works for "linux" and "darwin"
OS=$(uname -s | tr A-Z a-z)
ARCH=$(uname -m)

if [ "$ARCH" = "x86_64" ]; then
    ARCH="x64"
fi
if [ "$ARCH" = "aarch64" ]; then
    ARCH="arm64"
fi

install_node() {
    TOOLCHAIN="$1"
    REV="$2"

    archive="$TOOLCHAIN-$REV.tar.gz"
    mark="$TOOLCHAIN.extracted"
    extracted=
    [ ! -e "$mark" ] || read -r extracted junk <$mark

    if [ "$extracted" = "$REV" ] && [ -e "$TOOLCHAIN/bin/node" ]; then
        echo "Node toolchain '$REV' already extracted." >&2
        return 0
    fi

    rm -f "$archive.new" "$TOOLCHAIN.extracted"
    if [ ! -e "$archive" ]; then
            URL="https://nodejs.org/dist/v${REV}/node-v${REV}-${OS}-${ARCH}.tar.gz"
            echo "Need to download node '$REV' from $URL." >&2
            curl -f -L -o "$archive.new" "$URL"
            rm -f "$archive"
            mv "$archive.new" "$archive"
    fi

    echo "Extracting node '$REV'" >&2
    echo "  into '$TOOLCHAIN'." >&2
    rm -rf "$TOOLCHAIN"
    mkdir -p "$TOOLCHAIN"
    (cd "$TOOLCHAIN" && tar --strip-components=1 -xf "$archive")
    echo "$REV" >$mark
}

redo-ifchange node.rev
read -r REV <node.rev

if [ -n "$IN_NIX_SHELL" ]; then
	NODE="$(which -a node | grep /nix/store | head -1)"
	NODE_DIR="${NODE%/bin/node}"
	NODE_NIX_VERSION="${NODE_DIR##*-}"
	if [ "$NODE_NIX_VERSION" != "$REV" ]; then
		echo "Wrong node version in Nix, got $NODE_NIX_VERSION want $REV" >&2
		exit 1
	fi
	echo "$NODE" >$3
else
	NODE_DIR="$HOME/.cache/tailscale-dev-node"
	install_node "$NODE_DIR" "$REV"
	echo "$NODE_DIR/bin/node" >$3
fi
