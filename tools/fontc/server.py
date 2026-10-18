"""Local compile service for Glyphs for Windows.

Endpoints (127.0.0.1:8765, CORS open for the local Vite app):
  GET  /health           -> {ok, fontTools, ufo2ft, brotli}
  POST /compile/woff2    body: SFNT bytes        -> WOFF2 bytes
  POST /compile/variable body: designspace bundle zip -> variable TTF bytes
  POST /compile/autohint body: TTF bytes -> autohinted TTF (X-Autohint-Applied)
  POST /validate         body: font bytes -> fontTools readback report JSON

Run: uv sync && uv run python server.py
"""
import io
import json
import tempfile
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    import fontTools
    FONTTOOLS_VERSION = fontTools.version
except Exception:
    FONTTOOLS_VERSION = None

try:
    import ufo2ft  # noqa: F401
    HAS_UFO2FT = True
except Exception:
    HAS_UFO2FT = False

try:
    import brotli  # noqa: F401
    HAS_BROTLI = True
except Exception:
    HAS_BROTLI = False


def _find_ttfautohint():
    """Locate the optional ttfautohint binary (ttfautohint-py wheel,
    venv Scripts, or PATH). Returns the path or None."""
    import shutil
    import sysconfig
    from pathlib import Path as _Path

    candidates = []
    try:
        import ttfautohint as _pkg

        pkg_dir = _Path(_pkg.__file__).parent
        candidates.append(pkg_dir / "ttfautohint.exe")
        candidates.append(pkg_dir / "ttfautohint")
    except Exception:
        pass
    scripts = sysconfig.get_path("scripts")
    if scripts:
        candidates.append(_Path(scripts) / "ttfautohint.exe")
        candidates.append(_Path(scripts) / "ttfautohint")
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return shutil.which("ttfautohint")


TTFAUTOHINT_BIN = _find_ttfautohint()
HAS_TTFAUTOHINT = TTFAUTOHINT_BIN is not None


def autohint_font(font_bytes: bytes) -> tuple[bytes, bool]:
    """Run ttfautohint when available. Returns (bytes, applied); when the
    binary is missing or fails, the original bytes come back unchanged
    with applied=False so callers can report honestly."""
    import subprocess
    import tempfile as _tempfile
    from pathlib import Path as _Path

    if not HAS_TTFAUTOHINT or not font_bytes:
        return font_bytes, False
    try:
        with _tempfile.TemporaryDirectory() as tmp:
            src = _Path(tmp) / "in.ttf"
            dst = _Path(tmp) / "out.ttf"
            src.write_bytes(font_bytes)
            proc = subprocess.run(
                [TTFAUTOHINT_BIN, str(src), str(dst)],
                capture_output=True, timeout=120,
            )
            if proc.returncode != 0 or not dst.exists() or dst.stat().st_size == 0:
                return font_bytes, False
            return dst.read_bytes(), True
    except Exception:
        return font_bytes, False


def validate_font(font_bytes: bytes) -> dict:
    """Read an exported font back with fontTools. Raises on any font
    that does not parse, has no glyphs, or has an empty cmap."""
    import hashlib

    from fontTools.ttLib import TTFont

    if not font_bytes:
        raise RuntimeError("empty font bytes")
    font = TTFont(io.BytesIO(font_bytes))
    glyph_order = font.getGlyphOrder()
    if len(glyph_order) < 1:
        raise RuntimeError("font has no glyphs")
    cmap = font["cmap"]
    mappings = cmap.getBestCmap() or {}
    if not mappings:
        raise RuntimeError("font cmap has no mappings")
    # Force the core tables to actually parse, not just list.
    _ = font["head"].unitsPerEm
    _ = font["maxp"].numGlyphs
    _ = font["hmtx"]
    name = font["name"].getDebugName(1) if "name" in font else None
    return {
        "ok": True,
        "fontTools": FONTTOOLS_VERSION,
        "flavor": font.flavor,
        "sfntVersion": font.sfntVersion,
        "glyphCount": len(glyph_order),
        "cmapMappings": len(mappings),
        "tables": sorted(font.keys()),
        "familyName": name,
        "sha256": hashlib.sha256(font_bytes).hexdigest(),
    }


