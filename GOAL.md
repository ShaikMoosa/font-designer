# Project Goal — Glyphs for Windows (Font Designer)

## Vision

Build a font editor for Windows that gives type designers the core professional workflow of Glyphs — the macOS font editor documented in the *Glyphs 4 Handbook* (294 pages, 18 chapters) — in a form that runs natively-feeling on Windows, is free of the Mac-only barrier, and stays honest about where it matches professional tools and where it is still a subset.

## Problem

Professional font design tooling is concentrated on macOS. Windows users who want to draw, space, kern, and export production fonts face expensive workarounds (virtual machines, dual-boot, or settling for less capable editors). A capable, approachable Windows editor lowers that barrier for independent type designers, students, and hobbyists.

## Product Goal

Deliver a working font editor in which a user can complete the full arc of making a font without leaving the app:

1. **Create** a font from scratch or open an existing one (`.glyphs`, UFO).
2. **Draw and edit** glyph outlines with professional tools (Pen, Pencil, node editing, primitives).
3. **Space and kern** glyphs with live proofing, pair and group kerning, and metrics sync.
4. **Build families** with multiple masters, interpolation, instances, and variable-font axes.
5. **Compose** glyphs from reusable components, including parameterized smart components.
6. **Export production fonts** — OTF, TTF, WOFF, WOFF2, and variable fonts — that real tools (fontTools, browsers, other editors) accept and render correctly.
7. **Round-trip interchange** — open a real `.glyphs` file, edit it, and save it back without losing the supported data.

## Target Users

- Independent and hobbyist type designers working on Windows.
- Design students learning font production who cannot access a Mac.
- Developers and foundries needing a lightweight editor for fixes, spacing, and exports.

## Functional Pillars

- **Edit View (drawing-first priority):** Pen with curve pulling and path closing, Pencil freehand-to-contour, Select with multi-node selection, Hand pan, wheel zoom, guides and metrics lines, anchors, undo/redo, node conversion, alignment and distribution, measurement with node snapping.
- **Font View:** glyph grid/list, search, thumbnails, add/delete glyphs, automatic composites from recipes.
- **Masters & interpolation:** multiple masters, side-by-side master editing, interpolation ghost, instance export, weight axis, variable-font export through the compile service.
- **Spacing & kerning:** width/LSB/RSB editing, pair kerning with live preview, kerning groups, metrics keys with bearing sync.
- **Components:** live components that follow their base glyphs, recipe-based auto-composites, smart components with named adjustable parameters.
- **OpenType features (subset):** editable feature code (classes, ligatures, pair positioning) driving the live preview, combining marks positioned on anchors.
- **Interchange:** OpenStep `.glyphs` read/write, UFO import/export with designspace manifest, kerning exported to all formats.
- **Export fidelity:** browser-native OTF/TTF/WOFF with hand-written font writers, pre-export validation that blocks on errors, and an optional local compile service (fontTools) for WOFF2 and variable fonts.
- **Path surgery:** fix path direction, boolean union and subtraction.

## Quality & Engineering Standards

