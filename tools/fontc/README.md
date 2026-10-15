# fontc — local compile service

Powers WOFF2 and variable-font export. Browser formats (OTF/TTF/WOFF)
work without it. Since Phase 7 the Windows desktop app bundles this
service as a sidecar (`fontc.exe`, built with PyInstaller via
`npm run build:fontc`) and starts it automatically on launch, so
desktop users do not run anything by hand. Set `GLYPHS_FONTC=off`
to disable the sidecar, or `GLYPHS_FONTC_PATH` to a custom executable.

For browser development, run it manually:

```powershell
uv sync
uv run python server.py
```

Listens on http://127.0.0.1:8765 (`GET /health`, `POST /compile/woff2`,
`POST /compile/variable`, `POST /validate`). The app probes `/health`
and reports the service as offline instead of failing when it is not
running. Since Phase 8 every binary export is posted to `/validate`
for a fontTools readback (glyph count, cmap, table list, SHA-256)
before delivery; a failed readback blocks the export.
