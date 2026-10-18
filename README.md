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
and download fallbacks. The installer is **unsigned**, so Windows
SmartScreen will warn on first run (choose *More info → Run anyway*);
code signing needs a purchased certificate. Since Phase 7 the desktop
app bundles the Python compile service as a sidecar and starts it
automatically, so WOFF2 and variable-font export work out of the box
on desktop; in the browser build they show a clear offline status
when `tools/fontc` is not running, while browser-native OTF/TTF/WOFF
export keeps working.

Other commands: `npm run build`, `npm run preview`, `npm test`, `npm run typecheck`.
The codebase is TypeScript (`src/*.ts`, strict `tsc`); tests run directly on `.ts` via Node type stripping.

## What works

- **Edit View:** Pen (click/drag for curves, click first node to close),
  Select (drag nodes/handles, arrow-key nudge), Hand (pan), wheel zoom,
  Rect/Ellipse primitives, Convert line/curve, Delete, Close path,
  guides/metrics, anchors, undo/redo (Ctrl+Z / Ctrl+Y).
- **Font View:** Grid/List in both workspaces (full table in Font View,
  compact list in the Edit View sidebar), search, category and language
  rails with counts, a selected-glyph details pane, cell-size slider with
  thumbnails that scale to match, and an honest shown/total count.
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
- **Phase 7 (Release completeness):** The compile service ships as a
  bundled sidecar (`resources/fontc/fontc.exe`, PyInstaller build of
  `tools/fontc/server.py` via `npm run build:fontc`) that the Electron
  shell starts on launch, health-probes from the Export tab (with
  startup retries), and stops on quit — WOFF2 and variable export now
  work in the desktop app with nothing to run by hand. `GLYPHS_FONTC=off`
  disables it; a manually started service on port 8765 takes over
  harmlessly. The app also gains a real icon (amber brand mark,
  generated by `tools/generate_icon.py`) used by the window, NSIS
  installer, and portable build. Signing remains deferred.
- **Phase 8 (Automatic features & export proofing):** The Features tab
  now generates Adobe FEA-flavoured code automatically from kerning
  pairs/groups (exact pairs before group classes), anchors
  (`markClass`, `mark`, and `mkmk`), and ligature glyph names (`fi`,
  `ffi`, `f_f_i`, …), shown read-only above the manual code; manual
  code overrides generated pairs in the preview, marks now attach
  mark-to-mark, and Font Info summarises both. UFO and designspace
  exports carry the result as `features.fea`, so the compile service
  builds real OpenType features into compiled fonts (verified: a
  variable font with a GPOS `kern` feature). Every binary export
  (OTF/TTF/WOFF/WOFF2/variable) is read back by fontTools through the
  service's new `POST /validate` endpoint before delivery — a failed
  readback blocks the export, and on desktop an unanswered bundled
  service blocks it too (the browser build delivers with an explicit
  no-proof warning instead).
- **Phase 9 (Drawing depth II):** New pure geometry operations in
  `pathsurgery.ts`: Add Extremes (true cubic extrema via de Casteljau
  splits), Round Corners, Offset Curve (miter offset with collapse
  detection; flattens curves), Re-segment (split every segment at its
  midpoint), Fit Curve (Catmull-Rom cubics through polyline points),
  duplicate-node detection/removal (including the closing seam), and
  path cutting. The Palette exposes them as Filters with status
  reporting and undo; Cut Path (toolbar/Edit menu) opens a closed path
  at the selected node or splits an open one. Backup layers snapshot a
  glyph's active-master outline, list/restore/delete from the Palette,
  and round-trip through `.glyphs` JSON and OpenStep saves.
- **UI/UX pass (before Phase 10):** Light Glyphs-like theme with a
  Font/Edit workspace switch; application menus open on click (mouse
  users can slide across an open menubar), close on Escape or outside
  click, and expose `aria-expanded`.