- **TypeScript, strict typechecking clean** (`npm run typecheck`).
- **Every behavior change carries maintained tests** (`npm test`, currently 65 tests) in the repository's own test layout.
- **Independent verification:** exported fonts are read back by external tools (fontTools), and UI behavior is proven with a headless-browser playthrough before any feature is called done — a feature is not done because code exists, it is done because its effect was observed.
- **Honest subset labelling:** wherever the app implements less than full Glyphs/OpenType behavior (feature-code subset, quadratic curve conversion, unmodelled `.glyphs` fields), the UI and README say so plainly instead of implying parity.
- **Per-phase delivery:** work ships in reviewed phases (plan → implement → verify → commit on the user's word), published to `github.com/ShaikMoosa/font-designer`.

## Current Status

- **Phases 1–5 complete and pushed:** core MVP (drawing, Font View, kerning, UFO/`.glyphs` open), components/interpolation/feature preview (Phase 2), export fidelity with validation, compile service, and variable fonts (Phase 3), editing depth — side-by-side masters, Pencil, Measure, alignment (Phase 4), and OpenStep saving, smart components, mark positioning, cmap format 12 (Phase 5).
- **Phase 6 complete and pushed:** packaged Windows installer (Electron shell, native file dialogs, NSIS + portable builds) so the app launches as a desktop app without a terminal or browser. Verified: `npm install`, `npm test` (27/27), `npm run typecheck` (clean), and `npm run dist:win` all pass; `release/Glyphs for Windows-0.1.0-Setup.exe` and `release/Glyphs for Windows-0.1.0-Portable.exe` are produced, and the unpacked app launches and stays running. Pushed as `c7b2858`.

## Roadmap — Phases 7–12 (from the Glyphs 4 Handbook analysis)

The Handbook (294 pages, 18 chapters) was mapped against Phases 1–6. Well covered: Edit View basics, Font View, spacing/kerning core, components and smart components, interpolation, font export, UFO/OpenStep interchange, and desktop packaging. Partial: feature code (subset only), Font Info, preview, and Palette. Not covered: most Filters, glyph-info/batch tooling, master-compatibility checking, corner/brush components, hinting, color fonts, app Settings, and Extensions. Phases proceed in this order, each shipped plan → implement → verify → commit on the user's word:

- **Phase 7 — Release completeness (complete and pushed as `5a8c9eb`):** bundle the `tools/fontc` compile service as a sidecar the Electron shell starts and health-checks automatically, add a real app icon, and include the service in `npm run dist:win`. Code signing stays deferred until a certificate exists. Verified: `npm test` (29/29), `npm run typecheck` (clean), `npm run dist:win` produces both installers with `resources/fontc/fontc.exe` packaged; the packaged app auto-starts the sidecar (health: fontTools 4.67.0, ufo2ft and brotli available), compiles a real WOFF2 (`wOF2`) and a variable font (fontTools readback shows `fvar` wght 400–700) with nothing started by hand, and the sidecar stops when the app quits. A first `--onefile` build orphaned its child process on stop, so the sidecar ships `--onedir`.
- **Phase 8 — Automatic features and export proofing (complete and pushed as `3fa8b3d`):** generate `kern`/`mark`/`mkmk`/ligature feature code from kerning, anchors, and glyph names; automatic vs manual code in Font Info; read every export back with fontTools, blocking on failure. Verified: `npm test` (37/37) and `npm run typecheck` (clean); the live service validates a real TTF (12 glyphs, 11 cmap mappings), rejects corrupt bytes with HTTP 400, and compiles a variable font whose readback contains a GPOS `kern` feature built from the generated `features.fea`; the packaged app serves the same `/validate` endpoint from its bundled sidecar and stops it on quit. Browser exports with the service offline deliver with an explicit no-proof warning; desktop exports block instead.
- **Phase 9 — Drawing depth II (complete and pushed as `e87995f`):** Filters (Add Extremes, Round Corners, Offset Curve), path cutting, duplicate-node detection, re-segmenting, Fit Curve, and backup layers. Verified: `npm test` (46/46) and `npm run typecheck` (clean) — including a cubic-extremes peak test at exact coordinates, offset expand/shrink/collapse tests, and backup round-trips through `.glyphs` JSON and OpenStep; `npm run dist:win` rebuilds both installers, and a CDP playthrough of the packaged app saved/listed/restored a backup layer, applied Offset Curve to 2 contours, and exercised the Cut Path selection guard. Two bugs were caught by tests on the way: a cubic-split recursion error and offset collapse detection when opposing edges cross.
- **UI/UX pass before Phase 10 (complete):** light Glyphs-like theme, Font/Edit workspace switch, category/language rails, glyph-details pane, Grid/List in both workspaces, scaling thumbnails, click-operated menus with `aria-expanded` and Escape handling, and an honest selected/shown/total status line. Verified: `npm test` (50/50, including the Font View tests in `test/fontview.test.ts`), `npm run typecheck` (clean), and `npm run build` (pass).
- **Phase 10 — Font View and glyph data (complete):** glyph-info database (`src/glyphinfo.ts`: letters, digits, punctuation/symbols, production aliases) with suggestions in the Inspector and on glyph creation; rename that rewrites component bases, metrics keys, and kerning pairs; batch operations (apply glyph info to the font, set category for the shown glyphs, move the selected glyph in the font order); Font View filters (Unicode/outline/empty/composite/color) and display sorting (font order, name, Unicode); and production name, tags, color label, case, script override, and note fields on the model, edited in the Inspector, shown in the glyph-details panel, and round-tripped through `.glyphs` JSON, OpenStep saves, and UFO GLIF (`<note>` plus a `com.glyphswindows.*` lib).
- **Phase 11 — Interpolation pro (complete):** master-compatibility report in Font Info (missing layer, contour/node count, closed mismatch, and intermediate-structure issues) with one-click copy-base-layer fixes; instances editor (name, active flag, axis weight, style link, per-instance UFO export, add/delete); intermediate (brace) layers captured from the active layer at a weight, loaded back for editing, used as piecewise interpolation stops, and round-tripped through `.glyphs`; and variable-axis settings (name/tag/min/default/max plus per-master weights) in Font Info feeding the designspace bundle the compile service builds variable fonts from. The service still builds a single axis; multi-axis is deferred.
- **Pre-Phase 12 UI/UX ramp (R1–R3 complete):** complete the reference-driven interface and workflow ramp described below before starting new Phase 12 font-engine capabilities. R1 established the adaptive shell, R2 delivered professional Font View density and selection, and R3 completed the continuous Edit View drawing/spacing/proofing workflow. The remaining work is R4 contextual Palette behavior, R5 visual master/interpolation workflows, and R6 workflow hardening.
- **Phase 12 — Later candidates:** corner/cap/segment/brush components and Pixel tool; COLR/CPAL color fonts; PostScript/TrueType autohinting toggles (manual hinting UI stays deferred); app Settings, sample strings, and shortcuts; scripts/plug-ins; signing and auto-update once a certificate exists.

## Pre-Phase 12 UI/UX Ramp — Reference Comparison and Delivery Plan

### Design Direction

Use the classic Glyphs desktop screenshots for durable information architecture—taxonomy sidebar, dense grid/list Font View, contextual right Palette, compact toolbar, and bottom status/zoom controls—and use the newer screenshots for interaction behavior: lower chrome, a larger drawing surface, contextual expert tools, visual master comparison, ghost outlines, and in-context instance proofing.

The target is not a pixel copy of macOS. It is a Windows-native professional type-design workspace that matches the reference product's task flow, density, hierarchy, and directness while retaining Windows menus, Ctrl-based shortcuts, native dialogs, Segoe UI typography, browser fallback behavior, and original icons/assets.

### Current Product Assessment

The `54d8f14` redesign establishes a credible shell: unified Font View/glyph tabs, compact icon tools, a dominant editor canvas, collapsible navigator/inspector/preview regions, a contextual glyph information strip, visible focus states, and responsive behavior.

The remaining gap is workflow fidelity rather than generic visual polish:

- **Font View:** grid/list, search, filters, and counts exist, but the workspace lacks the reference product's scalable density, sticky table structure, multi-selection workflow, and integrated taxonomy/details model.
- **Edit View:** the canvas is appropriately dominant, but navigation, guide hierarchy, text/edit-mode feedback, zoom controls, and selection feedback need further refinement.
- **Inspector and Palette:** functionality exists but remains distributed across six equal-weight tabs and long forms. The reference product uses contextual, collapsible sections and visual controls.
- **Masters and interpolation:** the data model supports masters, instances, intermediate layers, and compatibility checking, but the UI does not yet make overlays, layer visibility, intermediate stops, or instance progression visually understandable.
- **Direct manipulation:** nodes, handles, alignment, transforms, and filters work, but expert operations should appear near the work with live previews instead of permanently increasing sidebar complexity.

### Ramp R1 — Shell Normalization (complete)

Lock the final application density and workspace behavior before redesigning individual tools:

- Normalize browser and Electron chrome so the same document hierarchy is recognizable in both environments.
- Tune toolbar metrics, icon sizing, separator rhythm, canvas tone, guide contrast, and panel dividers.
- Add reliable resizable splitters, panel-width persistence, panel visibility persistence, and a compact zoom/navigation HUD.
- Keep the toolbar on one row; secondary commands stay in contextual popovers or overflow.

**Exit gate:** no toolbar wrapping, clipped controls, or layout jumps at 1280×720, 1440×900, and 1920×1080, including Windows scaling at 125% and 150%.

**Completed 2026-10-18:** the workspace now has persistent keyboard-accessible splitters, remembered panel visibility and dimensions, a resizable Preview, an in-canvas glyph/zoom HUD, camera-preserving resize behavior, content-driven toolbar overflow, dynamic panel labels, and a reset-layout command. Browser and Electron captures passed at 100%, 125%, and 150% effective scaling with no toolbar or document overflow; the full suite passed with 67 tests plus clean typecheck and production build.

### Ramp R2 — Font View Parity (complete)

Turn Font View into a production workspace for fonts containing hundreds or thousands of glyphs:

- Rebuild Grid View around glyph-first cells whose labels and metadata adapt to cell size.
- Rebuild List View as a dense table with sticky headers, resizable columns, predictable keyboard navigation, and visible export/status fields.
- Support multi-selection, Shift-range selection, Ctrl-toggle selection, and batch actions without losing the current search/filter context.
- Integrate category/language taxonomy, saved filters, search, selected-glyph details, selected/visible/total counts, add/remove controls, and the cell-size slider into one coherent layout.
- Preserve selection, filters, sort order, scroll position, and cell size when switching between Grid and List.

**Exit gate:** fonts containing 100–1,000 glyphs remain fast and scannable; Grid/List switching preserves state; keyboard and mouse selection behave consistently.

**Completed 2026-10-18:** Font View now has size-adaptive glyph-first cells with lazy thumbnail work, a dense sticky-header List with ten resizable data columns plus selection, visible export and outline/component/empty status, persistent Grid/List density and column preferences, named saved filter presets, selection-aware details and batch actions, and Windows-style click/Ctrl-toggle/Shift-range behavior shared by mouse and keyboard. Search, taxonomy, filter, sort, selection, scroll position, and cell size survive Grid/List switching. Verification covered the default font in both views at 1440×900, Ctrl+A plus filtered hidden-selection counts, preset save/restore, and a generated 1,000-glyph font (1,000 cells rendered in about 300 ms with initial/lazy thumbnails and no document overflow), alongside 70 passing tests, clean typecheck, and a production build.

### Ramp R3 — Edit View Refinement

Make drawing, spacing, navigation, and proofing feel continuous:

- Increase the compact navigator's information density and add task-aware grouping/search behavior.
- Establish clear Text/Edit modes and unambiguous active-pane/tool feedback.
- Refine metric, guide, ghost, node, handle, and selection semantics so construction geometry never competes with the outline.
- Keep the glyph information box attached to the canvas and expose the relevant spacing/kerning values contextually.
- Allow Preview to dock, collapse, resize, and remember its state without stealing canvas space.
- Add consistent pan, zoom, fit, previous/next glyph, and status feedback near the canvas.

**Exit gate:** drawing, spacing, glyph navigation, and proofing can be completed without repeatedly opening the long Inspector form.

**Completed 2026-10-18:** the compact navigator now uses dense grouped thumbnails with All, Related, and Open task scopes plus name/Unicode/tag search; Edit and Text are explicit modes with persistent active-tool feedback and clear split-pane focus; Space temporarily pans while Alt+Left/Right, nearby HUD controls, wheel zoom, and Fit keep navigation on-canvas. Metrics, guides, bearings, ghost outlines, handles, and selected nodes now have distinct visual weights. The attached information strip adds live preview-pair kerning beside LSB/width/RSB and selection/master state. Preview remains collapsible and resizable, can dock below or to the right with independent remembered dimensions, and expands automatically for Text mode. Verification covered bottom-docked Edit/Text states and the right-docked layout at 1440×900 with no document overflow, 72 passing tests, clean typecheck, and a production build.

### Ramp R4 — Contextual Palette

Replace the current tab-heavy form panel with a contextual professional Palette:

- Organize Dimensions, Fit Curve, Layers, Transformations, Components, Filters, and backup layers as collapsible sections.
- Show only sections relevant to the current selection, tool, glyph, or workspace.
- Replace text-heavy transformation fields with visual origin matrices, lock controls, steppers, rotate/skew/flip icons, alignment controls, and immediate feedback.
- Give Layers a visual list with active state, visibility, master/intermediate identity, and relevant add/remove actions.
- Move Font Info, Features, and Export into focused surfaces or dialogs instead of treating them as equal editing tabs.
- Remember open sections and commonly used values per document where safe.

**Exit gate:** the right panel changes meaningfully with context, common transformations are visually discoverable, and advanced workflows no longer crowd basic glyph editing.

### Ramp R5 — Masters, Interpolation, and Proofing

Expose the Phase 11 model visually before adding more interpolation capabilities:

- Add a master/layer browser with active, visible, hidden, and intermediate-layer states.
- Provide overlay, split, and side-by-side comparison modes with controllable ghost outlines.
- Show intermediate-layer positions along the weight axis and make incompatibility locations visible near the affected glyph/layer.
- Add previous/next master and axis-position navigation without leaving Edit View.
- Add an instance progression preview so designers can inspect interpolation results continuously across the axis.
- Keep compatibility fixes and per-instance export available from the visual workflow instead of only from Font Info.

**Exit gate:** a user can visually compare masters, locate intermediate stops, recognize compatibility problems, and proof instances without switching to a separate diagnostic tab.

### Ramp R6 — Workflow Hardening and Release Gate

Finish the UI as a reliable Windows desktop product:

- Add consistent context menus, tooltips, shortcut discovery, disabled/loading/error states, and instructional empty states.
- Verify full keyboard traversal, visible focus, screen-reader labels, contrast, reduced motion, and high-DPI rendering.
- Ensure popovers and contextual tools escape scroll/overflow containers correctly.
- Capture screenshot baselines for Font Grid, Font List, Edit View, split masters, collapsed panels, and focused workflows.
- Run browser and packaged Electron playthroughs for open → edit → space/kern → interpolate → preview → export.

**Exit gate:** all existing 65 tests pass; `npm run typecheck` and `npm run build` pass; critical UI workflows pass at three viewport sizes and two DPI levels; packaged Electron behavior matches the browser build where platform APIs do not intentionally differ.

### Scope Boundaries

- Preserve the existing font model, geometry, shaping, interchange, compile-service, validation, and export behavior throughout the ramp.
- Do not hide new font-engine work inside UI phases. Slanter-style geometry, corner/brush components, multi-axis interpolation math, hinting, color fonts, plug-ins, and other Phase 12 candidates remain deferred.
- Use the reference product's workflow and hierarchy, not its logo, proprietary artwork, or macOS window chrome.
- Keep the browser fallback functional and keep Windows-native menus, shortcuts, focus behavior, and file dialogs in the Electron application.
- Deliver in the order **R1 → R2 → R3 → R4 → R5 → R6**, with visual and interaction verification after every ramp. Move R5 ahead of R4 only if interpolation becomes the immediate product priority.

## Explicit Non-Goals

- Full Glyphs parity — it is a multi-year commercial product; this project targets the professional core workflow, not every handbook page.
- Corner/brush components, full complex-script OpenType shaping, manual TrueType/PostScript hinting UIs, color fonts, and a plug-in system (candidates for later phases).
- Bundling the Python compile service into the app in Phase 6; WOFF2/variable export degrades with a clear status message when the service is offline.
- Code signing in Phase 6 (requires a purchased certificate; the unsigned-installer SmartScreen warning will be documented).

## Success Definition

The project succeeds when a Windows user can install the app, design a multi-master font family with kerning and components, and export OTF/TTF/WOFF2/variable fonts that pass external validation and render as designed in other tools — and when every step of that claim is backed by tests and observed verification rather than assertion.
