# Glyphs for Windows — Core MVP

A Windows-friendly font editor covering the drawing-first core of the
*Glyphs 4 Handbook* (294 pp., 18 chapters): Edit View drawing/editing,
Font View, spacing & kerning, and Glyphs + UFO interchange.

## Run

Browser development build:

```powershell
npm install
npm run dev
```

Then open the URL Vite prints (default http://127.0.0.1:5173/) in a browser.

Windows desktop app (Phase 6, Electron shell):

```powershell
npm install
npm run desktop   # builds dist/ and launches the desktop app — no terminal-hosted browser needed at run time
npm run dist:win  # writes NSIS installer + portable .exe to release/
```

The desktop app uses native Windows Open/Save dialogs for `.glyphs`,
UFO `.zip`, and exported fonts; the browser build keeps its file-input
and download fallbacks. The installer is **unsigned** in Phase 6, so
Windows SmartScreen will warn on first run (choose *More info → Run
anyway*); code signing needs a purchased certificate. The Python
compile service is **not** bundled: WOFF2 and variable-font export
show a clear offline status when `tools/fontc` is not running, while
browser-native OTF/TTF/WOFF export keeps working.

Other commands: `npm run build`, `npm run preview`, `npm test`, `npm run typecheck`.
The codebase is TypeScript (`src/*.ts`, strict `tsc`); tests run directly on `.ts` via Node type stripping.

## What works

- **Edit View:** Pen (click/drag for curves, click first node to close),
  Select (drag nodes/handles, arrow-key nudge), Hand (pan), wheel zoom,
  Rect/Ellipse primitives, Convert line/curve, Delete, Close path,
  guides/metrics, anchors, undo/redo (Ctrl+Z / Ctrl+Y).
- **Font View:** Grid/List, search, thumbnails, add/delete glyphs.
- **Inspector / Palette / Kerning / Font Info:** width & sidebearings,
  Unicode/category/kerning groups, transforms (move/scale/rotate/flip),
  multi-master layer copy, pair kerning with live preview, family/metrics.
- **Preview:** type a string below the editor; kerning applies; missing
  glyphs show as red boxes.
- **Files:** Open/Save `.glyphs` — real Mac OpenStep-plist `.glyphs`
  files open with masters, anchors, components and kerning, and saving
  writes OpenStep plist for the supported subset (JSON subset save kept
  as a fallback), Export UFO as `.ufo.zip` (components decomposed, with
  `designspace.json` + `kerning-groups.plist`), Export OTF (beta, active
  master, via opentype.js).
- **Phase 2:** Components with live base-glyph updates and recipe
  auto-composites, multi-master interpolation ghost + instance UFO
  export, feature-code subset (classes / ligatures / `pos`) driving the
  shaping preview, kerning groups + metrics keys, path-direction fix
  and boolean remove-overlaps (flattens curves).
- **Phase 3 (Export tab):** Browser OTF (CFF), TTF (hand-written glyf
  writer, cubic→quadratic at tolerance 4), and WOFF; pre-export
  validation that blocks on errors; optional local compile service
  (`tools/fontc`, `uv sync && uv run python server.py`) for WOFF2 and
  variable fonts from the designspace bundle.
- **Phase 4 (Editing depth):** Masters side-by-side — a second editor
  pane with its own master (pane bar: *Masters side-by-side*, *Pane B
  master*, *+ Master (copy)*); click a pane to make it the active one
  for toolbar/keyboard commands. Pencil tool (B) turns a freehand
  stroke into an editable open contour (Ramer–Douglas–Peucker,
  tolerance 6). Measure tool (M) snaps to nodes and reports distance,
  dx/dy and angle without modifying the font. Shift-click builds a
  multi-node selection that drags/nudges/deletes together and feeds
  the alignment/distribute buttons in the toolbar.
- **Phase 5 (Interchange & smart parts):** Saving writes real OpenStep
  `.glyphs` (masters, layers, anchors, components, kerning, feature
  code) with a JSON-subset fallback in the File menu. Smart components:
  define named parameters (scaleX/scaleY/x/y, with min/max/default) on
  a part glyph in the Inspector; glyphs using it as a component get
  live sliders, and the values flow into editor, preview, UFO/TTF and
  variable export. Preview shaping positions combining marks on
  `top`/`_top` anchors (still a labelled subset). Browser TTF gains
  cmap format 12 for astral-plane glyphs, and Palette gains boolean
  Subtract alongside Remove overlaps.
- **Phase 6 (Desktop packaging):** Electron shell (`electron/main.cjs`,
  secure preload bridge, single-instance window, native application
  menu) loads the Vite build directly, so the app launches as a
  Windows desktop app without a terminal or browser. Open, Save
  `.glyphs`, UFO export, instance export, and OTF/TTF/WOFF/WOFF2/
  variable export use native Windows file dialogs in the desktop
  app and keep the browser fallbacks on the web. `npm run dist:win`
  produces an NSIS installer (install-directory choice, desktop and
  Start-menu shortcuts) and a portable `.exe` in `release/`. Not
  bundled in Phase 6: the Python compile service (WOFF2/variable
  export degrades with a clear offline status) and code signing
  (unsigned installer — SmartScreen warning documented above).

## Deferred (per Handbook)

Corner/brush components, full OpenType shaping (complex scripts,
mark-to-mark), manual PS/TT hinting, color fonts, plug-ins, bundled
compile service, signed Windows installer.
Icons and starter outlines are original to this MVP.
