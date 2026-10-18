# Glyphs for Windows — Product Context
<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Independent type designers, students, small foundries, and lettering professionals who work primarily on Windows and need a serious visual font editor without changing operating systems.

## Product Purpose

Provide a focused desktop workspace for drawing glyph outlines, managing glyph sets and masters, spacing and kerning, authoring OpenType features, and exporting usable font files.

## Positioning

A Windows-native-feeling type design editor with a workflow familiar to experienced Glyphs users. It should feel precise, calm, dense, and canvas-first rather than like a generic web dashboard.

## Operating Context

The product runs in Electron on Windows with a browser development surface. Users work in long sessions with a keyboard and mouse, move repeatedly between Font View and Edit View, and expect native file dialogs, Windows shortcuts, high-DPI rendering, and safe undoable editing.

## Capabilities and Constraints

- Preserve the existing Phase 1–11 font editing features and TypeScript/Electron architecture.
- The redesign may reorganize navigation and controls, but must not remove existing commands.
- Font View and Edit View share one document window.
- Support the existing `.glyphs`, UFO, OTF, TTF, WOFF, and variable-font workflows.
- Use original interface icons and assets. Do not copy the Glyphs logo or proprietary artwork.
- Use Windows conventions for keyboard shortcuts, menus, focus, and dialogs.
- This UI phase improves presentation and workflow; it does not add new font-engine capabilities.

## Brand Commitments

The working name is “Glyphs for Windows.” The visual reference is Glyphs 4’s information architecture, compact density, and direct-manipulation workflow, adapted into an original Windows product interface.

## Evidence on Hand

- Repository README, GOAL, tests, and current product implementation.
- Current Edit View screenshot captured before redesign.
- Official Glyphs product overview and handbook pages for Font View, Edit View, Palette, Info Box, and appearance.

## Product Principles

1. Keep the glyph and its outline visually dominant.
2. Put frequently repeated actions one click or one shortcut away.
3. Reveal advanced controls contextually instead of filling the canvas with permanent UI.
4. Make mode and selection state unmistakable.
5. Preserve user work with visible status, undo, and predictable file operations.
6. Prefer compact native-feeling controls over decorative cards and marketing-style surfaces.

## Accessibility & Inclusion

All primary actions must be keyboard reachable, focus must remain visible, control labels must be available to assistive technology, text and icon contrast must be legible, and motion must respect reduced-motion settings. Layouts should remain usable on common laptop resolutions and at Windows display scaling above 100%.