def compile_woff2(sfnt_bytes: bytes) -> bytes:
    if not HAS_BROTLI:
        raise RuntimeError("brotli is not installed in the service env (WOFF2 unavailable)")
    from fontTools.ttLib import TTFont

    font = TTFont(io.BytesIO(sfnt_bytes))
    font.flavor = "woff2"
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def compile_variable(bundle_bytes: bytes) -> tuple[bytes, bool]:
    if not HAS_UFO2FT:
        raise RuntimeError("ufo2ft is not installed in the service env (variable build unavailable)")
    from fontTools.designspaceLib import AxisDescriptor, DesignSpaceDocument, SourceDescriptor
    from fontTools import varLib

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        with zipfile.ZipFile(io.BytesIO(bundle_bytes)) as zf:
            manifest = json.loads(zf.read("designspace.json"))
            # UFO sources must live in folders named <id>.ufo for designspaceLib.
            for name in zf.namelist():
                if name.startswith("masters/") and not name.endswith("/"):
                    parts = name.split("/", 2)
                    if len(parts) < 3:
                        continue
                    target = root / f"{parts[1]}.ufo" / parts[2]
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(zf.read(name))
        masters = sorted(manifest.get("masters") or [], key=lambda m: m.get("weightValue") or 0)
        if len(masters) < 2:
            raise RuntimeError("variable build needs at least two masters in the bundle")
        axes = manifest.get("axes") or [{"tag": "wght", "name": "Weight", "min": 400, "defaultValue": 400, "max": 700}]
        axis = axes[0]
        axis_name = axis.get("name") or "Weight"
        doc = DesignSpaceDocument()
        doc.addAxis(AxisDescriptor(
            tag=axis.get("tag") or "wght",
            name=axis_name,
            minimum=float(axis.get("min") or masters[0].get("weightValue") or 400),
            default=float(axis.get("defaultValue") or masters[0].get("weightValue") or 400),
            maximum=float(axis.get("max") or masters[-1].get("weightValue") or 700),
        ))
        for master in masters:
            ufo_dir = root / f"{master.get('id')}.ufo"
            if not ufo_dir.exists():
                raise RuntimeError(f"master UFO missing in bundle: {master.get('id')}")
            doc.addSource(SourceDescriptor(
                filename=f"{master.get('id')}.ufo",
                path=str(ufo_dir),
                name=str(master.get("name") or master.get("id")),
                familyName=str(manifest.get("familyName") or "Untitled"),
                styleName=str(master.get("name") or "Regular"),
                location={axis_name: float(master.get("weightValue") or 400)},
            ))
        designspace_path = root / "font.designspace"
        doc.write(designspace_path)
        doc.path = str(designspace_path)
        # varLib opens binary masters itself; UFO sources must be compiled
        # to TTFonts first (ufo2ft) and attached to their descriptors.
        from defcon import Font as UFOFont
        from ufo2ft import compileTTF

        for source in doc.sources:
            source.font = compileTTF(UFOFont(source.path))
        built = varLib.build(doc)
        # fontTools returns (variableFont, model, masterFonts) on modern versions.
        var_font = built[0] if isinstance(built, tuple) else built
        raw: bytes | None = None
        if var_font is not None and hasattr(var_font, "save"):
            out = io.BytesIO()
            var_font.save(out)
            raw = out.getvalue()
        if raw is None:
            candidates = sorted(root.rglob("*.ttf"))
            if not candidates:
                raise RuntimeError("variable build produced no TTF")
            raw = candidates[0].read_bytes()
        if manifest.get("autohintTT"):
            return autohint_font(raw)
        return raw, False


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, code: int, body: bytes, content_type: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain")

    def do_GET(self):
        if self.path == "/health":
            payload = {"ok": True, "fontTools": FONTTOOLS_VERSION, "ufo2ft": HAS_UFO2FT, "brotli": HAS_BROTLI, "ttfautohint": HAS_TTFAUTOHINT}
            self._send(200, json.dumps(payload).encode(), "application/json")
        else:
            self._send(404, b'{"error":"not found"}', "application/json")

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        try:
            if self.path == "/validate":
                self._send(200, json.dumps(validate_font(body)).encode(), "application/json")
            elif self.path == "/compile/woff2":
                self._send(200, compile_woff2(body), "font/woff2")
            elif self.path == "/compile/autohint":
                hinted, applied = autohint_font(body)
                self._send(200, hinted, "font/ttf", {"X-Autohint-Applied": "yes" if applied else "no", "Access-Control-Expose-Headers": "X-Autohint-Applied"})
            elif self.path == "/compile/variable":
                built, hint_applied = compile_variable(body)
                self._send(200, built, "font/ttf", {"X-Autohint-Applied": "yes" if hint_applied else "no", "Access-Control-Expose-Headers": "X-Autohint-Applied"})
            else:
                self._send(404, b'{"error":"not found"}', "application/json")
        except Exception as exc:
            self._send(400, json.dumps({"error": str(exc)}).encode(), "application/json")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("fontc listening on http://127.0.0.1:8765 (fontTools=%s ufo2ft=%s brotli=%s)" % (FONTTOOLS_VERSION, HAS_UFO2FT, HAS_BROTLI))
    server.serve_forever()
