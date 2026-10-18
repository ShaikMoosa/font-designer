// Font data model for the Windows MVP. Coordinates are font units, Y-up,
// baseline y=0. A glyph stores width/lsb/rsb plus one layer per master.
// Each layer holds contours; a contour is an ordered node list where
// type is "line" | "curve" | "smooth" (on-curve) or "offcurve" (handle).
import { glyphInfoFor } from "./glyphinfo.ts";
export type NodeType = "line" | "curve" | "smooth" | "offcurve";
export interface FontNode { x: number; y: number; type: NodeType }
export interface Contour { closed: boolean; nodes: FontNode[] }
export interface GlyphLayer { paths: Contour[] }
export interface BackupLayer {
  id: string; name: string; createdAt: string; masterId: string; paths: Contour[];
}
export interface Anchor { name: string; x: number; y: number }
export interface ComponentRef { glyph: string; x: number; y: number; scaleX: number; scaleY: number; smart?: Record<string, number> }
export type SmartApply = "scaleX" | "scaleY" | "x" | "y";
export interface SmartParam { name: string; min: number; max: number; defaultValue: number; apply: SmartApply }
export interface Glyph {
  name: string; unicode: number | null; width: number; lsb: number; rsb: number;
  category: string; kerningGroupLeft: string; kerningGroupRight: string;
  anchors: Anchor[]; layers: Record<string, GlyphLayer>;
  components: ComponentRef[]; metricsKeyLeft: string; metricsKeyRight: string;
  smartParams?: SmartParam[];
  backups?: BackupLayer[];
  // Phase 10 glyph data. productionName empty means "derive from
  // glyph-info"; colorLabel is an index into COLOR_LABELS or -1/undefined
  // for none; scriptOverride beats the Unicode-range guess.
  productionName?: string;
  tags?: string[];
  colorLabel?: number;
  note?: string;
  glyphCase?: "" | "upper" | "lower";
  scriptOverride?: string;
}

export function cloneContours(paths: Contour[]): Contour[] {
  return paths.map((c) => ({ closed: c.closed, nodes: c.nodes.map((n) => ({ ...n })) }));
}

/** Snapshot a glyph's layer for one master as a restorable backup. */
export function snapshotLayer(glyph: Glyph, masterId: string, now = new Date()): BackupLayer | null {
  const layer = glyph.layers[masterId];
  if (!layer) return null;
  const stamp = now.toISOString();
  const backup: BackupLayer = {
    id: `backup-${now.getTime().toString(36)}`,
    name: `Backup ${stamp.slice(0, 19).replace("T", " ")}`,
    createdAt: stamp,
    masterId,
    paths: cloneContours(layer.paths),
  };
  glyph.backups = [...(glyph.backups || []), backup];
  return backup;
}

/** Replace a glyph's layer for the backup's master with the snapshot. */
export function restoreBackup(glyph: Glyph, backupId: string): BackupLayer | null {
  const backup = (glyph.backups || []).find((b) => b.id === backupId);
  if (!backup) return null;
  glyph.layers[backup.masterId] = { paths: cloneContours(backup.paths) };
  return backup;
}

export function deleteBackup(glyph: Glyph, backupId: string): boolean {
  const before = (glyph.backups || []).length;
  glyph.backups = (glyph.backups || []).filter((b) => b.id !== backupId);
  return glyph.backups.length !== before;
}
export interface FontMaster { id: string; name: string; weightValue: number; axisValues?: Record<string, number> }
export interface FontInstance { name: string; masterId: string; active: boolean; axisValues?: Record<string, number> }
export interface FontAxis { tag: string; name: string; min: number; defaultValue: number; max: number }
export interface Font {
  familyName: string; version: string; unitsPerEm: number;
  ascender: number; descender: number; capHeight: number; xHeight: number;
  masters: FontMaster[]; instances: FontInstance[]; glyphs: Glyph[];
  kerning: Record<string, number>; kerningGroups: Record<string, number>;
  axes: FontAxis[]; featureCode: string;
  currentMasterId: string; fileName: string;
}
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export const KAPPA = 0.5522847498307936;

