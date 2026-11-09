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
  check remote [<user@host[:port]>] [args]
                  The checks on the least loaded build node (NEBULOSA_NODES), the whole suite by default;
                  the log and the screenshots come back to tools/check/out/.
EOF
}

# The port the running dev server listens on (and publishes: the two are equal, see .agents/dev-server.md).
port() { docker compose exec -T jekyll printenv JEKYLL_PORT 2>/dev/null; }

# The build nodes (~/.claude/CLAUDE.md, heavy work): user@host[:port], space-separated. The picker, the
# thresholds and the lock follow gopana.app's node pool (scripts/run.sh.d/node_pick.py), so each sees the other's runs.
NODES=${NEBULOSA_NODES:-root@build.001.gopana.app kasm-user@build.002.gopana.app:2222}
MAX_LOAD=${NEBULOSA_NODE_MAX_LOAD:-0.8}   # load1 / nproc
MIN_MEM_MB=${NEBULOSA_NODE_MIN_MEM_MB:-2500}
STALE_S=10800                             # a lock older than this, or than the node's boot, is a dead run's
ssh_to() { local h=${1%:*} pt=22; [[ $1 == *:* ]] && pt=${1##*:}; echo "-o BatchMode=yes -o ConnectTimeout=8 -p $pt $h"; }

# Remote shell: the lock is gopana's /opt/gopana-build/.busy where that directory exists, else ~/nebulosa-check/.busy;
# a stale one is removed. LOCKED says whether a live one remains.
NODE_LOCK='L=/opt/gopana-build/.busy; [ -w /opt/gopana-build ] || L=$HOME/nebulosa-check/.busy;
  for f in /opt/gopana-build/.busy $HOME/nebulosa-check/.busy; do [ -e $f ] || continue;
    a=$(( $(date +%s) - $(stat -c %Y $f) )); if [ $a -gt '$STALE_S' ] || [ $a -gt $(ps -o etimes= -p 1) ]; then rm -f $f; fi; done
  LOCKED=; [ -e /opt/gopana-build/.busy ] || [ -e $HOME/nebulosa-check/.busy ] && LOCKED=1'

# The least loaded node under the thresholds, not locked, with rsync and docker; empty when none qualifies
# (no fallback to this machine). Every skipped node is named on stderr.
pick_node() {
  local n out best="" best_s=999 r
  for n in $NODES; do
    out=$(ssh $(ssh_to "$n") -n "$NODE_LOCK"'; command -v rsync >/dev/null && docker info >/dev/null 2>&1 || { echo unprovisioned; exit; }
      [ -n "$LOCKED" ] && { echo busy; exit; }
      echo $(cut -d" " -f1 /proc/loadavg) $(nproc) $(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo)' 2>/dev/null) \
      || { echo "node $n skipped: unreachable" >&2; continue; }
    case $out in busy|unprovisioned|"") echo "node $n skipped: ${out:-no answer}" >&2; continue ;; esac
    r=$(awk -v l="${out%% *}" -v c="$(cut -d' ' -f2 <<<"$out")" 'BEGIN{printf "%.2f", l/c}')
    if awk "BEGIN{exit !($r >= $MAX_LOAD)}"; then echo "node $n skipped: load $r per cpu" >&2; continue; fi
    if (( ${out##* } < MIN_MEM_MB )); then echo "node $n skipped: ${out##* } MB free" >&2; continue; fi
    awk "BEGIN{exit !($r < $best_s)}" && { best=$n; best_s=$r; }
  done
  echo "$best"
}

# The tree travels without git, build output or local tooling; node_modules and out stay on the node between runs.
EXCLUDES=(--exclude .git/ --exclude /_site/ --exclude /.jekyll-cache/ --exclude /tools/check/out/
  --exclude /tools/check/node_modules/ --exclude /_archive/ --exclude .claude/ --exclude .codegraph/
  --exclude .superpowers/ --exclude .playwright-mcp/)

check_remote() {
  local node="" S h pt=22 lock rc q=""
  [[ ${1:-} == *@* ]] && { node=$1; shift; }
  [[ -n $node ]] || node=$(pick_node)
  [[ -n $node ]] || { echo "check remote: no build node qualifies (above); try later, never here" >&2; exit 1; }
  h=${node%:*}; [[ $node == *:* ]] && pt=${node##*:}; S=$(ssh_to "$node")
  # Claim atomically (noclobber); the lock names this run, as gopana's do.
  lock=$(ssh $S "mkdir -p ~/nebulosa-check/tree; $NODE_LOCK"'; [ -n "$LOCKED" ] && exit 1;
    (set -C; echo "nebulosa-check from '"$(hostname)"' at $(date -u +%FT%TZ)" > $L) && echo $L' 2>/dev/null) \
    || { echo "check remote: $node is busy" >&2; exit 1; }
  trap "ssh $S 'rm -f $lock' >/dev/null 2>&1" EXIT
  echo "check remote: $node"
  rsync -az --delete "${EXCLUDES[@]}" -e "ssh -o BatchMode=yes -p $pt" ./ "$h:nebulosa-check/tree/"
  (( $# )) && q=$(printf ' %q' "$@")
  set +e
  ssh $S "cd ~/nebulosa-check/tree && docker build -q -t nebulosaio-jekyll . >/dev/null && sh tools/check/run.sh$q" \
    2>&1 | tee tools/check/out/remote.log
  rc=${PIPESTATUS[0]}
  set -e
  rsync -az -e "ssh -o BatchMode=yes -p $pt" "$h:nebulosa-check/tree/tools/check/out/shots" tools/check/out/ || true
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
