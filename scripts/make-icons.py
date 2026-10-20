"""Draw the application icon and every file made from it.

    python scripts/make-icons.py           writes resources/icon/
    python scripts/make-icons.py --sheet   writes a contact sheet to dist/icon-preview/, and nothing else

Run it with plain `python`, not `python -I`: Pillow is usually installed in the
user's own site-packages, which -I leaves out.

The icon is "Seam" in turquoise, the author's choice of 2026-10-14 (PLAN 11.3 (o)
and Appendix D 2; what this script settled is in PLAN C.92). A pebble with a
turquoise rim and a dark body holds what the app puts on a page: a cream line
of type, a row of dots under it for the mark under a suggestion, and, from
48 px, the faint ghost line above it that carries the other version of the
words. It has no letter in it, so a rename leaves it as it is. The ember
palette Seam was first drawn in is the alternative the author may return to;
its colours are in PLAN 11.3 (o), and only the palette below would change.

One spec drives every output, in fractions of the icon's side:

- At 40 px and below the small spec applies: no ghost, a taller line and three
  larger dots, which stay apart at 16 px where five would run together.
- The line, the ghost and the dots have their edges on whole pixels of the
  size being drawn, so they stay sharp rather than smeared across two rows.
  Every part is centred on one axis, so the dots sit square under the line;
  when that is not possible on whole pixels at the icon's centre, the axis is
  half a pixel to the right of it.
- The pebble is a superellipse with a domed top and a flatter base, tilted 5
  degrees. Its body is the same shape with each semi-axis shortened by the
  rim's width, which is never less than 1.25 px so the rim survives at 16 px.
- Both gradients run down the whole canvas, top to bottom, not down the shape.
- Rasters are drawn at 8x (4x at 1024 px, to keep the canvas within 4096 px)
  and reduced with LANCZOS.
- The SVG is the 256 px layout as vector shapes, its gradients given in the
  canvas's own coordinates (x1=0 y1=0 x2=0 y2=256), so it matches icon-256.png.
- icon.ico holds 14 frames from 16 to 256 px, each the render drawn at that
  size (append_images), never a smaller copy of a larger one; icon-<size>.png
  is the same render.

Requires Pillow.
"""

from __future__ import annotations

import argparse
import math
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageOps
except ImportError:  # pragma: no cover - a developer without Pillow
    sys.exit("Pillow is required: python -m pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "resources" / "icon"
PREVIEW = ROOT / "dist" / "icon-preview"

# The frames of icon.ico, which electron-builder embeds in the executable and
# copies beside the asar, and which the window loads (src/main/windowIcon.ts):
# the small and large icon sizes at 100%, 125%, 150% and 200% display scaling
# (175% asks for 28 and 56, 250% for 80 and 350% for 56 and 112, which Windows
# scales from another frame), the sizes between and the shell's larger views.
ICO_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 96, 128, 256]
# Each frame as a PNG of its own, and the two sizes an .ico cannot hold.
# icon.png is the 1024 render again, the name electron-builder looks for.
PNG_SIZES = ICO_SIZES + [512, 1024]
SMALL_MAX = 40
SVG_SIZE = 256
SUPERSAMPLE = 8
MAX_CANVAS = 4096
PEBBLE_POINTS = 720
SVG_PEBBLE_POINTS = 360

# Turquoise (PLAN Appendix D 2). Each gradient is (top, bottom).
RIM = ("#5ad3db", "#178e9c")
BODY = ("#29393c", "#121b1d")
GHOST = "#7d999b"
LINE = "#f1efe6"
DOTS = "#4fd8e0"

# The pebble, in fractions of the side: centre, half-width, half-heights above
# and below the centre, superellipse exponent (2 is an ellipse, higher is
# squarer) and the tilt in degrees.
PEBBLE = {
    "cx": 0.50,
    "cy": 0.52,
    "a": 0.46,
    "b_top": 0.42,
    "b_bottom": 0.36,
    "n": 2.6,
    "rotation": -5.0,
}
# The body is the pebble with each semi-axis shortened by the rim's width:
# max(RIM_WIDTH, RIM_MIN_PX / size) of the side.
RIM_WIDTH = 0.035
RIM_MIN_PX = 1.25

