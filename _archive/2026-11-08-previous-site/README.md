Nebulosa | Cosmic Engine website
================================

https://nebulosa.io — Jekyll, built and served with Docker.

```bash
docker compose up -d --build     # http://localhost:5000
docker compose down
```

Build `_site` without the server:

```bash
docker compose run --rm jekyll bundle exec jekyll build
```

After changing the `Gemfile`, regenerate and commit `Gemfile.lock`:

```bash
docker compose run --rm jekyll bundle install
```
