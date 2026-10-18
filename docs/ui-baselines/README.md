# UI baselines (R5/R6, 2026-10-18)

Headless Edge captures of the Vite dev build (`npm run dev`, http://127.0.0.1:5173/).
Regenerate after intentional layout changes and diff against these files.

| File | State |
| --- | --- |
| `edit-1440.png` | Edit View, single master, 1440×900 |
| `edit-1280.png` | Edit View, 1280×720 |
| `edit-1920.png` | Edit View, 1920×1080 |
| `edit-150pct.png` | Edit View, 1440×900 at 150% device scale |
| `overlay-1440.png` | Two masters, Overlay compare, axis t=0.50 |
| `split-1440.png` | Two masters, Split compare, interpolated proof on |
| `fontview-1440.png` | Font View after the R5 playthrough |

Verified alongside: `npm test` (75/75), `npm run typecheck` (clean),
`npm run build` (pass), CDP playthrough 13/13 (add master → overlay →
scrub morph → split → proof preview → shortcuts → context menu → Font View),
and the packaged Electron build (built outside `Downloads`, where Windows
locks the in-place rename) launching with the bundled `fontc` sidecar
healthy (fontTools 4.67.0).