export function lineNode(x: number, y: number): FontNode { return { x: Math.round(x), y: Math.round(y), type: "line" }; }
export function curveNode(x: number, y: number): FontNode { return { x: Math.round(x), y: Math.round(y), type: "curve" }; }
export function offNode(x: number, y: number): FontNode { return { x: Math.round(x), y: Math.round(y), type: "offcurve" }; }

export function rectContour(x: number, y: number, w: number, h: number): Contour {
  return {
    closed: true,
    nodes: [lineNode(x, y), lineNode(x + w, y), lineNode(x + w, y + h), lineNode(x, y + h)],
  };
}

export function ellipseContour(cx: number, cy: number, rx: number, ry: number): Contour {
  const kx = KAPPA * rx, ky = KAPPA * ry;
  return {
    closed: true,
    nodes: [
      curveNode(cx + rx, cy), offNode(cx + rx, cy + ky), offNode(cx + kx, cy + ry), curveNode(cx, cy + ry),
      offNode(cx - kx, cy + ry), offNode(cx - rx, cy + ky), curveNode(cx - rx, cy),
      offNode(cx - rx, cy - ky), offNode(cx - kx, cy - ry), curveNode(cx, cy - ry),
      offNode(cx + kx, cy - ry), offNode(cx + rx, cy - ky),
    ],
  };
}

export function translateContour(c: Contour, dx: number, dy: number): Contour {
  c.nodes.forEach((n) => { n.x += dx; n.y += dy; });
  return c;
}

// Build an SVG path "d" for a contour (Y-up font coords; caller flips Y).
export function contourToPathD(contour: Contour): string {
  const pts = contour.nodes;
  if (!pts.length) return "";
  // Rotate so we start at an on-curve point when possible.
  const startIdx = pts.findIndex((p) => p.type !== "offcurve");
  if (startIdx < 0) return "";
  const seq = pts.slice(startIdx).concat(pts.slice(0, startIdx));
  const parts = [`M ${seq[0].x} ${seq[0].y}`];
  let i = 1;
  const n = seq.length;
  let guard = 0;
  while (i <= n && guard++ < 500) {
    if (!contour.closed && i >= n) break;
    const a = seq[i % n];
    if (a.type !== "offcurve") { parts.push(`L ${a.x} ${a.y}`); i++; continue; }
    const b = seq[(i + 1) % n]; const c = seq[(i + 2) % n];
    if (b && b.type === "offcurve" && c && c.type !== "offcurve") {
      parts.push(`C ${a.x} ${a.y} ${b.x} ${b.y} ${c.x} ${c.y}`); i += 3; continue;
    }
    // Single handle before on-curve: treat as quadratic promoted to cubic midpoint.
    const p0 = seq[(i - 1 + n) % n];
    const cx = p0.x + (2 / 3) * (a.x - p0.x), cy = p0.y + (2 / 3) * (a.y - p0.y);
    const dx = b.x + (2 / 3) * (a.x - b.x), dy = b.y + (2 / 3) * (a.y - b.y);
    parts.push(`C ${cx} ${cy} ${dx} ${dy} ${b.x} ${b.y}`); i += 2;
  }
  if (contour.closed) parts.push("Z");
  return parts.join(" ");
}

export function glyphToPathD(glyph: Glyph, masterId: string): string {
  const layer = glyph.layers[masterId];
  if (!layer) return "";
  return layer.paths.map(contourToPathD).filter(Boolean).join(" ");
}

