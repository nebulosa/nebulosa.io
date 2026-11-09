Nebulosa | Cosmic Engine website
================================

https://nebulosa.io — Jekyll, built and served with Docker.

```bash
./scripts/run.sh dev up        # prints http://localhost:<port>
./scripts/run.sh dev tunnel    # the same server on a phone, QR included
./scripts/run.sh dev check remote    # the Playwright checks, on a build node
./scripts/run.sh dev down
```

Build `_site` without the server:

```bash
docker compose run --rm jekyll bundle exec jekyll build
```

After changing the `Gemfile`, regenerate and commit `Gemfile.lock`:

```bash
docker compose run --rm jekyll bundle install
```