- **Pre-Phase 12 UI Ramp R2 — Font View parity:** Grid View now scales
  glyph-first cells from compact to metadata-rich layouts and defers
  off-screen thumbnail work; List View is a sticky-header, resizable-
  column table with export and outline status. Both views share Windows-
  style click/Ctrl/Shift multi-selection, keyboard navigation, selection-
  aware batch actions, named filter presets, honest selected/visible/total
  counts, and persistent density, sort, filter, scroll, and column state.
- **Pre-Phase 12 UI Ramp R3 — Edit View refinement:** The compact glyph
  navigator groups dense thumbnails and switches among All, Related, and
  Open task scopes. Edit and Text are explicit modes; the canvas reports
  the active tool/pane and keeps previous/next glyph, zoom, Fit, temporary
  Space-pan, and Alt+Arrow navigation nearby. The attached information
  strip shows bearings, width, selection, master, and live kerning for the
  current proof pair. Preview can collapse, resize, and dock below or to the
  right with independent remembered dimensions. Construction geometry now
  gives outlines, selected nodes, handles, metrics, guides, bearings, and
  ghosts distinct visual priority.
- **Pre-Phase 12 UI Ramp R4 — Contextual Palette:** The editing sidebar
  now organizes Dimensions, Transformations, Layers, Components,
  interpolation, Filters, and Backup layers into contextual, remembered
  sections. Transformations use a visual origin matrix, linked X/Y scale,
  move/rotate/skew fields, flip icons, and selection alignment. The visual
  layer list switches masters, exposes working visibility state, and keeps
  intermediate and backup actions close to the active layer. Font Info,
  Features, and Export now open in a focused document-workflow dialog
  instead of competing with everyday editing tabs.
- **Font View and glyph data (Phase 10):** A built-in glyph-info
  database suggests Unicode, category, production name, and case for
  known glyph names when adding or renaming glyphs. Renaming rewrites
  component bases, metrics keys, and kerning pairs. The Font View adds
  filters (Unicode, outlines, empty, composites, color labels), display
  sorting (font order, name, Unicode), and batch actions (apply glyph
  info, set category for the shown glyphs, move a glyph in the font
  order). Production name, tags, color label, case, script override,
  and note live on the glyph, are edited in the Inspector, shown in the
  details pane, and round-trip through `.glyphs` (JSON and OpenStep)
  and UFO GLIF files.
- **Pre-Phase 12 UI Ramp R5 — Masters, interpolation, proofing:** A
  Masters bar above the canvas provides a master/layer browser (active,
  visible, hidden, missing states with contour/node counts), Off /
  Overlay / Split comparison with ghost-opacity control, prev/next
  master navigation (`[` / `]`), a weight-axis track with master and
  intermediate stops, continuous axis scrubbing (`,` / `.`), a five-step
  instance progression strip, interpolated proof-text preview, proof
  UFO export, and inline compatibility fixes. The Palette Layers
  section and Font Info expose the same per-glyph issues; Font View
  flags incompatible glyphs.
- **Pre-Phase 12 UI Ramp R6 — Workflow hardening:** Glyph-grid and
  canvas context menus, a Keyboard Shortcuts dialog (View menu or
  `?`), export busy states, and screenshot baselines in
  `docs/ui-baselines/` (Edit View at three sizes plus 150% scale,
  Overlay, Split, Font View). Focus-visible, reduced-motion, and
  high-DPI behavior from R1–R4 is retained.
- **Interpolation pro (Phase 11):** Font Info carries a
  master-compatibility report with one-click layer-copy fixes, an
  instances editor (active flag, axis weight, style linking,
  per-instance UFO export), and variable-axis settings that feed the
  compile service's variable-font build. Glyphs can carry intermediate
  layers — outline stops at a chosen weight that interpolation and
  instance exports pass through.

## Deferred (per Handbook)

Corner/brush components, full OpenType shaping (complex scripts,
mark-to-mark), manual PS/TT hinting, color fonts, plug-ins, signed
Windows installer.
Icons and starter outlines are original to this MVP.