export function contourBounds(contour: Contour): Bounds | null {
  if (!contour.nodes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of contour.nodes) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function glyphBounds(glyph: Glyph, masterId: string): Bounds | null {
  const layer = glyph.layers[masterId];
  if (!layer || !layer.paths.length) return null;
  let out: Bounds | null = null;
  for (const c of layer.paths) {
    const b = contourBounds(c);
    if (!b) continue;
    if (!out) out = { ...b };
    else {
      out.minX = Math.min(out.minX, b.minX); out.minY = Math.min(out.minY, b.minY);
      out.maxX = Math.max(out.maxX, b.maxX); out.maxY = Math.max(out.maxY, b.maxY);
    }
  }
  return out;
}

export function kernKey(left: string, right: string): string { return `${left}|${right}`; }
export function getKern(font: Font, left: string, right: string): number {
  return font.kerning[kernKey(left, right)] || 0;
}

interface GlyphExtra {
  lsb?: number; rsb?: number; category?: string;
  kerningGroupLeft?: string; kerningGroupRight?: string; anchors?: Anchor[];
  components?: ComponentRef[];
}

function makeGlyph(name: string, unicode: number | null, width: number, contours: Contour[], extra: GlyphExtra = {}): Glyph {
  return {
    name, unicode, width,
    lsb: extra.lsb ?? 40, rsb: extra.rsb ?? 40,
    category: extra.category || "Letter",
    kerningGroupLeft: extra.kerningGroupLeft || "",
    kerningGroupRight: extra.kerningGroupRight || "",
    anchors: extra.anchors || [],
    components: extra.components || [],
    metricsKeyLeft: "", metricsKeyRight: "",
    layers: { masterRegular: { paths: contours } },
  };
}

export const DEFAULT_FEATURE_CODE = [
  "# Feature code subset: classes, sub (ligatures), pos (kerning).",
  "# Lines starting with # are comments. Example:",
  "# @Upper = [A V H O];",
  "# sub f i by fi;",
  "# pos A V -70;",
  "",
].join("\n");

// Original geometric starter glyphs (drawn for this MVP, not copied outlines).
export function createDefaultFont(): Font {
  const glyphs: Glyph[] = [];
  glyphs.push(makeGlyph("space", 0x0020, 280, [], { lsb: 0, rsb: 0, category: "Separator" }));
  // A: outer triangle-ish with counter.
  glyphs.push(makeGlyph("A", 0x0041, 680, [
    { closed: true, nodes: [lineNode(40, 0), lineNode(340, 700), lineNode(640, 0), lineNode(520, 0), lineNode(450, 200), lineNode(230, 200), lineNode(160, 0)] },
    { closed: true, nodes: [lineNode(272, 290), lineNode(408, 290), lineNode(340, 520)] },
  ], { lsb: 10, rsb: 10 }));
  glyphs.push(makeGlyph("V", 0x0056, 660, [
    { closed: true, nodes: [lineNode(30, 700), lineNode(150, 700), lineNode(330, 180), lineNode(510, 700), lineNode(630, 700), lineNode(390, 0), lineNode(270, 0)] },
  ], { lsb: 15, rsb: 15 }));
  glyphs.push(makeGlyph("H", 0x0048, 700, [
    rectContour(60, 0, 110, 700), rectContour(470, 0, 110, 700), rectContour(170, 310, 300, 90),
  ]));
  const oOuter = ellipseContour(320, 250, 260, 260);
  const oInner = ellipseContour(320, 250, 150, 155);
  glyphs.push(makeGlyph("O", 0x004F, 640, [oOuter, oInner], { lsb: 25, rsb: 25 }));
  glyphs.push(makeGlyph("n", 0x006E, 600, [
    { closed: true, nodes: [lineNode(60, 0), lineNode(60, 500), lineNode(170, 500), lineNode(170, 430), curveNode(300, 500), offNode(360, 545), offNode(470, 500), curveNode(480, 380), lineNode(480, 0), lineNode(370, 0), lineNode(370, 360), curveNode(300, 410), offNode(230, 430), offNode(170, 380), curveNode(170, 0)] },
  ]));
  const eOuter = ellipseContour(290, 245, 230, 245);
  const eInner = ellipseContour(295, 285, 130, 120);
  glyphs.push(makeGlyph("e", 0x0065, 580, [eOuter, eInner, rectContour(90, 250, 400, 70)]));
  glyphs.push(makeGlyph("o", 0x006F, 600, [ellipseContour(300, 245, 240, 245), ellipseContour(300, 245, 135, 140)]));
  glyphs.push(makeGlyph("a", 0x0061, 560, [ellipseContour(270, 245, 210, 245), ellipseContour(270, 245, 110, 135), rectContour(430, 0, 100, 500)]));
  glyphs.push(makeGlyph("period", 0x002E, 260, [ellipseContour(130, 55, 62, 62)], { category: "Punctuation" }));
  glyphs.push(makeGlyph("hyphen", 0x002D, 360, [rectContour(50, 240, 260, 60)], { category: "Punctuation" }));
  return {
    familyName: "Handbook Sans",
    version: "1.000",
    unitsPerEm: 1000, ascender: 800, descender: -200, capHeight: 700, xHeight: 500,
    masters: [{ id: "masterRegular", name: "Regular", weightValue: 400 }],
    instances: [{ name: "Regular", masterId: "masterRegular", active: true }],
    glyphs,
    kerning: { "A|V": -70, "V|A": -70, "T|o": -40, "A|period": -20 },
    kerningGroups: {},
    axes: [{ tag: "wght", name: "Weight", min: 400, defaultValue: 400, max: 700 }],
    featureCode: DEFAULT_FEATURE_CODE,
    currentMasterId: "masterRegular",
    fileName: "Untitled.glyphs",
  };
}

export function findGlyph(font: Font, name: string): Glyph | undefined { return font.glyphs.find((g) => g.name === name); }

export const GLYPH_CATEGORIES = ["Letter", "Number", "Separator", "Punctuation", "Symbol", "Mark", "Other"];

/** Font View grouping: the Handbook category for a glyph. */
export function categoryForGlyph(glyph: Glyph): string {
  return GLYPH_CATEGORIES.includes(glyph.category) ? glyph.category : "Other";
}

/** Font View grouping: script/language bucket from the Unicode range. */
export function scriptForGlyph(glyph: Glyph): string {
  if (glyph.scriptOverride) return glyph.scriptOverride;
  const u = glyph.unicode;
  if (u == null) return "No Unicode";
  if (u <= 0x024f) return "Latin";
  if (u >= 0x0370 && u <= 0x03ff) return "Greek";
  if (u >= 0x0400 && u <= 0x04ff) return "Cyrillic";
  if (u >= 0x0590 && u <= 0x05ff) return "Hebrew";
  if (u >= 0x0600 && u <= 0x06ff) return "Arabic";
  if (u >= 0x0900 && u <= 0x097f) return "Devanagari";
  if (u >= 0x3040 && u <= 0x30ff) return "Japanese";
  if (u >= 0x4e00 && u <= 0x9fff) return "Chinese";
  if (u >= 0xac00 && u <= 0xd7af) return "Korean";
  return "Other";
}

/** Canvas backing size for a Font View thumbnail at the given cell size. */
export function thumbCanvasSize(cellSize: number, devicePixelRatio = 1): { width: number; height: number } {
  const base = Math.max(56, Math.min(160, Math.round(cellSize) || 88));
  const ratio = Math.max(1, Math.min(2, devicePixelRatio || 1));
  return { width: Math.round(base * ratio), height: Math.round(base * 0.72 * ratio) };
}

/** Honest Font View status line: the selected glyph plus shown/total counts. */
export function fontViewCountText(selectedName: string, shown: number, total: number): string {
  return selectedName ? `${selectedName} selected · ${shown}/${total} glyphs` : `${shown}/${total} glyphs`;
}

// --- Phase 10: glyph data operations ---

export type GlyphFilter = "all" | "with-unicode" | "without-unicode" | "with-outline" | "empty" | "components" | "colored";

export const GLYPH_FILTERS: Array<{ id: GlyphFilter; label: string }> = [
  { id: "all", label: "All glyphs" },
  { id: "with-unicode", label: "With Unicode" },
  { id: "without-unicode", label: "Without Unicode" },
  { id: "with-outline", label: "With outlines" },
  { id: "empty", label: "Empty (no outlines)" },
  { id: "components", label: "Composites (components)" },
  { id: "colored", label: "With color label" },
];

/** True when any master layer of the glyph has at least one contour. */
export function glyphHasOutline(font: Font, glyph: Glyph): boolean {
  return font.masters.some((m) => (glyph.layers[m.id]?.paths.length ?? 0) > 0);
}

export function glyphMatchesFilter(font: Font, glyph: Glyph, filter: GlyphFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "with-unicode": return glyph.unicode != null;
    case "without-unicode": return glyph.unicode == null;
    case "with-outline": return glyphHasOutline(font, glyph);
    case "empty": return !glyphHasOutline(font, glyph);
    case "components": return (glyph.components || []).length > 0;
    case "colored": return glyph.colorLabel != null && glyph.colorLabel >= 0;
  }
}

