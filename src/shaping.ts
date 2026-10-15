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

export interface GeneratedFeatures {
  code: string;
  parsed: ParsedFeatures;
  kernPairs: number;
  groupPairs: number;
  ligatures: number;
  markAttachments: number;
  markToMark: number;
}

const FEA_NAME = /^[\w.\-+]+$/;
const KNOWN_LIGATURES: Record<string, string[]> = {
  ff: ["f", "f"], fi: ["f", "i"], fl: ["f", "l"],
  ffi: ["f", "f", "i"], ffl: ["f", "f", "l"],
  ft: ["f", "t"], st: ["s", "t"],
};

function className(prefix: string, group: string): string {
  return `${prefix}_${group.replace(/[^\w]/g, "_")}`;
}

function ligatureSequences(font: Font): Array<{ from: string[]; to: string }> {
  const out: Array<{ from: string[]; to: string }> = [];
  const seen = new Set<string>();
  const add = (from: string[], to: string) => {
    if (from.length < 2) return;
    if (!from.every((n) => findGlyph(font, n)) || !findGlyph(font, to)) return;
    const key = from.join(" ");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ from, to });
  };
  for (const g of font.glyphs) {
    const base = g.name.replace(/\.liga$/, "");
    if (KNOWN_LIGATURES[base]) add(KNOWN_LIGATURES[base], g.name);
    if (g.name.includes("_")) add(g.name.split("_").filter(Boolean), g.name);
  }
  return out.sort((a, b) => b.from.length - a.from.length || a.to.localeCompare(b.to));
}

/** Automatic feature code from kerning, kerning groups, anchors, and
 * ligature glyph names, as Adobe FEA-flavoured text plus the parsed
 * form the preview shapes with. Exact pairs precede group pairs in the
 * text (exceptions first); in the parsed map groups are applied first
 * so exact pairs override them, matching resolveKern. */
export function generateFeatures(font: Font): GeneratedFeatures {
  const classes = new Map<string, string[]>();
  const poss = new Map<string, number>();
  const lines: string[] = [
    "# Automatic feature code — generated from kerning, anchors, and glyph names.",
    "# Manual code in the Features tab overrides this where both define a pair.",
    "languagesystem DFLT dflt;",
    "",
  ];
  // Kerning group classes.
  const rightGroups = new Map<string, string[]>();
  const leftGroups = new Map<string, string[]>();
  for (const g of font.glyphs) {
    if (g.kerningGroupRight) rightGroups.set(g.kerningGroupRight, [...(rightGroups.get(g.kerningGroupRight) ?? []), g.name]);
    if (g.kerningGroupLeft) leftGroups.set(g.kerningGroupLeft, [...(leftGroups.get(g.kerningGroupLeft) ?? []), g.name]);
  }
  for (const [group, members] of [...rightGroups].sort()) {
    const name = className("KernR", group);
    classes.set(name, members.sort());
    lines.push(`@${name} = [${members.join(" ")}];`);
  }
  for (const [group, members] of [...leftGroups].sort()) {
    const name = className("KernL", group);
    classes.set(name, members.sort());
    lines.push(`@${name} = [${members.join(" ")}];`);
  }
  if (rightGroups.size || leftGroups.size) lines.push("");
  // Group pairs first in the parsed map, exact pairs override.
  let groupPairs = 0;
  const groupLines: string[] = [];
  for (const [key, value] of Object.entries(font.kerningGroups || {}).sort()) {
    if (!value) continue;
    const [lg, rg] = key.split("|");
    const lefts = rightGroups.get(lg) ?? [];
    const rights = leftGroups.get(rg) ?? [];
    if (!lefts.length || !rights.length) continue;
    groupPairs++;
    groupLines.push(`  pos @${className("KernR", lg)} @${className("KernL", rg)} ${value};`);
    for (const l of lefts) for (const r of rights) poss.set(`${l}|${r}`, value);
  }
  const exactLines: string[] = [];
  let kernPairs = 0;
  for (const [key, value] of Object.entries(font.kerning || {}).sort()) {
    if (!value) continue;
    const [l, r] = key.split("|");
    if (!findGlyph(font, l) || !findGlyph(font, r)) continue;
    kernPairs++;
    exactLines.push(`  pos ${l} ${r} ${value};`);
    poss.set(`${l}|${r}`, value);
  }
  if (exactLines.length || groupLines.length) {
    lines.push("feature kern {", ...exactLines, ...groupLines, "} kern;", "");
  }
  // Ligatures from glyph names.
  const subs = ligatureSequences(font);
  if (subs.length) {
    lines.push("feature liga {");
    for (const s of subs) lines.push(`  sub ${s.from.join(" ")} by ${s.to};`);
    lines.push("} liga;", "");
  }
  // Marks: markClass per mark anchor, base attachments, mark-to-mark.
  const markClasses = new Map<string, string[]>();
  const markClassLines: string[] = [];
  for (const g of font.glyphs) {
    if (!isMarkGlyph(g)) continue;
    for (const a of g.anchors || []) {
      if (!a.name.startsWith("_")) continue;
      const anchor = a.name.slice(1);
      const cls = className("MC", anchor);
      if (!markClasses.has(cls)) markClasses.set(cls, []);
      markClasses.get(cls)?.push(g.name);
      if (FEA_NAME.test(g.name)) markClassLines.push(`markClass ${g.name} <anchor ${Math.round(a.x)} ${Math.round(a.y)}> @${cls};`);
    }
  }
  let markAttachments = 0;
  const baseLines: string[] = [];
  for (const g of font.glyphs) {
    if (isMarkGlyph(g)) continue;
    for (const a of g.anchors || []) {
      const cls = className("MC", a.name);
      if (!markClasses.has(cls) || !FEA_NAME.test(g.name)) continue;
      markAttachments++;
      baseLines.push(`  pos base ${g.name} <anchor ${Math.round(a.x)} ${Math.round(a.y)}> mark @${cls};`);
    }
  }
  let markToMark = 0;
  const mkmkLines: string[] = [];
  for (const g of font.glyphs) {
    if (!isMarkGlyph(g)) continue;
    for (const a of g.anchors || []) {
      if (a.name.startsWith("_")) continue;
      const cls = className("MC", a.name);
      if (!markClasses.has(cls) || !FEA_NAME.test(g.name)) continue;
      markToMark++;
      mkmkLines.push(`  pos mark ${g.name} <anchor ${Math.round(a.x)} ${Math.round(a.y)}> mark @${cls};`);
    }
  }
  if (markClassLines.length) lines.push(...markClassLines, "");
  if (baseLines.length) lines.push("feature mark {", ...baseLines, "} mark;", "");
  if (mkmkLines.length) lines.push("feature mkmk {", ...mkmkLines, "} mkmk;", "");
  const parsed: ParsedFeatures = { classes, subs, poss };
  return {
    code: lines.join("\n").trimEnd() + "\n",
    parsed,
    kernPairs, groupPairs,
    ligatures: subs.length,
    markAttachments, markToMark,
  };
}