# The parts on the pebble, all centred across it, so only x1 - x0 is read.
# The line's corners are rounded by a quarter of its height; the ghost and the
# dots are fully rounded.
LARGE = {
    "ghost": {"x0": 0.33, "x1": 0.67, "top": 0.32, "height": 0.05},
    "line": {"x0": 0.25, "x1": 0.75, "top": 0.43, "height": 0.11},
    "dots": {"count": 5, "diameter": 0.07, "gap": 0.045, "top": 0.62},
}
SMALL = {
    "ghost": None,
    "line": {"x0": 0.25, "x1": 0.75, "top": 0.40, "height": 0.13},
    "dots": {"count": 3, "diameter": 0.10, "gap": 0.07, "top": 0.60},
}

# The contact sheet's grounds: Windows 11's light and dark taskbars.
LIGHT_GROUND = "#f3f3f3"
DARK_GROUND = "#202020"


@dataclass(frozen=True)
class Box:
    """A part's edges in whole pixels of the size being drawn; x1 and y1 are exclusive."""

    x0: int
    y0: int
    x1: int
    y1: int

    @property
    def height(self) -> int:
        return self.y1 - self.y0


@dataclass(frozen=True)
class Layout:
    size: int
    rim: float  # the rim's width, in fractions of the side
    ghost: Box | None
    line: Box
    dots: list[Box]


def snap(value: float) -> int:
    """The nearest whole pixel, a half rounded up (Python's round() goes to even)."""
    return math.floor(value + 0.5)


def centred(width: float, axis2: int) -> tuple[int, int]:
    """Left and right edges of a part about `width` px wide, centred on the axis at axis2 / 2.

    On whole pixels a part is centred only when its width has the parity of
    axis2, so the width becomes the nearest whole number that has it, the
    larger of two on a tie.
    """
    parity = axis2 % 2
    low = math.floor((width - parity) / 2) * 2 + parity
    whole = low if width - low < low + 2 - width else low + 2
    whole = max(whole, 2 - parity)
    left = (axis2 - whole) // 2
    return left, left + whole


def layout(size: int) -> Layout:
    """Where every part goes at `size` px, edges on whole pixels."""
    spec = SMALL if size <= SMALL_MAX else LARGE

    dots = spec["dots"]
    count = dots["count"]
    diameter = max(1, snap(dots["diameter"] * size))
    gap = max(1, snap(dots["gap"] * size))
    span = count * diameter + (count - 1) * gap
    # Twice the axis's x, so that a half pixel stays a whole number.
    axis2 = size if (size - span) % 2 == 0 else size + 1
    left = (axis2 - span) // 2
    top = snap(dots["top"] * size)
    dot_boxes = [
        Box(left + i * (diameter + gap), top, left + i * (diameter + gap) + diameter, top + diameter)
        for i in range(count)
    ]

    def bar(part: dict[str, float]) -> Box:
        x0, x1 = centred((part["x1"] - part["x0"]) * size, axis2)
        y0 = snap(part["top"] * size)
        return Box(x0, y0, x1, y0 + max(1, snap(part["height"] * size)))

    ghost = spec["ghost"]
    return Layout(
        size=size,
        rim=max(RIM_WIDTH, RIM_MIN_PX / size),
        ghost=bar(ghost) if ghost else None,
        line=bar(spec["line"]),
        dots=dot_boxes,
    )


def pebble_points(scale: float, inset: float, count: int) -> list[tuple[float, float]]:
    """The pebble's outline, each semi-axis shortened by `inset`, in units of `scale` per side."""
    p = PEBBLE
    a = p["a"] - inset
    b_top = p["b_top"] - inset
    b_bottom = p["b_bottom"] - inset
    exponent = 2 / p["n"]
    rot = math.radians(p["rotation"])
    cos_r, sin_r = math.cos(rot), math.sin(rot)
    points = []
    for i in range(count):
        t = 2 * math.pi * i / count
        c, s = math.cos(t), math.sin(t)
        x = a * math.copysign(abs(c) ** exponent, c)
        y = (b_bottom if s > 0 else b_top) * math.copysign(abs(s) ** exponent, s)
        points.append(((p["cx"] + x * cos_r - y * sin_r) * scale, (p["cy"] + x * sin_r + y * cos_r) * scale))
    return points