export type GlyphSortMode = "order" | "name" | "unicode";

/** Display order for the Font View; the font's own order is untouched. */
export function sortGlyphsForDisplay(glyphs: Glyph[], mode: GlyphSortMode): Glyph[] {
  const copy = [...glyphs];
  if (mode === "name") copy.sort((a, b) => a.name.localeCompare(b.name));
  if (mode === "unicode") copy.sort((a, b) => (a.unicode ?? 0x110000) - (b.unicode ?? 0x110000) || a.name.localeCompare(b.name));
  return copy;
}

/**
 * Rename a glyph and every reference to it: component bases, metrics keys,
 * and kerning pair keys. Returns false (changing nothing) for an empty,
 * unchanged, or duplicate name.
 */
export function renameGlyph(font: Font, oldName: string, newName: string): boolean {
  const next = newName.trim();
  if (!next || next === oldName) return false;
  const glyph = findGlyph(font, oldName);
  if (!glyph || findGlyph(font, next)) return false;
  glyph.name = next;
  for (const g of font.glyphs) {
    for (const c of g.components || []) if (c.glyph === oldName) c.glyph = next;
    if (g.metricsKeyLeft === oldName) g.metricsKeyLeft = next;
    if (g.metricsKeyRight === oldName) g.metricsKeyRight = next;
  }
  const kerning: Record<string, number> = {};
  for (const [k, v] of Object.entries(font.kerning)) {
    const [l, r] = k.split("|");
    kerning[`${l === oldName ? next : l}|${r === oldName ? next : r}`] = v;
  }
  font.kerning = kerning;
  return true;
}

