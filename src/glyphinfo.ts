// Glyph-info database (Phase 10): the standard name -> Unicode, category,
// production name, and case for common glyph names, used for suggestions
// when adding or renaming glyphs and for the batch "apply glyph info"
// operation. Deliberately a curated subset (Latin letters, digits, and
// common punctuation/symbols) rather than the full Adobe Glyph List.
export interface GlyphInfo {
  unicode: number;
  category: string;
  production: string;
  glyphCase: "" | "upper" | "lower";
}

function entry(unicode: number, category: string, production?: string, glyphCase: "" | "upper" | "lower" = ""): GlyphInfo {
  return { unicode, category, production: production ?? "", glyphCase };
}

const INFO: Record<string, GlyphInfo> = {};

for (let i = 0; i < 26; i++) {
  const upper = String.fromCharCode(0x41 + i);
  const lower = String.fromCharCode(0x61 + i);
  INFO[upper] = entry(0x41 + i, "Letter", upper, "upper");
  INFO[lower] = entry(0x61 + i, "Letter", lower, "lower");
}
const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
DIGITS.forEach((name, i) => { INFO[name] = entry(0x30 + i, "Number", name); });

Object.assign(INFO, {
  space: entry(0x0020, "Separator", "space"),
  period: entry(0x002e, "Punctuation", "period"),
  comma: entry(0x002c, "Punctuation", "comma"),
  hyphen: entry(0x002d, "Punctuation", "hyphen"),
  exclam: entry(0x0021, "Punctuation", "exclam"),
  question: entry(0x003f, "Punctuation", "question"),
  colon: entry(0x003a, "Punctuation", "colon"),
  semicolon: entry(0x003b, "Punctuation", "semicolon"),
  quotesingle: entry(0x0027, "Punctuation", "quotesingle"),
  quotedbl: entry(0x0022, "Punctuation", "quotedbl"),
  quoteleft: entry(0x2018, "Punctuation", "quoteleft"),
  quoteright: entry(0x2019, "Punctuation", "quoteright"),
  quotedblleft: entry(0x201c, "Punctuation", "quotedblleft"),
  quotedblright: entry(0x201d, "Punctuation", "quotedblright"),
  parenleft: entry(0x0028, "Punctuation", "parenleft"),
  parenright: entry(0x0029, "Punctuation", "parenright"),
  bracketleft: entry(0x005b, "Punctuation", "bracketleft"),
  bracketright: entry(0x005d, "Punctuation", "bracketright"),
  braceleft: entry(0x007b, "Punctuation", "braceleft"),
  braceright: entry(0x007d, "Punctuation", "braceright"),
  slash: entry(0x002f, "Punctuation", "slash"),
  backslash: entry(0x005c, "Punctuation", "backslash"),
  bar: entry(0x007c, "Punctuation", "bar"),
  underscore: entry(0x005f, "Punctuation", "underscore"),
  ellipsis: entry(0x2026, "Punctuation", "ellipsis"),
  endash: entry(0x2013, "Punctuation", "endash"),
  emdash: entry(0x2014, "Punctuation", "emdash"),
  guilsinglleft: entry(0x2039, "Punctuation", "guilsinglleft"),
  guilsinglright: entry(0x203a, "Punctuation", "guilsinglright"),
  at: entry(0x0040, "Symbol", "at"),
  numbersign: entry(0x0023, "Symbol", "numbersign"),
  dollar: entry(0x0024, "Symbol", "dollar"),
  percent: entry(0x0025, "Symbol", "percent"),
  ampersand: entry(0x0026, "Symbol", "ampersand"),
  asterisk: entry(0x002a, "Symbol", "asterisk"),
  plus: entry(0x002b, "Symbol", "plus"),
  equal: entry(0x003d, "Symbol", "equal"),
  less: entry(0x003c, "Symbol", "less"),
  greater: entry(0x003e, "Symbol", "greater"),
  tilde: entry(0x007e, "Symbol", "tilde"),
  asciitilde: entry(0x007e, "Symbol", "asciitilde"),
  degree: entry(0x00b0, "Symbol", "degree"),
  copyright: entry(0x00a9, "Symbol", "copyright"),
  registered: entry(0x00ae, "Symbol", "registered"),
  trademark: entry(0x2122, "Symbol", "trademark"),
  bullet: entry(0x2022, "Symbol", "bullet"),
  middot: entry(0x00b7, "Punctuation", "periodcentered"),
  periodcentered: entry(0x00b7, "Punctuation", "periodcentered"),
  Euro: entry(0x20ac, "Symbol", "Euro"),
  sterling: entry(0x00a3, "Symbol", "sterling"),
  yen: entry(0x00a5, "Symbol", "yen"),
  cent: entry(0x00a2, "Symbol", "cent"),
  eacute: entry(0x00e9, "Letter", "eacute", "lower"),
  Eacute: entry(0x00c9, "Letter", "Eacute", "upper"),
  agrave: entry(0x00e0, "Letter", "agrave", "lower"),
  Agrave: entry(0x00c0, "Letter", "Agrave", "upper"),
  ouml: entry(0x00f6, "Letter", "ouml", "lower"),
  Ouml: entry(0x00d6, "Letter", "Ouml", "upper"),
  uuml: entry(0x00fc, "Letter", "uuml", "lower"),
  Uuml: entry(0x00dc, "Letter", "Uuml", "upper"),
  ntilde: entry(0x00f1, "Letter", "ntilde", "lower"),
  Ntilde: entry(0x00d1, "Letter", "Ntilde", "upper"),
  ccedilla: entry(0x00e7, "Letter", "ccedilla", "lower"),
  Ccedilla: entry(0x00c7, "Letter", "Ccedilla", "upper"),
  ss: entry(0x00df, "Letter", "germandbls", "lower"),
  germandbls: entry(0x00df, "Letter", "germandbls", "lower"),
  ae: entry(0x00e6, "Letter", "ae", "lower"),
  AE: entry(0x00c6, "Letter", "AE", "upper"),
  oslash: entry(0x00f8, "Letter", "oslash", "lower"),
  Oslash: entry(0x00d8, "Letter", "Oslash", "upper"),
  aring: entry(0x00e5, "Letter", "aring", "lower"),
  Aring: entry(0x00c5, "Letter", "Aring", "upper"),
});

