# Glyphs for Windows — Core MVP

A Windows-friendly font editor covering the drawing-first core of the
*Glyphs 4 Handbook* (294 pp., 18 chapters): Edit View drawing/editing,
Font View, spacing & kerning, and Glyphs + UFO interchange.

## Run

```powershell
npm install
npm run dev
```

Then open the URL Vite prints (default http://127.0.0.1:5173/) in a browser.

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
- **Files:** Open/Save `.glyphs` (save is a JSON subset; real Mac
  OpenStep-plist `.glyphs` files open with masters, anchors, components
  and kerning), Export UFO as `.ufo.zip` (components decomposed, with
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

## Deferred (per Handbook)

Smart/corner/brush components, filters beyond union, full OpenType
shaping (marks, complex scripts), manual PS/TT hinting, color fonts,
plug-ins.
Icons and starter outlines are original to this MVP.