/** Move a glyph one step in the font's glyph order. False at the edges. */
export function moveGlyphInOrder(font: Font, name: string, direction: -1 | 1): boolean {
  const idx = font.glyphs.findIndex((g) => g.name === name);
  const target = idx + direction;
  if (idx < 0 || target < 0 || target >= font.glyphs.length) return false;
  const [glyph] = font.glyphs.splice(idx, 1);
  font.glyphs.splice(target, 0, glyph);
  return true;
}

/**
 * Fill missing Unicode, production name, and case from the glyph-info
 * database (and correct the category for known names). Returns how many
 * glyphs changed.
 */
export function applyGlyphInfo(font: Font): number {
  let changed = 0;
  for (const g of font.glyphs) {
    const info = glyphInfoFor(g.name);
    if (!info) continue;
    let touched = false;
    if (g.unicode == null) { g.unicode = info.unicode; touched = true; }
    if (!g.productionName && info.production) { g.productionName = info.production; touched = true; }
    if (!g.glyphCase && info.glyphCase) { g.glyphCase = info.glyphCase; touched = true; }
    if (g.category !== info.category) { g.category = info.category; touched = true; }
    if (touched) changed++;
  }
  return changed;
}

/** Parse a comma-separated tag field into a clean list. */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(",").map((t) => t.trim()).filter(Boolean))];
}

export function syncBearings(font: Font, glyph: Glyph): void {
  const b = glyphBounds(glyph, font.currentMasterId);
  if (!b) return;
  glyph.lsb = Math.round(b.minX);
  glyph.rsb = Math.round(glyph.width - b.maxX);
}