/** Info for an exact glyph name, or null when the name is unknown. */
export function glyphInfoFor(name: string): GlyphInfo | null {
  return INFO[name] ?? null;
}

/**
 * Suggestion for a name being added or renamed: the database entry for an
 * exact name; for a single character, its codepoint with a letter/number/
 * other category guess. Null when nothing sensible can be suggested.
 */
export function glyphSuggestionFor(name: string): GlyphInfo | null {
  const exact = glyphInfoFor(name);
  if (exact) return exact;
  const chars = [...name];
  if (chars.length !== 1) return null;
  const cp = chars[0].codePointAt(0);
  if (cp == null) return null;
  const category = /\p{L}/u.test(chars[0]) ? "Letter" : /\p{N}/u.test(chars[0]) ? "Number" : "Symbol";
  const glyphCase = /\p{Lu}/u.test(chars[0]) ? "upper" : /\p{Ll}/u.test(chars[0]) ? "lower" : "";
  return { unicode: cp, category, production: `uni${cp.toString(16).toUpperCase().padStart(4, "0")}`, glyphCase };
}

/** Production name: the stored override, else glyph-info, else uniXXXX/name. */
export function productionNameFor(name: string, unicode: number | null, stored?: string): string {
  if (stored) return stored;
  const info = glyphInfoFor(name);
  if (info?.production) return info.production;
  if (unicode != null) return `uni${unicode.toString(16).toUpperCase().padStart(4, "0")}`;
  return name;
}

/** The 12 Glyphs-style color labels (index, display name, swatch hex). */
export const COLOR_LABELS: Array<{ name: string; hex: string }> = [
  { name: "Red", hex: "#e74c3c" },
  { name: "Orange", hex: "#e67e22" },
  { name: "Brown", hex: "#a67c52" },
  { name: "Yellow", hex: "#f2c618" },
  { name: "Light green", hex: "#a9df6a" },
  { name: "Dark green", hex: "#27ae60" },
  { name: "Light blue", hex: "#7ec8e3" },
  { name: "Blue", hex: "#2f7fe0" },
  { name: "Dark blue", hex: "#2e4a9e" },
  { name: "Purple", hex: "#9b59b6" },
  { name: "Pink", hex: "#f06ba8" },
  { name: "Gray", hex: "#95a5a6" },
];
