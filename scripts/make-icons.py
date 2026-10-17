"""Draw the application icon and every raster size the app and installer need.

Run it after changing GEOMETRY or the palette:

    python scripts/make-icons.py

The icon is deliberately name-neutral, because the app's name is expected to
change and an icon built out of a letter would have to change with it. It shows
what the app actually does instead: a line of type, the coloured dotted
underline this app puts under a pending suggestion, and the faint ghost line
floating above it that carries the other version of the words.

One spec drives both outputs, so the SVG and the PNGs can never drift apart:
the geometry below is in fractions of the icon's side, `write_svg` turns it into
vector shapes and `draw` turns it into pixels. Rasters are drawn at 8x and
reduced with LANCZOS, which is what keeps the 16px version from turning to mud.

Requires Pillow (installed on this machine).
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - a developer without Pillow
    sys.exit("Pillow is required: python -m pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "resources" / "icon"

PNG_SIZES = [16, 32, 48, 64, 128, 256, 512]
ICO_SIZES = [16, 32, 48, 64, 128, 256]
SUPERSAMPLE = 8

# Palette, matching the app's own tokens in src/renderer/styles/app.css.
CREAM = "#f4ecdc"      # warm cream ground
EDGE = "#e0d5bf"       # a hair darker, so the tile has an edge on white
INK = "#23201c"        # --ink, the live line of type
GHOST = "#9b948a"      # --ink-faint, the "was" ghost above the line
MARK = "#1f6f8b"       # the pending-suggestion underline

# Everything in fractions of the icon's side.
GEOMETRY = {
    "pad": 0.02,          # breathing room outside the rounded tile
    "radius": 0.215,      # corner radius of the tile
    "ghost_x0": 0.315,
    "ghost_x1": 0.700,
    "ghost_y": 0.330,
    "ghost_h": 0.055,
    "line_x0": 0.215,
    "line_x1": 0.785,
    "line_y": 0.520,
    "line_h": 0.115,
    "serif_h": 0.168,     # slight uprights, so the bar reads as set type
    "serif_w": 0.030,
    "dot_y": 0.688,
    "dot_d": 0.050,
    "dot_gap": 0.040,
    "dots": 6,
}


def dot_positions(g: dict[str, float]) -> list[float]:
    """Left edge of each underline dot, centred under the line of type."""
    pitch = g["dot_d"] + g["dot_gap"]
    span = pitch * (g["dots"] - 1) + g["dot_d"]
    first = g["line_x0"] + (g["line_x1"] - g["line_x0"] - span) / 2
    return [first + i * pitch for i in range(int(g["dots"]))]


def draw(size: int) -> Image.Image:
    """One icon, drawn oversized and reduced so every edge is anti-aliased."""
    g = GEOMETRY
    big = size * SUPERSAMPLE
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    pen = ImageDraw.Draw(image)

    def px(value: float) -> float:
        return value * big

    pad = px(g["pad"])
    pen.rounded_rectangle(
        [pad, pad, big - pad - 1, big - pad - 1],
        radius=px(g["radius"]),
        fill=CREAM,
        outline=EDGE,
        width=max(1, round(px(0.008))),
    )

    # The ghost: the other version of the words, floating above the line.
    ghost_h = px(g["ghost_h"])
    pen.rounded_rectangle(
        [px(g["ghost_x0"]), px(g["ghost_y"]), px(g["ghost_x1"]), px(g["ghost_y"]) + ghost_h],
        radius=ghost_h / 2,
        fill=GHOST,
    )

    # The live line of type, with a serif upright at each end.
    line_h = px(g["line_h"])
    line_top = px(g["line_y"])
    pen.rounded_rectangle(
        [px(g["line_x0"]), line_top, px(g["line_x1"]), line_top + line_h],
        radius=line_h / 4,
        fill=INK,
    )
    serif_h = px(g["serif_h"])
    serif_w = px(g["serif_w"])
    serif_top = line_top + (line_h - serif_h) / 2
    for x in (px(g["line_x0"]), px(g["line_x1"]) - serif_w):
        pen.rounded_rectangle(
            [x, serif_top, x + serif_w, serif_top + serif_h],
            radius=serif_w / 2,
            fill=INK,
        )

    # The pending-suggestion mark: a coloured dotted underline.
    dot_d = px(g["dot_d"])
    for x in dot_positions(g):
        left = px(x)
        pen.ellipse([left, px(g["dot_y"]), left + dot_d, px(g["dot_y"]) + dot_d], fill=MARK)

    return image.resize((size, size), Image.LANCZOS)


def write_svg(path: Path) -> None:
    """The same drawing as vector shapes, on a 0..256 canvas."""
    g = GEOMETRY
    s = 256.0

    def u(value: float) -> str:
        return f"{value * s:.2f}"

    pad = g["pad"] * s
    radius = g["dot_d"] / 2 * s
    centre_y = (g["dot_y"] + g["dot_d"] / 2) * s
    dots = "\n".join(
        '  <circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s" />'
        % ((x + g["dot_d"] / 2) * s, centre_y, radius, MARK)
        for x in dot_positions(g)
    )
    serif_top = (g["line_y"] + (g["line_h"] - g["serif_h"]) / 2) * s
    serifs = "\n".join(
        f'  <rect x="{x:.2f}" y="{serif_top:.2f}" width="{g["serif_w"] * s:.2f}" '
        f'height="{g["serif_h"] * s:.2f}" rx="{g["serif_w"] / 2 * s:.2f}" fill="{INK}" />'
        for x in (g["line_x0"] * s, g["line_x1"] * s - g["serif_w"] * s)
    )

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="A line of type with a dotted underline and a faint ghost line above it">
  <title>Manuscript review icon</title>
  <rect x="{pad:.2f}" y="{pad:.2f}" width="{s - 2 * pad:.2f}" height="{s - 2 * pad:.2f}" rx="{u(g["radius"])}" fill="{CREAM}" stroke="{EDGE}" stroke-width="2" />
  <rect x="{u(g["ghost_x0"])}" y="{u(g["ghost_y"])}" width="{(g["ghost_x1"] - g["ghost_x0"]) * s:.2f}" height="{u(g["ghost_h"])}" rx="{g["ghost_h"] / 2 * s:.2f}" fill="{GHOST}" />
  <rect x="{u(g["line_x0"])}" y="{u(g["line_y"])}" width="{(g["line_x1"] - g["line_x0"]) * s:.2f}" height="{u(g["line_h"])}" rx="{g["line_h"] / 4 * s:.2f}" fill="{INK}" />
{serifs}
{dots}
</svg>
"""
    path.write_text(svg, encoding="utf-8", newline="\n")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    write_svg(OUT / "icon.svg")

    rendered = {size: draw(size) for size in sorted(set(PNG_SIZES + ICO_SIZES))}
    for size in PNG_SIZES:
        rendered[size].save(OUT / f"icon-{size}.png")

    # electron-builder wants a single 256px icon.png as well as the .ico.
    rendered[256].save(OUT / "icon.png")
    rendered[max(ICO_SIZES)].save(
        OUT / "icon.ico",
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
    )

    made = ", ".join(str(s) for s in PNG_SIZES)
    print(f"wrote {OUT}: icon.svg, icon.png, icon-{{{made}}}.png, icon.ico")


if __name__ == "__main__":
    main()