export function cloneFont(font: Font): Font { return JSON.parse(JSON.stringify(font)) as Font; }

export function transformContour(c: Contour, dx: number, dy: number, sx = 1, sy = 1): Contour {
  return {
    closed: c.closed,
    nodes: c.nodes.map((n) => ({ x: Math.round(n.x * sx + dx), y: Math.round(n.y * sy + dy), type: n.type })),
  };
}

// Own contours plus component contours (transformed, recursive, cycle-safe).
export function resolveGlyphContours(font: Font, glyph: Glyph, masterId: string, seen: Set<string> = new Set()): Contour[] {
  const own = glyph.layers[masterId]?.paths ?? [];
  const out: Contour[] = own.map((c) => ({ closed: c.closed, nodes: c.nodes.map((n) => ({ ...n })) }));
  if (seen.has(glyph.name)) return out;
  seen.add(glyph.name);
  for (const comp of glyph.components || []) {
    const base = findGlyph(font, comp.glyph);
    if (!base) continue;
    // Smart parameters defined on the base glyph override the component's
    // transform channels (instance value wins, else the declared default).
    let { x, y, scaleX, scaleY } = { x: comp.x || 0, y: comp.y || 0, scaleX: comp.scaleX || 1, scaleY: comp.scaleY || 1 };
    for (const def of base.smartParams || []) {
      const v = comp.smart?.[def.name] ?? def.defaultValue;
      if (def.apply === "scaleX") scaleX = v;
      else if (def.apply === "scaleY") scaleY = v;
      else if (def.apply === "x") x = v;
      else y = v;
    }
    for (const c of resolveGlyphContours(font, base, masterId, seen)) {
      out.push(transformContour(c, x, y, scaleX, scaleY));
    }
  }
  return out;
}

export function contoursToPathD(contours: Contour[]): string {
  return contours.map(contourToPathD).filter(Boolean).join(" ");
}

export function glyphToPathDResolved(font: Font, glyph: Glyph, masterId: string): string {
  return contoursToPathD(resolveGlyphContours(font, glyph, masterId));
}

const RECIPES: Record<string, string[]> = {
  eacute: ["e", "acutecomb"], Eacute: ["E", "acutecomb"],
  aacute: ["a", "acutecomb"], Aacute: ["A", "acutecomb"],
  agrave: ["a", "gravecomb"], egrave: ["e", "gravecomb"],
  adieresis: ["a", "dieresiscomb"], odieresis: ["o", "dieresiscomb"],
  atilde: ["a", "tildecomb"], ntilde: ["n", "tildecomb"],
  ccedilla: ["c", "cedillacomb"],
};

export function compositeRecipe(name: string): string[] | null {
  return RECIPES[name] ?? null;
}

// Exact pair wins, then kerning-group pair (right group of left glyph +
// left group of right glyph), else 0.
export function resolveKern(font: Font, left: string, right: string): number {
  const exact = font.kerning[kernKey(left, right)];
  if (exact) return exact;
  const lg = findGlyph(font, left);
  const rg = findGlyph(font, right);
  if (lg?.kerningGroupRight && rg?.kerningGroupLeft) {
    return font.kerningGroups[`${lg.kerningGroupRight}|${rg.kerningGroupLeft}`] || 0;
  }
  return 0;
}