def gradient(big: int, top: str, bottom: str) -> Image.Image:
    """The whole canvas shading from `top` at the top edge to `bottom` at the bottom."""
    ramp = Image.linear_gradient("L").resize((big, big), Image.Resampling.BILINEAR)
    return ImageOps.colorize(ramp, black=top, white=bottom).convert("RGBA")


def render(size: int) -> Image.Image:
    """The icon at `size` px, drawn oversized and reduced so every edge is anti-aliased."""
    lay = layout(size)
    ss = max(1, min(SUPERSAMPLE, MAX_CANVAS // size))
    big = size * ss
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))

    # Pillow puts a coordinate at a pixel's centre, the SVG at its edge.
    for colours, inset in ((RIM, 0.0), (BODY, lay.rim)):
        mask = Image.new("L", (big, big), 0)
        outline = [(x - 0.5, y - 0.5) for x, y in pebble_points(big, inset, PEBBLE_POINTS)]
        ImageDraw.Draw(mask).polygon(outline, fill=255)
        image.paste(gradient(big, *colours), (0, 0), mask)

    pen = ImageDraw.Draw(image)

    def pixels(box: Box) -> list[int]:
        return [box.x0 * ss, box.y0 * ss, box.x1 * ss - 1, box.y1 * ss - 1]

    if lay.ghost:
        pen.rounded_rectangle(pixels(lay.ghost), radius=lay.ghost.height * ss / 2, fill=GHOST)
    pen.rounded_rectangle(pixels(lay.line), radius=lay.line.height * ss / 4, fill=LINE)
    for dot in lay.dots:
        pen.ellipse(pixels(dot), fill=DOTS)

    return image.resize((size, size), Image.Resampling.LANCZOS)


def number(value: float) -> str:
    """A coordinate for the SVG: two decimals at most, no trailing zeros."""
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text == "-0" else text


