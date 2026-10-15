// Shaping-preview subset: parses the feature-code subset documented in the
// Features panel (classes, ligature `sub`, kerning `pos`), shapes preview
// text into glyph + advance steps, and positions combining marks on base
// anchors (top/_top). Full OpenType shaping (complex scripts, mark-to-mark,
// GPOS) is intentionally out of scope and labelled in the UI.
import { findGlyph, resolveKern } from "./model.ts";
import type { Font, Glyph } from "./model.ts";

export interface ParsedFeatures {
  classes: Map<string, string[]>;
  subs: Array<{ from: string[]; to: string }>;
  poss: Map<string, number>;
}

export interface ShapedItem { name: string | null; char: string; advance: number; dx?: number; dy?: number }

export function isMarkGlyph(glyph: Glyph): boolean {
  if (glyph.category === "Mark") return true;
  if (glyph.unicode != null && glyph.unicode >= 0x300 && glyph.unicode <= 0x36f) return true;
  return glyph.name.endsWith("comb");
}

export function parseFeatureCode(code: string): ParsedFeatures {
  const classes = new Map<string, string[]>();
  const subs: ParsedFeatures["subs"] = [];
  const poss = new Map<string, number>();
  for (const raw of (code || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim().replace(/;$/, "");
    if (!line) continue;
    const classMatch = line.match(/^@(\w+)\s*=\s*\[([^\]]*)\]$/);
    if (classMatch) {
      classes.set(classMatch[1], classMatch[2].trim().split(/\s+/).filter(Boolean));
      continue;
    }
    const subMatch = line.match(/^sub\s+(.+?)\s+by\s+(\S+)$/);
    if (subMatch) {
      subs.push({ from: subMatch[1].trim().split(/\s+/).filter(Boolean), to: subMatch[2] });
      continue;
    }
    const posMatch = line.match(/^pos\s+(\S+)\s+(\S+)\s+(-?\d+)$/);
    if (posMatch) {
      const lefts = posMatch[1].startsWith("@") ? (classes.get(posMatch[1].slice(1)) ?? [posMatch[1]]) : [posMatch[1]];
      const rights = posMatch[2].startsWith("@") ? (classes.get(posMatch[2].slice(1)) ?? [posMatch[2]]) : [posMatch[2]];
      for (const l of lefts) for (const r of rights) poss.set(`${l}|${r}`, Number(posMatch[3]) || 0);
    }
  }
  return { classes, subs, poss };
}

export function shapeText(font: Font, text: string, parsed?: ParsedFeatures): ShapedItem[] {
  const features = parsed ?? parseFeatureCode(font.featureCode || "");
  const byChar = new Map<string, string>();
  for (const g of font.glyphs) {
    if (g.unicode != null) byChar.set(String.fromCodePoint(g.unicode), g.name);
  }
  const chars = [...text];
  const names: Array<string | null> = chars.map((ch) => byChar.get(ch) ?? null);
  // Ligatures: longest match first (up to 3 glyphs), only when target exists.
  const out: ShapedItem[] = [];
  let i = 0;
  const seq: Array<{ name: string | null; char: string }> = [];
  while (i < names.length) {
    let consumed = 0;
    let ligName: string | null = null;
    for (const sub of features.subs) {
      const len = sub.from.length;
      if (len < 2 || i + len > names.length) continue;
      if (!findGlyph(font, sub.to)) continue;
      let ok = true;
      for (let k = 0; k < len; k++) if (names[i + k] !== sub.from[k]) { ok = false; break; }
      if (ok && len > consumed) { consumed = len; ligName = sub.to; }
    }
    if (ligName && consumed) {
      seq.push({ name: ligName, char: chars.slice(i, i + consumed).join("") });
      i += consumed;
    } else {
      seq.push({ name: names[i], char: chars[i] });
      i += 1;
    }
  }
  let prevGlyph: Glyph | undefined;
  for (let k = 0; k < seq.length; k++) {
    const item = seq[k];
    if (!item.name) { out.push({ name: null, char: item.char, advance: 0 }); continue; }
    const glyph = findGlyph(font, item.name);
    if (glyph && isMarkGlyph(glyph) && prevGlyph) {
      // Mark: zero advance, positioned over the preceding base glyph.
      // Anchor pair top (base) / _top (mark) wins; without anchors the
      // mark is centred over the base at cap height.
      const baseAnchor = prevGlyph.anchors?.find((a) => a.name === "top");
      const markAnchor = glyph.anchors?.find((a) => a.name === "_top");
      const dx = baseAnchor && markAnchor ? baseAnchor.x - markAnchor.x : Math.round(prevGlyph.width / 2);
      const dy = baseAnchor && markAnchor ? baseAnchor.y - markAnchor.y : font.capHeight;
      out.push({ name: item.name, char: item.char, advance: 0, dx, dy });
      continue;
    }
    let advance = glyph?.width ?? 0;
    const next = seq[k + 1]?.name;
    if (next) {
      const featurePos = features.poss.get(`${item.name}|${next}`);
      advance += featurePos !== undefined ? featurePos : resolveKern(font, item.name, next);
    }
    out.push({ name: item.name, char: item.char, advance });
    if (glyph) prevGlyph = glyph;
  }
  return out;
}
