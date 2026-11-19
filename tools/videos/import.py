#!/usr/bin/env python3
"""Brings approved films from ~/social.nebulosa.io into the site.

Usage: python3 tools/videos/import.py <slug>... [--social DIR] [--date YYYY-MM-DD] [--title "..."]

For each slug: copies videos/horizontales/<slug>.mp4 and its vertical (videos/verticales/ or, once posted,
videos/published/) to assets/videos/<slug>/{horizontal,vertical}.mp4, grabs a poster frame of each format
(poster.jpg 1280x720, poster-vertical.jpg 720x1280, at 40 % of the film: the end card is the same logo on every
film), and writes _videos/<slug>.md. A card that already exists keeps what a person wrote (title, date, caption,
tags, posted, image, description); only the measured fields (seconds, sizes) are rewritten.
"""
import argparse
import json
import pathlib
import re
import shutil
import subprocess
import sys

SITE = pathlib.Path(__file__).resolve().parents[2]
MEASURED = ("seconds", "size_horizontal", "size_vertical")


def probe_seconds(mp4):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp4)],
                         check=True, capture_output=True, text=True).stdout
    return round(float(out))


def poster(mp4, dest, width):
    at = probe_seconds(mp4) * 0.4
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{at:.2f}", "-i", str(mp4), "-frames:v", "1",
                    "-vf", f"scale={width}:-2", "-q:v", "4", str(dest)], check=True)


def read_card(path):
    """The front matter as ordered (key, raw value) pairs; values stay as written (YAML scalars, lists, maps)."""
    if not path.exists():
        return []
    m = re.match(r"---\n(.*?)\n---\n", path.read_text(), re.S)
    if not m:
        sys.exit(f"{path}: no front matter")
    pairs, key = [], None
    for line in m.group(1).split("\n"):
        if re.match(r"^[a-z_]+:", line):
            key, _, val = line.partition(":")
            pairs.append([key, val.strip()])
        elif key:
            pairs[-1][1] += "\n" + line
    return pairs


def write_card(path, pairs):
    body = "\n".join(f"{k}: {v}" if "\n" not in v else f"{k}:{v if v.startswith(chr(10)) else ' ' + v}" for k, v in pairs)
    path.write_text(f"---\n{body}\n---\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("slugs", nargs="+")
    ap.add_argument("--social", default=str(pathlib.Path.home() / "social.nebulosa.io"))
    ap.add_argument("--date", help="publication date for new cards (newest first on the page)")
    ap.add_argument("--title", help="title for a new card (one slug only)")
    a = ap.parse_args()
    vids = pathlib.Path(a.social) / "videos"
    for slug in a.slugs:
        h = vids / "horizontales" / f"{slug}.mp4"
        v = next((p for p in (vids / "verticales" / f"{slug}.mp4", vids / "published" / f"{slug}.mp4") if p.exists()), None)
        if not h.exists() or v is None:
            sys.exit(f"{slug}: needs {h} and its vertical in verticales/ or published/")
        out = SITE / "assets" / "videos" / slug
        out.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(h, out / "horizontal.mp4")
        shutil.copyfile(v, out / "vertical.mp4")
        poster(h, out / "poster.jpg", 1280)
        poster(v, out / "poster-vertical.jpg", 720)

        card = SITE / "_videos" / f"{slug}.md"
        card.parent.mkdir(exist_ok=True)
        pairs = read_card(card)
        have = {k for k, _ in pairs}
        if "title" not in have:
            pairs.append(["title", json.dumps(a.title or slug.replace("-", " ").capitalize())])
        if "date" not in have:
            if not a.date:
                sys.exit(f"{slug}: a new card needs --date")
            pairs.append(["date", a.date])
        for k in ("caption", "tags"):
            if k not in have:
                pairs.append([k, '""' if k == "caption" else "[]"])
        if "image" not in have:  # the link-preview card; a person adds description: "<caption>" with the caption
            pairs.append(["image", f"/assets/videos/{slug}/poster.jpg"])
        measured = {"seconds": str(probe_seconds(h)), "size_horizontal": str((out / "horizontal.mp4").stat().st_size),
                    "size_vertical": str((out / "vertical.mp4").stat().st_size)}
        pairs = [p for p in pairs if p[0] not in MEASURED] + [[k, measured[k]] for k in MEASURED]
        write_card(card, pairs)
        print(f"{slug}: {measured['seconds']} s, {int(measured['size_horizontal']) >> 20} + {int(measured['size_vertical']) >> 20} MB")


if __name__ == "__main__":
    main()
