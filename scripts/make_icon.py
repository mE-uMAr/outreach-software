"""Rasterise build/logo.svg into build/icon.ico.

Written against zlib and struct rather than Pillow or a real SVG renderer: the
engine deliberately ships without an imaging library, and pulling one in just to
draw an icon would put it inside the frozen binary for no runtime benefit.

The geometry here is the same as logo.svg, in the same 64-unit space, so the two
cannot drift apart without someone editing both. Run this after changing the
logo:

    python scripts/make_icon.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

#: Anti-aliasing. Every pixel is sampled this many times per axis, so an edge
#: lands on a blend rather than a staircase — which is what a 16px icon lives or
#: dies by.
SUPERSAMPLE = 4

#: Sizes Windows actually asks for, from the taskbar up to the Store tile.
SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)

GRID = 64.0
CORNER_RADIUS = 14.0

TOP = (0x25, 0x63, 0xEB)     # brand-500
BOTTOM = (0x1D, 0x4E, 0xD8)  # brand-700
WHITE = (0xFF, 0xFF, 0xFF)

#: (polygon, opacity) in logo.svg's coordinate space, painted back to front.
PLANE = (
    (((50.0, 14.0), (28.5, 46.0), (24.0, 30.5)), 0.78),  # lower wing = the fold
    (((50.0, 14.0), (24.0, 30.5), (10.5, 26.0)), 1.00),  # upper wing
)

#: The network being reached: (cx, cy, r, opacity).
NODES = (
    (14.0, 45.0, 3.2, 0.55),
    (26.0, 38.5, 2.4, 0.55),
)

#: The edge between them: (x1, y1, x2, y2, half-width, opacity).
EDGES = ((15.0, 44.0, 25.0, 39.0, 1.0, 0.45),)


def _in_polygon(x: float, y: float, points: tuple[tuple[float, float], ...]) -> bool:
    """Ray casting, counting crossings to the right of the sample point."""
    inside = False
    count = len(points)
    for index in range(count):
        x1, y1 = points[index]
        x2, y2 = points[(index + 1) % count]
        if (y1 > y) != (y2 > y):
            crossing = x1 + (y - y1) / (y2 - y1) * (x2 - x1)
            if x < crossing:
                inside = not inside
    return inside


def _in_rounded_rect(x: float, y: float, size: float, radius: float) -> bool:
    """Squircle test: clamp to the corner circle's centre, then measure."""
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius


def _on_segment(x: float, y: float, x1: float, y1: float, x2: float, y2: float, half: float) -> bool:
    """Distance from a point to a capsule around the segment."""
    dx, dy = x2 - x1, y2 - y1
    length_squared = dx * dx + dy * dy
    if length_squared == 0:
        return (x - x1) ** 2 + (y - y1) ** 2 <= half * half
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / length_squared))
    px, py = x1 + t * dx, y1 + t * dy
    return (x - px) ** 2 + (y - py) ** 2 <= half * half


def _sample(gx: float, gy: float) -> tuple[int, int, int, int] | None:
    """Colour at one point in the 64-unit design space, or None outside the mark."""
    if not _in_rounded_rect(gx, gy, GRID, CORNER_RADIUS):
        return None

    ratio = gy / GRID
    colour = [round(TOP[i] + (BOTTOM[i] - TOP[i]) * ratio) for i in range(3)]

    def blend(opacity: float) -> None:
        for i in range(3):
            colour[i] = round(colour[i] + (WHITE[i] - colour[i]) * opacity)

    for x1, y1, x2, y2, half, opacity in EDGES:
        if _on_segment(gx, gy, x1, y1, x2, y2, half):
            blend(opacity)

    for cx, cy, radius, opacity in NODES:
        if (gx - cx) ** 2 + (gy - cy) ** 2 <= radius * radius:
            blend(opacity)

    for polygon, opacity in PLANE:
        if _in_polygon(gx, gy, polygon):
            blend(opacity)

    return (*colour, 255)


def render(size: int) -> bytes:
    """One icon as raw RGBA rows, supersampled for smooth edges."""
    scale = GRID / size
    step = 1.0 / SUPERSAMPLE
    offset = step / 2.0
    samples = SUPERSAMPLE * SUPERSAMPLE

    rows = bytearray()
    for y in range(size):
        rows.append(0)  # PNG filter byte: none
        for x in range(size):
            totals = [0, 0, 0]
            covered = 0
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    point = _sample(
                        (x + offset + sx * step) * scale,
                        (y + offset + sy * step) * scale,
                    )
                    if point is None:
                        continue
                    covered += 1
                    for i in range(3):
                        totals[i] += point[i]

            if covered == 0:
                rows.extend(b"\x00\x00\x00\x00")
                continue

            # Colour is the mean of the covered samples; alpha is how many of
            # them landed inside, which is what feathers the rounded corners.
            rows.extend(bytes(totals[i] // covered for i in range(3)))
            rows.append(round(255 * covered / samples))
    return bytes(rows)


def to_png(raw: bytes, size: int) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def build_ico(path: Path) -> None:
    images = [to_png(render(size), size) for size in SIZES]

    offset = 6 + 16 * len(images)
    directory = b""
    payload = b""
    for size, data in zip(SIZES, images, strict=True):
        # 256 is stored as 0 — the field is a single byte.
        directory += struct.pack(
            "<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset
        )
        payload += data
        offset += len(data)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(struct.pack("<HHH", 0, 1, len(images)) + directory + payload)

    # A PNG of the largest size, for the README and the release page.
    (path.parent / "logo.png").write_bytes(images[-1])


if __name__ == "__main__":
    target = Path(__file__).resolve().parent.parent / "build" / "icon.ico"
    build_ico(target)
    print(f"wrote {target} ({target.stat().st_size:,} bytes) at sizes {SIZES}")
