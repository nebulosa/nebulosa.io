# What the build publishes

Jekyll renders a file only when it opens with a `---` front matter block.
Anything else is copied byte for byte: no Liquid, no layout, no includes.

Two consequences:

- A root-level file is published unless `exclude` in `_config.yml` names it.
  That is why `README.md`, `AGENTS.md`, `CLAUDE.md` and `todo.txt` are listed
  there. `.agents/` needs no entry — Jekyll skips dot-directories.
- The PDFs, icons and `assets/` are published as-is, which is what they need.

# How a page is put together

`_layouts/default.html` owns everything the pages share: `<head>`, menu, footer
and scripts. A page holds only its own sections, plus front matter for what
differs between pages:

- `nav` — which menu item is marked current (`home`, `services`, `process`,
  `about`, `contact`).
- `body_style` — inline style on `<body>` (each page has its background color).
- `fix_css` — the per-page stylesheet in `assets/css/fixes/<name>.fix.css`.

Asset paths are relative (`assets/...`), which only works while every page
lives at the root. A page in a subdirectory needs `{{ '/assets/...' | relative_url }}`.

# Styles and scripts

The only front-end library is three.js, vendored in `assets/js/vendor/` and
loaded only by pages with a header scene (below). `assets/css/bootstrap-subset.min.css` holds
only the Bootstrap 4.5 rules the pages used when it was cut, so **a Bootstrap
class added to the HTML silently does nothing** unless its rule is in that file.
Regenerate it from the full `bootstrap.min.css` 4.5.0 (git history) with
PurgeCSS over the built `_site/*.html` plus `assets/js/main.js`, safelisting
`show collapse collapsing collapsed active` — classes only JS adds.

`assets/js/main.js` is plain JS: the mobile menu toggle (it reproduces
Bootstrap's `collapse` class cycle, so `data-toggle="collapse"` still works) and
the header shrink on scroll.

# Fonts

Montserrat (variable, every weight) and Cocogoose are self-hosted and declared
in `assets/css/fonts.css`, preloaded from `_includes/head.html`. The
`… Fallback` faces there are local Arial resized to each font's metrics so the
text does not jump when the real font arrives. **Changing a font, a weight in
use, or the hero copy means re-measuring them**: ratio of the copy's width in
the real font vs Arial at `font-size: 1000px`. At normal sizes Linux Chrome
rounds glyph advances to whole pixels and the ratio comes out wrong.

# Header scenes

Services, Process and About draw their header illustration in three.js. A page
opts in with `scene: <name>` in front matter; the layout then adds
`_includes/scene-head.html` (styles, import map, fallback timer) and loads
`assets/js/scenes/<name>.js`. Pages without `scene:` download none of it.

- The page keeps an `<img data-scene>` pointing at `assets/img/illustrations/<name>.svg`.
  That img holds the layout box, so the page's existing CSS positions it; the
  canvas is laid over it. It is also the fallback: shown when WebGL fails or the
  scene is not ready after 6 s. **Every illustration SVG uses the 1501:786 aspect
  ratio** (`viewBox="… 1200 628.38"`): a different ratio changes the img height,
  which shifts the hero and, on mobile, everything below it.
- The three pages share one hero structure (title in `col-lg-7`, the img in
  `.hero-img.hero-screen-img`, the "scroll" marker) and one set of hero rules in
  `assets/css/scene-hero.css`. Those rules used to be copied into each page's
  `fixes/*.fix.css` and drifted, which put About's title higher than the rest:
  change the hero there, not per page.
- `assets/js/space-scene.js` owns everything shared: renderer, overlay, lights
  (the 3D symbol handoff's rig), stars, comet, drag with momentum, parallax,
  pausing off-screen and `prefers-reduced-motion`. A scene file only builds its
  objects: `mountScene((THREE, kit) => ({ spin, tick, cameraZ }))`.
- Under `prefers-reduced-motion` nothing moves on its own, but dragging still
  works: the preference is about motion the page starts, not motion the visitor
  causes. Windows with "Animation effects" off reports that preference, so a
  static scene there is expected, not a bug.
- About renders the brand mark with `buildSymbol()` from
  `assets/js/nebulosa-symbol.js`, copied **unchanged** from the 3D symbol design
  handoff. Its geometry and material values are the design decision; scale it
  in the scene, never edit the module. About also sets `stars: false`: any star
  field or glow of its own reads as a patch of different background.
- three.js is pinned to 0.184.0 (the handoff's version). Upgrading means
  replacing both files in `assets/js/vendor/three-<version>/` and the import map.

# About illustrations

`assets/img/illustrations/about-*.svg` are generated, not hand-edited:
`python3 tools/about_illustrations.py assets/img/illustrations`. The script
projects simple 3D shapes isometrically with colours sampled from the Services
images (`assets/img/ot*.png`), so both pages read as one set. Edit a scene
function there and regenerate.
