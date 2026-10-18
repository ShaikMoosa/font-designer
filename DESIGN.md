---
name: Glyphs for Windows
description: A calm, precise Windows workspace for professional type design.
colors:
  precision-blue: "#0a64d8"
  precision-blue-soft: "#dceafb"
  drawing-white: "#ffffff"
  chrome-gray: "#f2f2f3"
  sidebar-gray: "#e8e8ea"
  panel-gray: "#f8f8f9"
  divider-gray: "#cfcfd3"
  ink: "#202024"
  secondary-ink: "#686870"
  active-ink: "#064f9f"
  active-border: "#9fc2ee"
  selection-border: "#98bee9"
  strong-divider: "#b8b8be"
  deep-neutral: "#303034"
  subdued-neutral: "#a8a8ae"
  guide-orange: "#e69a32"
  smooth-green: "#2fa568"
typography:
  title:
    fontFamily: "Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.35
  mono:
    fontFamily: "Cascadia Mono, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.35
  view-title:
    fontFamily: "Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
  glyph-preview:
    fontFamily: "Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 400
    lineHeight: 1
rounded:
  tight: "3px"
  control: "4px"
  tab: "5px"
  popover: "6px"
spacing:
  compact: "4px"
  control: "8px"
  panel: "12px"
  section: "16px"
components:
  button-active:
    backgroundColor: "{colors.precision-blue-soft}"
    textColor: "{colors.precision-blue}"
    rounded: "{rounded.control}"
    height: "28px"
  input:
    backgroundColor: "{colors.drawing-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "27px"
---

# Design System: Glyphs for Windows

## Overview

**Creative North Star: "The Precision Workspace"**

This interface behaves like a professional drawing instrument: quiet at rest, exact in response, and dense enough for long type-design sessions. It takes its structural cues from Glyphs 4—unified Font and Edit views, compact tool chrome, contextual side panels, and a live preview—while retaining an original Windows presentation and icon set.

**Key Characteristics:**

- Canvas-first composition with collapsible support panels.
- Compact native-feeling controls instead of web-dashboard cards.
- Neutral tonal layers with one disciplined blue interaction accent.
- Original line icons, visible focus, and tabular numeric readouts.

## Colors

The palette is a cool-neutral workshop with precision blue reserved for active tools, focus, tabs, and selection. Orange marks guides and measurement geometry; green is reserved for smooth-node semantics and successful status.

**The One Accent Rule.** Blue communicates interaction state and should not become decorative surface color.

## Typography

**Display Font:** Segoe UI Variable (with Segoe UI and system fallbacks)

**Body Font:** Segoe UI Variable (with Segoe UI and system fallbacks)

**Label/Mono Font:** Cascadia Mono for coordinates, Unicode, measurements, and feature code only.

**Character:** Neutral, crisp, and familiar on Windows. Weight and spacing establish hierarchy; oversized text is unnecessary in the application shell.

### Hierarchy

- **Title** (600, 13px, 1.35): panel, glyph, and document titles.
- **Body** (400, 12px, 1.35): controls, values, and explanatory text.
- **Label** (400, 11px, 1.35): field labels and compact metadata.

**The Numbers Stay Still Rule.** Metrics and coordinates use tabular or monospace numerals so edits do not visually jump.

## Layout

The default Edit View is a three-column workspace: a 220px glyph navigator, a fluid drawing canvas, and a 286px inspector. A 38px document bar and 31px tab strip establish hierarchy above the workspace. The toolbar remains one row; less-frequent path and alignment operations live in compact popovers. The information strip is attached directly below the canvas, and Preview is independently collapsible.

At 1180px the side panels contract. At 980px secondary document controls simplify. Below 820px the compact glyph navigator yields to the canvas. Font View expands the glyph browser into the main workspace and adds its category rail.

## Elevation & Depth

The system is flat by default. Tonal changes and one-pixel dividers establish the document hierarchy. Shadows appear only on floating menus and popovers, where they clarify temporary elevation.

**The Flat Canvas Rule.** Permanent panes never use drop shadows; the white drawing surface remains visually uninterrupted.

## Shapes

Controls use compact 4px corners; menus and popovers use 6px corners. Glyph cells, tabs, and fields rely on thin borders and small radii. Large pills, decorative blobs, and card stacks do not belong in this workspace.

## Components

### Buttons

- **Shape:** compact rectangle with gently rounded corners (4px) and a 26–28px height.
- **Active:** pale precision-blue fill, blue outline, and dark blue icon/text.
- **Hover / Focus:** neutral gray hover; 2px blue focus outline with 1px offset.

### Inputs / Fields

- **Style:** white surface, one-pixel divider-gray stroke, compact internal padding, and tabular numeric values where applicable.
- **Focus:** blue focus outline without layout shift.

### Navigation

Document tabs share one strip: Font View remains first and open glyphs follow. The active tab joins the white workspace and carries a narrow blue top edge. The right inspector uses three primary task tabs plus visibly secondary workflow tabs.

### Glyph Cells

Glyph cells are borderless at rest, gain a light neutral hover, and use a pale blue selected surface with a blue edge. The glyph drawing is always more prominent than its name and Unicode metadata.

### Drawing Nodes

Corner nodes use blue square geometry, handles use restrained gray, selection deepens to precision blue, and guides use orange. State must remain legible against the white drawing canvas at common Windows scaling settings.

## Do's and Don'ts

### Do:

- **Do** let the canvas remain the largest uninterrupted surface.
- **Do** keep common tools visible and move advanced commands into compact contextual groups.
- **Do** pair icon-only controls with tooltips, accessible names, and keyboard shortcuts.
- **Do** preserve Windows-native menus, shortcuts, focus, and dialogs in the Electron shell.

### Don't:

- **Don't** copy the Glyphs logo, macOS window chrome, or proprietary artwork.
- **Don't** use oversized typography, marketing gradients, or decorative card layouts in the editor.
- **Don't** make permanent panels compete with the glyph; every supporting region must collapse or adapt.
- **Don't** use blue decoratively when it could be mistaken for selection or focus.
