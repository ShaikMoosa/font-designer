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
- **Every behavior change carries maintained tests** (`npm test`, currently 21 tests) in the repository's own test layout.
- **Independent verification:** exported fonts are read back by external tools (fontTools), and UI behavior is proven with a headless-browser playthrough before any feature is called done — a feature is not done because code exists, it is done because its effect was observed.
- **Honest subset labelling:** wherever the app implements less than full Glyphs/OpenType behavior (feature-code subset, quadratic curve conversion, unmodelled `.glyphs` fields), the UI and README say so plainly instead of implying parity.
- **Per-phase delivery:** work ships in reviewed phases (plan → implement → verify → commit on the user's word), published to `github.com/ShaikMoosa/font-designer`.

## Current Status

- **Phases 1–5 complete and pushed:** core MVP (drawing, Font View, kerning, UFO/`.glyphs` open), components/interpolation/feature preview (Phase 2), export fidelity with validation, compile service, and variable fonts (Phase 3), editing depth — side-by-side masters, Pencil, Measure, alignment (Phase 4), and OpenStep saving, smart components, mark positioning, cmap format 12 (Phase 5).
- **Phase 6 planned:** packaged Windows installer (Electron shell, native file dialogs, NSIS + portable builds) so the app launches as a desktop app without a terminal or browser.

## Explicit Non-Goals

- Full Glyphs parity — it is a multi-year commercial product; this project targets the professional core workflow, not every handbook page.
- Corner/brush components, full complex-script OpenType shaping, manual TrueType/PostScript hinting UIs, color fonts, and a plug-in system (candidates for later phases).
- Bundling the Python compile service into the app in Phase 6; WOFF2/variable export degrades with a clear status message when the service is offline.
- Code signing in Phase 6 (requires a purchased certificate; the unsigned-installer SmartScreen warning will be documented).

## Success Definition

The project succeeds when a Windows user can install the app, design a multi-master font family with kerning and components, and export OTF/TTF/WOFF2/variable fonts that pass external validation and render as designed in other tools — and when every step of that claim is backed by tests and observed verification rather than assertion.
