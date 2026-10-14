// Pre-export validation over the Font model. Errors block binary export;
// warnings export with the report attached to the status line.
import { contourArea, findGlyph, glyphBounds } from "./model.ts";
import type { Font } from "./model.ts";

export interface ValidationIssue { severity: "error" | "warn"; message: string }
export interface ValidationReport { errors: ValidationIssue[]; warnings: ValidationIssue[]; ok: boolean }

export function validateFont(font: Font): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const err = (message: string) => errors.push({ severity: "error", message });
  const warn = (message: string) => warnings.push({ severity: "warn", message });

  const names = new Set<string>();
  for (const g of font.glyphs) {
    if (names.has(g.name)) err(`Duplicate glyph name "${g.name}".`);
    names.add(g.name);
  }
  const byUnicode = new Map<number, string>();
  for (const g of font.glyphs) {
    if (g.unicode == null) continue;
    const prev = byUnicode.get(g.unicode);
    if (prev) err(`Unicode U+${g.unicode.toString(16).toUpperCase()} is used by both "${prev}" and "${g.name}".`);
    else byUnicode.set(g.unicode, g.name);
    if (g.unicode > 0xffff) warn(`"${g.name}" is outside the BMP; the TTF cmap (format 4) will omit it.`);
  }
  const masterId = font.currentMasterId;
  for (const g of font.glyphs) {
    for (const comp of g.components || []) {
      if (!findGlyph(font, comp.glyph)) err(`"${g.name}" references missing component "${comp.glyph}".`);
    }
    const layer = g.layers[masterId];
    if (!layer) continue;
    for (const c of layer.paths) {
      if (!c.closed && c.nodes.length) warn(`"${g.name}" has an open contour; TTF export closes it implicitly.`);
      if (c.closed && c.nodes.length >= 3 && contourArea(c) < 0) {
        warn(`"${g.name}" has a clockwise contour; run Palette → Fix path direction.`);
      }
    }
    if (g.unicode != null && g.name !== "space" && !layer.paths.length && !(g.components || []).length) {
      warn(`Encoded glyph "${g.name}" has no outlines.`);
    }
    const b = glyphBounds(g, masterId);
    if (b && (g.width <= 0)) warn(`"${g.name}" has non-positive width ${g.width}.`);
  }
  for (const key of Object.keys(font.kerning || {})) {
    const [l, r] = key.split("|");
    if (!findGlyph(font, l) || !findGlyph(font, r)) warn(`Kerning pair "${key.replace("|", " → ")}" references a missing glyph.`);
  }
  if (font.masters.length >= 2) {
    for (const g of font.glyphs) {
      const counts = font.masters.map((m) => {
        const layer = g.layers[m.id];
        if (!layer) return -1;
        return layer.paths.reduce((n, c) => n + c.nodes.length, 0) + layer.paths.length * 1000;
      });
      if (new Set(counts).size > 1) {
        warn(`"${g.name}" differs across masters (${counts.join(" vs ")} nodes/contours); interpolation and variable export will skip or fail for it.`);
      }
    }
  }
  return { errors, warnings, ok: errors.length === 0 };
}
