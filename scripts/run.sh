#!/usr/bin/env bash
# The dev server and its helpers, all through Docker: ./scripts/run.sh dev help.
# One mode, dev: the site itself is served by GitHub Pages.
set -e
cd "$(dirname "$0")/.."

usage() {
  cat <<EOF
Usage: $0 dev <subcommand> [args]

  up              Start the dev server detached on the first free port from 5000.
  down            Stop it.
  tunnel [name]   Show it on a phone: https://nebulosa-<name|demo>.serveousercontent.com, QR included.
  check <narrow>  Build the site and run some Playwright checks here: --only, --templates and/or --pages
                  (tools/check/run.sh). The whole suite is heavy and refuses to run on this machine.
  check remote [--node <user@host[:port]>] [args]
                  The checks on a build node from shared.com's pool (~/shared.com/scripts/nodes.sh), the whole
                  suite by default; the log and the screenshots come back to tools/check/out/.
EOF
}

# The port the running dev server listens on (and publishes: the two are equal, see .agents/dev-server.md).
port() { docker compose exec -T jekyll printenv JEKYLL_PORT 2>/dev/null; }

# Heavy work runs on a build node (~/.claude/CLAUDE.md). The node pool is shared.com's, the one every project uses:
# node choice, locks, droplets when the fixed nodes are busy, Ctrl-C ending the job on the node. ~/shared.com/.agents/nodes.md
POOL=${SHARED_NODES:-$HOME/shared.com/scripts/nodes.sh}
sq() { local s=$1; printf "'%s'" "${s//\'/\'\\\'\'}"; }

# The tree travels without git, build output or local tooling; node_modules and out stay on the node between runs.
EXCLUDES=(--exclude /.git --exclude /_site/ --exclude /.jekyll-cache/ --exclude /tools/check/out/
  --exclude /tools/check/node_modules/ --exclude /_archive/ --exclude .claude/ --exclude .codegraph/
  --exclude .superpowers/ --exclude .playwright-mcp/)

check_remote() {
  local claim node=() q="" a rc=130
  [[ -f $POOL ]] || { echo "check remote: no node pool at $POOL (clone shared.com there, or set SHARED_NODES)" >&2; exit 1; }
  [[ ${1:-} == --node ]] && { node=(--node "$2"); shift 2; }
  claim=$(bash "$POOL" claim --kind nebulosa:check "${node[@]}") || exit $?
  eval "$claim"   # NODE TARGET SSH_OPTS LOCK CLAIM …
  trap 'bash "$POOL" release --node "$NODE" --claim "$CLAIM" --exit "$rc"' EXIT
  # shellcheck disable=SC2086 # SSH_OPTS is a list of ssh flags
  rsync -az --delete "${EXCLUDES[@]}" -e "ssh $SSH_OPTS" ./ "$TARGET:nebulosa-check/tree/"
  for a in "$@"; do q+=" $(sq "$a")"; done
  set +e
  bash "$POOL" run --node "$NODE" --claim "$CLAIM" --lock "$LOCK" -- \
    "cd ~/nebulosa-check/tree && docker build -q -t nebulosaio-jekyll . >/dev/null && sh tools/check/run.sh$q" \
    2>&1 | tee tools/check/out/remote.log
  rc=${PIPESTATUS[0]}
  set -e
  # shellcheck disable=SC2086
  rsync -az -e "ssh $SSH_OPTS" "$TARGET:nebulosa-check/tree/tools/check/out/shots" tools/check/out/ \
    || echo "check remote: the screenshots did not come back (above)" >&2
  exit "$rc"
}

free() { p=$1; while (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null; do p=$((p+1)); done; echo $p; }

case ${1:-} in
  d|de|dev) shift ;;
  *) usage >&2; exit 1 ;;
esac
cmd=${1:-help}; [ $# -gt 0 ] && shift

case $cmd in
  up)
    if p=$(port); then echo "already up: http://localhost:$p"; exit 0; fi
    p=$(free 5000); lr=$(free 35729)
    JEKYLL_PORT=$p JEKYLL_LIVERELOAD_PORT=$lr docker compose up -d --build
    echo "http://localhost:$p" ;;
  down)
    docker compose down ;;
  tunnel)
    # Serveo over ssh, nothing to install; the fixed subdomain needs this machine's ssh key registered once
    # (Serveo prints the link the first time). Runs in the foreground: Ctrl-C closes it.
    p=$(port) || { echo "the dev server is not up: $0 dev up" >&2; exit 1; }
    url="https://nebulosa-${1:-demo}.serveousercontent.com"
    echo "$url -> localhost:$p"
    docker run --rm alpine sh -c "apk add --no-cache libqrencode-tools >/dev/null && qrencode -t ANSIUTF8 '$url'"
    exec ssh -o ServerAliveInterval=60 -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new \
      -R "nebulosa-${1:-demo}:80:127.0.0.1:$p" serveo.net ;;
  check)
    [[ ${1:-} == remote ]] && { shift; mkdir -p tools/check/out; check_remote "$@"; }
    # Only a narrowed run is light enough for this machine.
    [[ " $* " =~ \ --(only|templates|pages)\  ]] \
      || { echo "the whole suite is heavy: $0 dev check remote, or narrow it (--only, --templates, --pages)" >&2; exit 1; }
    exec sh tools/check/run.sh "$@" ;;
  *)
    usage ;;
esac
