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
- **Every behavior change carries maintained tests** (`npm test`, currently 82 tests) in the repository's own test layout.
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
- **Pre-Phase 12 UI/UX ramp (R1–R6 complete, 2026-10-18):** complete the reference-driven interface and workflow ramp described below before starting new Phase 12 font-engine capabilities. R1 established the adaptive shell, R2 delivered professional Font View density and selection, R3 completed the continuous Edit View drawing/spacing/proofing workflow, R4 replaced the long tab panel with a contextual professional Palette, R5 added the visual Masters bar (layer browser, Overlay/Split compare with ghost opacity, weight-axis track with intermediate stops, instance progression proofing, inline compatibility fixes), and R6 hardened workflow states, context menus, shortcut discovery, and screenshot baselines. Verified: `npm test` (75/75), `npm run typecheck` (clean), `npm run build` (pass), CDP playthrough 13/13, baselines in `docs/ui-baselines/`, and the packaged Electron build launching with a healthy bundled sidecar. Next: scope exactly one Phase 12 candidate in its own plan.
- **Phase 12 — Later candidates:** corner/cap/segment/brush components and Pixel tool; COLR/CPAL color fonts; PostScript/TrueType autohinting toggles (manual hinting UI stays deferred); app Settings, sample strings, and shortcuts (slice 1 complete 2026-10-18: Settings dialog with configurable compile-service URL, editor/preview defaults, custom sample strings with built-in Latin/figures/kerning/Greek/Cyrillic proofs — shortcuts landed in R6); scripts/plug-ins; signing and auto-update once a certificate exists. Remaining candidates still need one-at-a-time plans.

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

### Ramp R4 — Contextual Palette (complete)

Replace the current tab-heavy form panel with a contextual professional Palette:

- Organize Dimensions, Fit Curve, Layers, Transformations, Components, Filters, and backup layers as collapsible sections.
- Show only sections relevant to the current selection, tool, glyph, or workspace.
- Replace text-heavy transformation fields with visual origin matrices, lock controls, steppers, rotate/skew/flip icons, alignment controls, and immediate feedback.
- Give Layers a visual list with active state, visibility, master/intermediate identity, and relevant add/remove actions.
- Move Font Info, Features, and Export into focused surfaces or dialogs instead of treating them as equal editing tabs.
- Remember open sections and commonly used values per document where safe.

**Exit gate:** the right panel changes meaningfully with context, common transformations are visually discoverable, and advanced workflows no longer crowd basic glyph editing.

**Completed 2026-10-18:** the right sidebar now opens as a contextual Palette with remembered collapsible Dimensions, Transformations, Layers, Components, Fit Curve, Filters, and Backup layers. Sections hide when they do not apply to the current glyph or master. Transformations provide a 3×3 origin matrix, linked or independent X/Y scale, move, rotate, skew, flip, and selection-alignment controls with a live value summary. Layers use a visual list with active/master identity, working visibility toggles, master switching, intermediate-layer actions, and backup access. Font Info, Features, and Export moved out of the editing tabs into one focused document-workflow dialog. Verification covered section persistence, layer hide/show, a transform plus undo, workflow switching, and 1440×900 and 1280×720 layouts with no document overflow, alongside 73 passing tests, clean typecheck, and a production build.

### Ramp R5 — Masters, Interpolation, and Proofing

Expose the Phase 11 model visually before adding more interpolation capabilities:

- Add a master/layer browser with active, visible, hidden, and intermediate-layer states.
- Provide overlay, split, and side-by-side comparison modes with controllable ghost outlines.
- Show intermediate-layer positions along the weight axis and make incompatibility locations visible near the affected glyph/layer.
- Add previous/next master and axis-position navigation without leaving Edit View.
- Add an instance progression preview so designers can inspect interpolation results continuously across the axis.
- Keep compatibility fixes and per-instance export available from the visual workflow instead of only from Font Info.

**Exit gate:** a user can visually compare masters, locate intermediate stops, recognize compatibility problems, and proof instances without switching to a separate diagnostic tab.

**Completed 2026-10-18:** the Edit View Masters bar now provides master chips with contour/node counts and missing-layer state, overlay visibility toggles, prev/next master navigation (`[` / `]`), Off/Overlay/Split compare with ghost-opacity control, a weight-axis track showing master and intermediate stops, a five-step instance progression strip with interpolated proof-text toggle and proof UFO export, and inline compatibility status with copy-base-layer fixes (also in the Palette Layers section and Font Info with Open-glyph navigation). Pure helpers live in `src/model.ts` (`sortedMasters`, `weightForT`, `axisStopsForGlyph`, `issuesForGlyph`, `adjacentMaster`, `instanceProgression`, `layerSummaries`) with tests in `test/interpolation.test.ts`. Verified by the CDP playthrough (add master → overlay ghost → axis-scrub morph → split → proof preview) and baselines in `docs/ui-baselines/`.

### Ramp R6 — Workflow Hardening and Release Gate

Finish the UI as a reliable Windows desktop product:

- Add consistent context menus, tooltips, shortcut discovery, disabled/loading/error states, and instructional empty states.
- Verify full keyboard traversal, visible focus, screen-reader labels, contrast, reduced motion, and high-DPI rendering.
- Ensure popovers and contextual tools escape scroll/overflow containers correctly.
- Capture screenshot baselines for Font Grid, Font List, Edit View, split masters, collapsed panels, and focused workflows.
- Run browser and packaged Electron playthroughs for open → edit → space/kern → interpolate → preview → export.

**Exit gate:** all existing tests pass; `npm run typecheck` and `npm run build` pass; critical UI workflows pass at three viewport sizes and two DPI levels; packaged Electron behavior matches the browser build where platform APIs do not intentionally differ.

