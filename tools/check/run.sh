#!/bin/sh
# Builds the site for production and checks it headless, all in Docker:
#   sh tools/check/run.sh [--only <check>[,<check>]] [--templates <slug>[,<slug>]] [--pages <name>[,<name>]]
# Output: out/site (the build), out/shots/<template>-<page>-<width>.png. Exit 1 on any FAIL.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PW=mcr.microsoft.com/playwright:v1.55.0-noble
U="$(id -u):$(id -g)"

rm -rf "$HERE/out/site" "$HERE/out/shots"
mkdir -p "$HERE/out/shots"
# --disable-disk-cache: the dev server container shares the repo's .jekyll-cache.
docker run --rm -u "$U" -e HOME=/tmp -e JEKYLL_ENV=production -v "$ROOT":/srv/jekyll -w /srv/jekyll \
  nebulosaio-jekyll bundle exec jekyll build --quiet --disable-disk-cache \
  --config _config.yml,tools/check/config.yml -d tools/check/out/site

if [ ! -d "$HERE/node_modules/playwright" ]; then
  docker run --rm -u "$U" -e HOME=/tmp -v "$HERE":/check -w /check $PW npm ci --no-audit --no-fund
fi

docker run --rm --ipc=host -u "$U" -e HOME=/tmp -v "$HERE":/check -w /check $PW node check.js "$@"
