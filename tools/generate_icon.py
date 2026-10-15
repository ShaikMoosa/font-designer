"""Generate build/icon.ico for the Windows app (stdlib only).

Draws the app brand mark: an amber rounded square (#e8a33d, matching
--accent in src/style.css) with a dark G (#1a1408, --accent-ink).
Run: python tools/generate_icon.py
"""
import struct
import zlib
from pathlib import Path

SIZE = 256
BG = (0xE8, 0xA3, 0x3D, 255)
INK = (0x1A, 0x14, 0x08, 255)
CLEAR = (0, 0, 0, 0)
RADIUS = 48

# 5x7 bitmap for "G".
GLYPH = [
    "01110",
    "10001",
    "10000",
    "10111",
    "10001",
    "10001",
    "01110",
]
CELL = 24
GX = (SIZE - 5 * CELL) // 2
GY = (SIZE - 7 * CELL) // 2


def pixel(x: int, y: int):
    # Rounded-square mask.
    cx = min(x, SIZE - 1 - x)
    cy = min(y, SIZE - 1 - y)
    if cx < RADIUS and cy < RADIUS:
        dx, dy = RADIUS - cx, RADIUS - cy
        if dx * dx + dy * dy > RADIUS * RADIUS:
            return CLEAR
    gx, gy = (x - GX) // CELL, (y - GY) // CELL
    if 0 <= gx < 5 and 0 <= gy < 7 and GLYPH[gy][gx] == "1":
        return INK
    return BG


def png_bytes() -> bytes:
    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)
        for x in range(SIZE):
            raw.extend(pixel(x, y))
    def chunk(kind: bytes, data: bytes) -> bytes:
        out = struct.pack(">I", len(data)) + kind + data
        return out + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def main() -> None:
    png = png_bytes()
    # ICO with a single PNG-compressed 256x256 entry (size byte 0 = 256).
    ico = struct.pack("<HHH", 0, 1, 1)
    ico += struct.pack("<BBBBHHII", 0, 0, 1, 0, 1, 32, len(png), 6 + 16)
    ico += png
    out = Path(__file__).resolve().parent.parent / "build" / "icon.ico"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(ico)
    print(f"wrote {out} ({len(ico)} bytes)")


if __name__ == "__main__":
    main()