export function generateFeatureCode(font: Font): string {
  return generateFeatures(font).code;
}

/** Full features.fea text for UFO export: generated code first, then the
 * manual Features-tab code verbatim under its own heading. */
export function effectiveFeatureCode(font: Font): string {
  const manual = (font.featureCode || "").trim();
  const generated = generateFeatureCode(font);
  if (!manual) return generated;
  return `${generated}\n# --- Manual feature code (Features tab) ---\n${manual}\n`;
}

/** Generated features with manual feature code merged on top: manual
 * classes replace same-named generated ones, manual pairs override
 * generated pairs, and manual substitutions win for a given sequence. */
export function effectiveFeatures(font: Font): ParsedFeatures {
  const generated = generateFeatures(font).parsed;
  const manual = parseFeatureCode(font.featureCode || "");
  const manualSeqs = new Set(manual.subs.map((s) => s.from.join(" ")));
  return {
    classes: new Map([...generated.classes, ...manual.classes]),
    subs: [...manual.subs, ...generated.subs.filter((s) => !manualSeqs.has(s.from.join(" ")))],
    poss: new Map([...generated.poss, ...manual.poss]),
  };
}

export function shapeText(font: Font, text: string, parsed?: ParsedFeatures): ShapedItem[] {
  const features = parsed ?? effectiveFeatures(font);
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
  let prevMark: { glyph: Glyph; dx: number; dy: number } | undefined;
  for (let k = 0; k < seq.length; k++) {
    const item = seq[k];
    if (!item.name) { out.push({ name: null, char: item.char, advance: 0 }); continue; }
    const glyph = findGlyph(font, item.name);
    if (glyph && isMarkGlyph(glyph) && prevGlyph) {
      // Mark: zero advance, positioned over the preceding base glyph.
      // Anchor pair top (base) / _top (mark) wins; without anchors the
      // mark is centred over the base at cap height. A mark directly
      // after another mark attaches to that mark instead (mark-to-mark)
      // when it carries the matching top/_top anchor pair.
      const markAnchor = glyph.anchors?.find((a) => a.name === "_top");
      const prevTop = prevMark?.glyph.anchors?.find((a) => a.name === "top");
      let dx: number, dy: number;
      if (prevMark && prevTop && markAnchor) {
        dx = prevMark.dx + prevTop.x - markAnchor.x;
        dy = prevMark.dy + prevTop.y - markAnchor.y;
      } else {
        const baseAnchor = prevGlyph.anchors?.find((a) => a.name === "top");
        dx = baseAnchor && markAnchor ? baseAnchor.x - markAnchor.x : Math.round(prevGlyph.width / 2);
        dy = baseAnchor && markAnchor ? baseAnchor.y - markAnchor.y : font.capHeight;
      }
      out.push({ name: item.name, char: item.char, advance: 0, dx, dy });
      prevMark = { glyph, dx, dy };
      continue;
    }
    let advance = glyph?.width ?? 0;
    const next = seq[k + 1]?.name;
    if (next) {
      const featurePos = features.poss.get(`${item.name}|${next}`);
      advance += featurePos !== undefined ? featurePos : resolveKern(font, item.name, next);
    }
    out.push({ name: item.name, char: item.char, advance });
    if (glyph) { prevGlyph = glyph; prevMark = undefined; }
  }
  return out;
}