**Completed 2026-10-18:** glyph-grid and canvas context menus, a Keyboard Shortcuts dialog (View menu or `?`, including R5 `[` / `]` / `,` / `.` navigation), export busy/disabled states with `aria-busy`, Font View interpolation-warning badges, and retained focus-visible/reduced-motion/high-DPI behavior. Baselines for Edit View (1280×720, 1440×900, 1920×1080, 150% scale), Overlay, Split, and Font View are in `docs/ui-baselines/`. Verified: `npm test` (75/75), `npm run typecheck` (clean), `npm run build` (pass), CDP playthrough 13/13, and the packaged Electron build (output outside `Downloads`, where Windows locks the in-place rename) launching with the bundled `fontc` sidecar healthy (fontTools 4.67.0). In-place `npm run dist:win` currently stops at the same Windows rename lock (`EPERM` on `release/win-unpacked.tmp`); the identical packaging succeeds with an external output directory, so treat installer regeneration in `Downloads` as an environment retry, not a code failure.

## Phase 12 — Font-Engine Candidates (planned 2026-10-18)

Slice 1 (Settings, sample strings, shortcuts) is complete. The remaining candidates ship one phase at a time, in this order, each plan → implement → verify → commit/push on the user's word. No phase smuggles in the next phase's engine work.

### Phase 12A — Autohinting (TrueType, via compile service) (complete 2026-10-18)

Shipped: `Font.autohintTT` toggle in Font Info, round-tripped through `.glyphs` JSON/OpenStep and UFO/designspace manifests (reader included); browser TTF writes `gasp` (grayscale + symmetric smoothing, no gridfit claim); compile service detects the `ttfautohint-py` binary (`/health.ttfautohint`), exposes `POST /compile/autohint` with `X-Autohint-Applied`, and autohints variable builds whose manifest requests it; TTF/WOFF/WOFF2/variable exports report applied vs not-applied explicitly and never block on the hinter. Verified: `npm test` (82/82, `test/hinting.test.ts`), typecheck clean, live service hinted a real TTF (1,588 → 5,848 bytes; fontTools readback shows `fpgm`/`prep`/`cvt `/`gasp`, 12 glyphs, 11 cmap mappings, `/validate` ok).

- Per-font `autohintTT` toggle in Font Info (default off, opt-in), round-tripped through `.glyphs` JSON/OpenStep, UFO/designspace manifests.
- Browser TTF gains a correct `gasp` table for unhinted outlines; browser export status states plainly that bytecode hinting is applied only by the compile service.
- Compile service: detect an optional `ttfautohint` binary (`/health` reports it), add `POST /compile/autohint`, and apply it to variable builds whose manifest requests it. When the binary is unavailable the service returns the original bytes and reports not-applied — never a silent claim.
- **Exit gate:** toggle round-trips in tests; exported TTF lists `gasp`; with the service running, an autohint-requested export is read back by fontTools showing hinting tables (`fpgm`/`prep`/`cvt `) or an explicit not-applied status; full suite + typecheck + build pass.

### Phase 12B — Multi-axis interpolation (complete 2026-10-19)

Shipped: locations (`Record<tag, value>`) across the app — `masterLocation`/`instanceLocation`/`interpolateGlyphAtLocation` in `src/model.ts` (grid-corner masters blend bilinearly, exact at every master; single-axis fonts keep the piecewise path through brace layers), per-axis master/instance locations and add/remove-axis editing in Font Info, a Masters bar axis picker that holds other axes fixed, `.glyphs` axisValues round-trip, and a compile service that builds every declared axis (`/validate` now reports `fvarAxes`). Verified: `npm test` 86/86 (four new 12B tests in `test/interpolation.test.ts`), typecheck + build clean; live compile of a four-master wght×wdth bundle read back `fvar` wght 400/400/700 + wdth 75/100/125 with correct corner/centre instantiation; Edge CDP playthrough 11/11 (`verify12b.mjs`, shots `12b-fontinfo.png`/`12b-mastersbar.png`). Changes left uncommitted on `main` for review.

- Generalize the single-`wght` assumption: Font Info edits multiple axes, masters carry per-axis locations, interpolation evaluates at a multi-axis location, the Masters bar gains an axis picker, and the designspace bundle + compile service build a true multi-axis variable font.
- **Exit gate:** a two-axis (weight × width) variable font whose fontTools readback shows two `fvar` axes with correct ranges; single-axis fonts behave exactly as before.

### Phase 12C — Corner/brush components and Pixel tool

- New component kinds (corner, cap, segment, brush) on the model with editor rendering, Palette editing, and `.glyphs`/UFO round-trip; Pixel tool paints bitmap strikes for prototyping (export scope decided in the phase plan).
- **Exit gate:** each component kind survives a save/open round-trip and renders in editor + preview; incompatible exports label the subset honestly.

### Phase 12D — COLR/CPAL color fonts

- Per-glyph color layers + palette on the model, editor/preview rendering, and COLR/CPAL export through the compile service (browser writers label color as service-only).
- **Exit gate:** exported color font read back by fontTools contains `COLR`/`CPAL` with the authored layers/palette; monochrome export unchanged.

### Phase 12E — Scripts and plug-ins

- Design-first phase: threat model and sandbox design (no arbitrary code execution in the Electron renderer) must be written and reviewed before any implementation. Implementation, if approved, is a separate phase.

### Phase 12F — Signing and auto-update (blocked)

- Requires a purchased code-signing certificate. No work until a certificate exists; unsigned-installer SmartScreen note stays in the README meanwhile.

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
