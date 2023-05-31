#!/bin/sh
set -e

. "$(dirname "$0")"/tool/redo.sh

# There is a huge amount of parallelism in most of the commands we
# run, so being conservative with the number of concurrent jobs
# minimizes run time.
case $(uname -s) in
	Darwin)
		THREADS=$(sysctl -n hw.logicalcpu_max)
		;;
	Linux)
		THREADS=$(getconf _NPROCESSORS_ONLN)
		;;
	*)
		THREADS=1
		;;
esac
JOBS=${JOBS:-0}
if [ $JOBS = 0 ]; then
	JOBS=$((1 + ($THREADS/4)))
fi

exec "$REDO/bin/redo" -j$JOBS "$@"
