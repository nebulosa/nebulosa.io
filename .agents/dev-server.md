# Running the dev server

Ports start at 5000 (and 35729 for livereload) and go up to the first free one.
Compose cannot do that search itself: a published range (`"5000-5100:5000"`)
lets Docker pick a free host port, but the container still listens on its own,
and livereload needs both to match (see below). `./scripts/run.sh dev up` looks
first, then starts; it prints the port, and a stack already up keeps its own
(the search would skip that port and recreate the container on the next one).

To see the running server on a phone, `./scripts/run.sh dev tunnel` opens a
Serveo tunnel at `https://nebulosa-demo.serveousercontent.com` in the
foreground; run it in the background and stop it when the owner is done.
Livereload does not reach the phone: reload by hand.

Pass the ports on the command line; a port belongs to one machine, not to the
repo. A bare `docker compose up` binds 5000 or fails with
`Bind for 0.0.0.0:5000 failed: port is already allocated`.

javier.io and nebulosa.io both start at 5000; whichever starts second takes the
next free port. The search does not know about ports reserved but not yet bound:
tucastigo's alternate frontend needs 5010-5014, so pin a port outside that range
if the search lands there.

Two wrong ways out of a taken port:

- **Do not edit `docker-compose.yml`.** It is committed, so a port picked for
  one machine moves the server for everybody who pulls.
- **Do not stop whatever holds the port.** Other projects on this machine
  publish their own stacks, and stopping one kills unrelated work.

Each variable drives both the published port and the port Jekyll listens on, and
the two must stay equal: `--livereload` makes Jekyll inject a `<script>` aimed at
the port it believes it is serving, so a mismatch yields a site that loads
perfectly and silently stops refreshing.

Prefer detached stacks. A foreground server dies with the shell that started it,
and this Docker daemon is shared with other stacks.

`docker-compose.yml` pins `user: "${UID:-1000}:${GID:-1000}"` so files the
container writes into the repo are committable. If Jekyll dies at boot with
`EACCES` on `.jekyll-cache`, the tree holds root-owned artifacts; clear them
once from inside the container, no sudo needed:

```bash
docker compose down
docker compose run --rm --user root --no-deps --entrypoint sh jekyll \
  -c 'rm -rf /srv/jekyll/_site /srv/jekyll/.jekyll-cache'
```
