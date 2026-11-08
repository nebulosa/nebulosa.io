#!/usr/bin/env python3
"""Generates the slot SVGs of the polvo template (Stardust): fine stardust at three depths.

    python3 tools/polvo_dust.py _includes/templates/polvo

The mockup (.superpowers/sdd/2026-11-06-tema/r2/alts/polvo/gen_slots.py) drew its sky on a 1280 x 1800 canvas and
each cluster on a fixed viewBox. The site has no canvas: a page is as tall as its content and 360 to 1866 px wide, so
a viewBox scaled to cover the page would turn 1 px motes into 5 px blobs on a phone's article. Here the dust keeps
its pixel size everywhere:

- backdrop: the mockup's 370 motes as a <pattern> tile (1280 x 1800, userSpaceOnUse) painted over the whole page;
  the violet haze is CSS on the slot (theme.css), where it can follow the width.
- clusters (hero-art, page-head-art, insights-art, cta-art): motes placed in percentages of the slot, so the cluster
  spreads with the box while every mote stays 0.6 / 1 / 1.5 px; the glow is a gradient over the whole box.

Each slot holds two <svg>: the still sky (the two far depths, the glow) and, over it, the brightest depth alone in
its own <svg class="polvo-twinkle">. theme.css breathes that element's opacity (a compositor-only property) under
html[data-motion="full"]; animating a group inside the pattern would make other engines re-rasterize the page-size
pattern every frame. Same seeds and counts as the mockup, so the sky is the one the owner picked. Ids prefixed polvo-.
"""
import random
import sys
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "_includes/templates/polvo")
OUT.mkdir(parents=True, exist_ok=True)

RADIUS = {1: 0.6, 2: 1.0, 3: 1.5}
LAYER = {  # depth: class suffix, fill, opacity
    1: ("d1", "#c9b8ff", ".28"),
    2: ("d2", "#e6ddff", ".55"),
    3: ("d3", "#ffffff", ".9"),
}
SVG = '<svg class="%s" width="100%%" height="100%%" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'


def motes(rng, n, w, h, depth_mix=(0.55, 0.3, 0.15), cx=None, cy=None, spread=None):
    """Points at three depths; with cx/cy/spread, a gaussian cluster (points outside the box are dropped)."""
    out = {1: [], 2: [], 3: []}
    for _ in range(n):
        if cx is not None:
            x, y = rng.gauss(cx, spread), rng.gauss(cy, spread * 0.55)
            if not (0 <= x <= w and 0 <= y <= h):
                continue
        else:
            x, y = rng.uniform(0, w), rng.uniform(0, h)
        u = rng.random()
        d = 1 if u < depth_mix[0] else 2 if u < depth_mix[0] + depth_mix[1] else 3
        out[d].append((x, y, RADIUS[d] * rng.uniform(0.85, 1.25)))
    return out


def group(out, prefix, depth, fmt):
    suffix, fill, opacity = LAYER[depth]
    return f'<g class="{prefix}-{suffix}" fill="{fill}" opacity="{opacity}">' + "".join(fmt(p) for p in out[depth]) + "</g>"


def backdrop():
    rng = random.Random(7)
    w, h = 1280, 1800
    out = motes(rng, 230, w, h)
    band = motes(rng, 140, w, h, cx=760, cy=620, spread=420)  # the faint diagonal dust band
    for k in out:
        out[k] += band[k]
    px = lambda p: f'<circle cx="{p[0]:.0f}" cy="{p[1]:.0f}" r="{p[2]:.1f}"/>'
    tile = lambda pid, body: (
        f'<defs><pattern id="{pid}" patternUnits="userSpaceOnUse" width="{w}" height="{h}">' + body
        + f'</pattern></defs><rect width="100%" height="100%" fill="url(#{pid})"/></svg>'
    )
    still = SVG % "polvo-sky" + tile("polvo-dust", group(out, "polvo-bg", 1, px) + group(out, "polvo-bg", 2, px))
    bright = SVG % "polvo-twinkle polvo-sky-twinkle" + tile("polvo-dust-bright", group(out, "polvo-bg", 3, px))
    (OUT / "backdrop.html").write_text(still + bright + "\n")


def cluster(name, w, h, n, cx, cy, spread, seed, glow=True):
    rng = random.Random(seed)
    out = motes(rng, n, w, h, depth_mix=(0.45, 0.35, 0.2), cx=cx, cy=cy, spread=spread)
    pct = lambda p: f'<circle cx="{p[0] / w * 100:.2f}%" cy="{p[1] / h * 100:.2f}%" r="{p[2]:.1f}"/>'
    defs = glow_el = ""
    if glow:
        gid = f"polvo-{name}-glow"
        defs = (
            f'<defs><radialGradient id="{gid}" cx="{cx / w:.3f}" cy="{cy / h:.3f}" r=".5">'
            '<stop offset="0" stop-color="#6d4bd8" stop-opacity=".22"/>'
            '<stop offset=".5" stop-color="#4a257d" stop-opacity=".08"/>'
            '<stop offset="1" stop-color="#120d19" stop-opacity="0"/></radialGradient></defs>'
        )
        glow_el = f'<rect width="100%" height="100%" fill="url(#{gid})"/>'
    prefix = f"polvo-{name}"
    still = SVG % "polvo-cluster" + defs + glow_el + group(out, prefix, 1, pct) + group(out, prefix, 2, pct) + "</svg>"
    bright = SVG % f"polvo-twinkle {prefix}-twinkle" + group(out, prefix, 3, pct) + "</svg>"
    (OUT / f"{name}.html").write_text(still + bright + "\n")


backdrop()
cluster("hero-art", 1280, 520, 170, 640, 230, 330, 11)
cluster("cta-art", 1280, 180, 70, 640, 90, 380, 13, glow=False)
# Centred (the mockup's sat at x 420 behind "Blog"): it also backs the article's centred head and a phone's one column.
cluster("page-head-art", 1280, 260, 110, 640, 120, 360, 17)
cluster("insights-art", 1280, 420, 60, 300, 200, 260, 19, glow=False)
for f in sorted(OUT.iterdir()):
    print(f.name, f.stat().st_size // 1024, "KB")
