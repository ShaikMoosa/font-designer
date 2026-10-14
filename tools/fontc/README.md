# fontc — local compile service (optional)

Powers WOFF2 and variable-font export for the web app. Browser formats
(OTF/TTF/WOFF) work without it.

```powershell
uv sync
uv run python server.py
```

Listens on http://127.0.0.1:8765 (`GET /health`, `POST /compile/woff2`,
`POST /compile/variable`). The app probes `/health` and reports the
service as offline instead of failing when it is not running.