export function contourArea(c: Contour): number {
  let a = 0;
  const pts = c.nodes.filter((n) => n.type !== "offcurve");
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function lerp(a: number, b: number, t: number): number { return Math.round(a + (b - a) * t); }

// Interpolate between the first and last master (by weightValue). Requires
// compatible outlines; returns null when contours/nodes do not line up.
export function interpolateGlyphAt(font: Font, glyphName: string, t: number): Glyph | null {
  const glyph = findGlyph(font, glyphName);
  if (!glyph || font.masters.length < 2) return null;
  const sorted = [...font.masters].sort((a, b) => (a.weightValue || 0) - (b.weightValue || 0));
  const ma = sorted[0], mb = sorted[sorted.length - 1];
  const la = glyph.layers[ma.id], lb = glyph.layers[mb.id];
  if (!la || !lb || la.paths.length !== lb.paths.length) return null;
  const paths: Contour[] = [];
  for (let i = 0; i < la.paths.length; i++) {
    const ca = la.paths[i], cb = lb.paths[i];
    if (ca.closed !== cb.closed || ca.nodes.length !== cb.nodes.length) return null;
    paths.push({
      closed: ca.closed,
      nodes: ca.nodes.map((n, j) => ({ x: lerp(n.x, cb.nodes[j].x, t), y: lerp(n.y, cb.nodes[j].y, t), type: n.type })),
    });
  }
  return {
    ...glyph,
    width: lerp(glyph.width, glyph.width, t),
    layers: { ...glyph.layers, [font.currentMasterId]: { paths } },
  };
}

export function mastersCompatible(font: Font, glyphName: string): boolean {
  return interpolateGlyphAt(font, glyphName, 0.5) !== null;
}

export interface XY { x: number; y: number }

// Ramer–Douglas–Peucker polyline simplification. Endpoints are always kept;
// interior points survive only when farther than epsilon from the segment.
export function simplifyPoints(points: XY[], epsilon: number): XY[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const pa = points[a], pb = points[b];
    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    const len2 = dx * dx + dy * dy;
    let worst = -1, worstDist = epsilon;
    for (let i = a + 1; i < b; i++) {
      const p = points[i];
      const t = len2 ? ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / len2 : 0;
      const tc = Math.max(0, Math.min(1, t));
      const d = Math.hypot(p.x - (pa.x + dx * tc), p.y - (pa.y + dy * tc));
      if (d > worstDist) { worstDist = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = true; stack.push([a, worst], [worst, b]); }
  }
  return points.filter((_, i) => keep[i]).map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

// Freehand stroke → editable open contour of line nodes (Glyphs Pencil
// behaviour subset). Returns null when the stroke has too few points.
export function pencilContour(points: XY[], epsilon = 6): Contour | null {
  const pts = simplifyPoints(points, epsilon);
  if (pts.length < 2) return null;
  return { closed: false, nodes: pts.map((p) => lineNode(p.x, p.y)) };
}

export interface Measurement { dx: number; dy: number; distance: number; angleDeg: number }

export function measureBetween(a: XY, b: XY): Measurement {
  const dx = b.x - a.x, dy = b.y - a.y;
  return {
    dx, dy,
    distance: Math.round(Math.hypot(dx, dy) * 10) / 10,
    angleDeg: Math.round((Math.atan2(dy, dx) * 180) / Math.PI * 100) / 100,
  };
}

export type AlignMode = "left" | "hcenter" | "right" | "bottom" | "vcenter" | "top" | "distX" | "distY";

// Returns new coordinates for the given points; inputs are not mutated.
export function alignPoints(points: XY[], mode: AlignMode): XY[] {
  const out = points.map((p) => ({ ...p }));
  if (!out.length) return out;
  const xs = out.map((p) => p.x), ys = out.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  switch (mode) {
    case "left": for (const p of out) p.x = minX; break;
    case "right": for (const p of out) p.x = maxX; break;
    case "hcenter": { const c = Math.round((minX + maxX) / 2); for (const p of out) p.x = c; break; }
    case "bottom": for (const p of out) p.y = minY; break;
    case "top": for (const p of out) p.y = maxY; break;
    case "vcenter": { const c = Math.round((minY + maxY) / 2); for (const p of out) p.y = c; break; }
    case "distX": case "distY": {
      if (out.length < 3) break;
      const key = mode === "distX" ? "x" : "y";
      const order = out.map((_, i) => i).sort((i, j) => out[i][key] - out[j][key]);
      const lo = out[order[0]][key], hi = out[order[order.length - 1]][key];
      order.forEach((idx, rank) => { out[idx][key] = Math.round(lo + ((hi - lo) * rank) / (order.length - 1)); });
      break;
    }
  }
  return out;
}
