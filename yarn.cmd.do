exec >&2

install_yarn() {
    TOOLCHAIN="$1"
    REV="$2"

    archive="$TOOLCHAIN-$REV.tar.gz"
    mark="$TOOLCHAIN.extracted"
    extracted=
    [ ! -e "$mark" ] || read -r extracted junk <$mark

    if [ "$extracted" = "$REV" ] && [ -e "$TOOLCHAIN/bin/yarn" ]; then
        echo "yarn '$REV' already extracted." >&2
        return 0
    fi

    rm -f "$archive.new" "$TOOLCHAIN.extracted"
    if [ ! -e "$archive" ]; then
            echo "Need to download yarn '$REV'." >&2
            curl -f -L -o "$archive.new" "https://github.com/yarnpkg/yarn/releases/download/v$REV/yarn-v$REV.tar.gz"
            rm -f "$archive"
            mv "$archive.new" "$archive"
    fi

    echo "Extracting yarn '$REV'" >&2
    echo "  into '$TOOLCHAIN'." >&2
    rm -rf "$TOOLCHAIN"
    mkdir -p "$TOOLCHAIN"
    export NVM_DIR="$TOOLCHAIN"
    (cd "$TOOLCHAIN" && tar --strip-components=1 -xf "$archive")
    echo "$REV" >$mark
}

redo-ifchange yarn.rev node.cmd
read -r REV <yarn.rev

case "$REV" in
    /*)
        # Custom local toolchain, use that.
        echo "$REV/bin/yarn" >$3
    ;;
    *)
		# REV is an yarn version, install that toolchain.
		TOOLCHAIN="$HOME/.cache/tailscale-dev-yarn"
		if [ -n "$IN_NIX_SHELL" ]; then
			YARN="$(which -a yarn | grep /nix/store | head -1)"
			YARN_DIR="${YARN%/bin/yarn}"
			YARN_NIX_VERSION="${YARN_DIR##*-}"
			if [ "$YARN_NIX_VERSION" != "$REV" ]; then
				echo "Wrong yarn version in Nix, got $YARN_NIX_VERSION want $REV"
				exit 1
			fi
			rm -rf "$TOOLCHAIN"
			ln -sf "$YARN_DIR" "$TOOLCHAIN"
		else
			install_yarn "$TOOLCHAIN" "$REV"
		fi
		echo "$TOOLCHAIN/bin/yarn" >$3
    ;;
esac
