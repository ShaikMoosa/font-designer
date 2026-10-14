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
- **Files:** Open/Save `.glyphs` (JSON subset — OpenStep-plist `.glyphs`
  files get a clear error, not silent corruption), Export UFO as
  `.ufo.zip` (unzip for the `.ufo` folder), Export OTF (beta, active
  master, via opentype.js).

## Deferred (per Handbook)

Interpolation/variable fonts, smart/corner/brush components, filters,
extended feature code, manual PS/TT hinting, color fonts, plug-ins.
Icons and starter outlines are original to this MVP.