def svg_text() -> str:
    """The 256 px layout as vector shapes on a 0..256 canvas."""
    s = SVG_SIZE
    lay = layout(s)

    def outline(inset: float) -> str:
        return " ".join(f"{number(x)},{number(y)}" for x, y in pebble_points(s, inset, SVG_PEBBLE_POINTS))

    def stops(colours: tuple[str, str]) -> str:
        return f'<stop offset="0" stop-color="{colours[0]}" /><stop offset="1" stop-color="{colours[1]}" />'

    def rect(box: Box, radius: float, fill: str) -> str:
        return (
            f'  <rect x="{box.x0}" y="{box.y0}" width="{box.x1 - box.x0}" height="{box.height}" '
            f'rx="{number(radius)}" fill="{fill}" />'
        )

    shapes = []
    if lay.ghost:
        shapes.append(rect(lay.ghost, lay.ghost.height / 2, GHOST))
    shapes.append(rect(lay.line, lay.line.height / 4, LINE))
    for dot in lay.dots:
        shapes.append(
            f'  <circle cx="{number((dot.x0 + dot.x1) / 2)}" cy="{number((dot.y0 + dot.y1) / 2)}" '
            f'r="{number((dot.x1 - dot.x0) / 2)}" fill="{DOTS}" />'
        )
    body = "\n".join(shapes)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s} {s}" width="{s}" height="{s}" role="img" aria-label="A dark pebble with a turquoise rim, holding a cream line of type with a faint line above it and a row of dots below">
  <defs>
    <linearGradient id="icon-rim" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="{s}">{stops(RIM)}</linearGradient>
    <linearGradient id="icon-body" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="{s}">{stops(BODY)}</linearGradient>
  </defs>
  <polygon points="{outline(0.0)}" fill="url(#icon-rim)" />
  <polygon points="{outline(lay.rim)}" fill="url(#icon-body)" />
{body}
</svg>
"""


def write_resources(rendered: dict[int, Image.Image]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "icon.svg").write_text(svg_text(), encoding="utf-8", newline="\n")

    wanted = {f"icon-{size}.png" for size in PNG_SIZES}
    for old in OUT.glob("icon-*.png"):
        if old.name not in wanted:
            old.unlink()
    for size in PNG_SIZES:
        rendered[size].save(OUT / f"icon-{size}.png")
    rendered[max(PNG_SIZES)].save(OUT / "icon.png")

    largest = max(ICO_SIZES)
    rendered[largest].save(
        OUT / "icon.ico",
        format="ICO",
        sizes=[(size, size) for size in ICO_SIZES],
        append_images=[rendered[size] for size in ICO_SIZES if size != largest],
    )
    with Image.open(OUT / "icon.ico") as ico:
        frames = sorted(ico.info["sizes"])
    if frames != [(size, size) for size in ICO_SIZES]:
        sys.exit(f"icon.ico holds {frames}, not the {len(ICO_SIZES)} sizes asked for")

    print(f"wrote {OUT}: icon.svg, icon.png (1024), {len(PNG_SIZES)} icon-<size>.png, icon.ico ({len(frames)} frames)")


def write_sheet(rendered: dict[int, Image.Image]) -> None:
    """Every .ico size magnified on light and dark grounds, and a strip at true size."""
    PREVIEW.mkdir(parents=True, exist_ok=True)
    try:
        font = ImageFont.load_default(size=22)
    except TypeError:  # pragma: no cover - Pillow before 10.1
        font = ImageFont.load_default()

    cell, label, columns = 280, 40, 7
    groups = [ICO_SIZES[i : i + columns] for i in range(0, len(ICO_SIZES), columns)]
    group_h = label + 2 * cell
    sheet = Image.new("RGBA", (cell * columns, group_h * len(groups)), "white")
    pen = ImageDraw.Draw(sheet)
    for g, sizes in enumerate(groups):
        top = g * group_h
        pen.rectangle([0, top + label, sheet.width, top + label + cell - 1], fill=LIGHT_GROUND)
        pen.rectangle([0, top + label + cell, sheet.width, top + group_h - 1], fill=DARK_GROUND)
        for c, size in enumerate(sizes):
            icon = rendered[size]
            factor = max(1, 240 // size)
            spec = "small" if size <= SMALL_MAX else "large"
            text = f"{size} px, {spec}" + (f", x{factor}" if factor > 1 else "")
            pen.text((c * cell + 12, top + 8), text, fill="#222222", font=font)
            shown = icon.resize((size * factor, size * factor), Image.Resampling.NEAREST)
            for row in range(2):
                x = c * cell + (cell - shown.width) // 2
                y = top + label + row * cell + (cell - shown.height) // 2
                sheet.alpha_composite(shown, (x, y))
    sheet.save(PREVIEW / "sheet.png")

    strip_sizes = [16, 20, 24, 30, 32, 36, 40, 48, 64]
    pitch = 76
    strip = Image.new("RGBA", (16 + pitch * len(strip_sizes), 160), LIGHT_GROUND)
    ImageDraw.Draw(strip).rectangle([0, 80, strip.width, 160], fill=DARK_GROUND)
    for i, size in enumerate(strip_sizes):
        x = 16 + i * pitch + (64 - size) // 2
        for middle in (40, 120):
            strip.alpha_composite(rendered[size], (x, middle - size // 2))
    strip.save(PREVIEW / "strip-1x.png")
    strip.resize((strip.width * 4, strip.height * 4), Image.Resampling.NEAREST).save(PREVIEW / "strip-4x.png")

    print(f"wrote {PREVIEW}: sheet.png, strip-1x.png, strip-4x.png")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Draw the application icon into resources/icon/.")
    parser.add_argument(
        "--sheet",
        action="store_true",
        help="write a contact sheet to dist/icon-preview/ instead, and leave resources/icon/ as it is",
    )
    args = parser.parse_args(argv)
    sizes = ICO_SIZES if args.sheet else PNG_SIZES
    rendered = {size: render(size) for size in sizes}
    if args.sheet:
        write_sheet(rendered)
    else:
        write_resources(rendered)


if __name__ == "__main__":
    main()
