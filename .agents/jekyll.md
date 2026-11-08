# What the build publishes

Jekyll renders a file only when it opens with a `---` front matter block.
Anything else is copied byte for byte: no Liquid, no layout, no includes.

Two consequences:

- A root-level file is published unless `exclude` in `_config.yml` names it.
  That is why `README.md`, `AGENTS.md`, `CLAUDE.md` and `todo.txt` are listed
  there. `.agents/` and `_archive/` need no entry — Jekyll skips dot- and
  underscore-directories.
- A file under `assets/` that needs Liquid (`assets/templates/index.json`, each
  template's `giscus.css`) carries an empty front matter block.

`_config.yml` is read once when the dev server starts: restart it after editing
that file (`docker compose restart jekyll`).

# Core and templates

The pages are semantic `nb-*` markup with no look of their own: the core
(`_layouts/core.html`, `_includes/core/`, `assets/core/`). A template dresses
it: `assets/templates/<slug>/theme.css`, an optional `effects.js` run through
the core's `fx.js`, `giscus.css` for post comments, and decorative slot HTML in
`_includes/templates/<slug>/`. `_data/templates.yml` lists the templates, the
default is `default_template` in `_config.yml`, and the visitor switches from
the header. Copy lives in `_data/site_copy.yml`.

A slot (`{% include core/slot.html name="…" %}`) renders the template's
`<nb_page>.<slot>.html`, else `<slot>.html`, but only when `templates.yml`
declares that key for the template; otherwise it stays empty.

Core and template asset URLs carry `?v=<build time>`: a fresh page with a
cached old script breaks. A new asset reference follows the same pattern.

`tools/check/run.sh` builds the site and runs the Playwright checks over every
template, page and width; `--only`, `--templates` and `--pages` narrow it.

# Blog

Posts are `_posts/YYYY-MM-DD-<slug>.md`; `_config.yml` defaults give them the
`post` layout and the URL `/blog/<slug>` (no extension: GitHub Pages serves
`blog/<slug>.html` there). Front matter: `title`, `date`, `description` (meta
and card text), `tags`, `image`. jekyll-seo-tag turns those into canonical,
Open Graph and `BlogPosting` JSON-LD, so no SEO markup is written by hand.

Covers go in `assets/img/blog/<slug>.png`, not `blog/<slug>/`: a folder named
like the page would make GitHub Pages redirect `/blog/<slug>` to a 404.

The feed is `/blog/rss.xml` (jekyll-feed); the sitemap picks posts up on its own.

Comments are giscus over this repo's GitHub Discussions (`giscus` in
`_config.yml`). The giscus iframe loads the template's `giscus.css`
cross-origin, which needs `Access-Control-Allow-Origin`: GitHub Pages sends it,
and `_plugins/dev_cors.rb` makes the dev server send it too.

# The previous site

The Bootstrap and three.js site this replaced, as it was live until
2026-11-08 (commit `e0428f3`), is kept whole in
`_archive/2026-11-08-previous-site/`, with its own `.agents/` notes. It is
never built; to bring it back, copy its files over the root.
