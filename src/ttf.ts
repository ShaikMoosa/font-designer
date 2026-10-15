// Minimal TrueType (glyf) writer: cubic contours are approximated by
// quadratics (explicit tolerance), tables are checksummed, cmap is
// format 4 for the BMP plus format 12 when astral glyphs are present.
import { resolveGlyphContours } from "./model.ts";
import type { Contour, Font, Glyph } from "./model.ts";

export interface QuadPoint { x: number; y: number; on: boolean }
const QUAD_TOLERANCE = 4;

function cubicPoint(p0: number, c1: number, c2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p3;
}
function quadPoint(p0: number, q: number, p1: number, t: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * q + t * t * p1;
}

function approxCubic(out: QuadPoint[], p0: QuadPoint, c1: { x: number; y: number }, c2: { x: number; y: number }, p3: { x: number; y: number }, depth: number): void {
  const qx = (-p0.x + 3 * c1.x + 3 * c2.x - p3.x) / 4;
  const qy = (-p0.y + 3 * c1.y + 3 * c2.y - p3.y) / 4;
  let maxErr = 0;
  for (const t of [0.25, 0.5, 0.75]) {
    const ex = cubicPoint(p0.x, c1.x, c2.x, p3.x, t) - quadPoint(p0.x, qx, p3.x, t);
    const ey = cubicPoint(p0.y, c1.y, c2.y, p3.y, t) - quadPoint(p0.y, qy, p3.y, t);
    maxErr = Math.max(maxErr, Math.hypot(ex, ey));
  }
  if (maxErr <= QUAD_TOLERANCE || depth >= 5) {
    out.push({ x: Math.round(qx), y: Math.round(qy), on: false });
    out.push({ x: Math.round(p3.x), y: Math.round(p3.y), on: true });
    return;
  }
  // Split the cubic at t=0.5 (de Casteljau) and recurse.
  const mid = (a: number, b: number) => (a + b) / 2;
  const ax = mid(p0.x, c1.x), ay = mid(p0.y, c1.y);
  const bx = mid(c1.x, c2.x), by = mid(c1.y, c2.y);
  const cx = mid(c2.x, p3.x), cy = mid(c2.y, p3.y);
  const dx = mid(ax, bx), dy = mid(ay, by);
  const ex = mid(bx, cx), ey = mid(by, cy);
  const mx = mid(dx, ex), my = mid(dy, ey);
  approxCubic(out, p0, { x: ax, y: ay }, { x: dx, y: dy }, { x: mx, y: my }, depth + 1);
  approxCubic(out, { x: mx, y: my, on: true }, { x: ex, y: ey }, { x: cx, y: cy }, p3, depth + 1);
}

// Convert one contour to quadratic points starting on-curve. Open contours
// are closed implicitly (validate.ts warns about them before export).
export function contourToQuadPoints(contour: Contour): QuadPoint[] {
  const pts = contour.nodes;
  if (!pts.length) return [];
  const startIdx = pts.findIndex((p) => p.type !== "offcurve");
  if (startIdx < 0) return [];
  const seq = pts.slice(startIdx).concat(pts.slice(0, startIdx));
  const out: QuadPoint[] = [{ x: seq[0].x, y: seq[0].y, on: true }];
  const n = seq.length;
  let i = 1;
  let guard = 0;
  while (i <= n && guard++ < 500) {
    if (i >= n && !contour.closed) break;
    const a = seq[i % n];
    if (i >= n && contour.closed && a === seq[0]) break;
    if (a.type !== "offcurve") { out.push({ x: a.x, y: a.y, on: true }); i++; continue; }
    const b = seq[(i + 1) % n];
    const c = seq[(i + 2) % n];
    const p0 = out[out.length - 1];
    if (b && c && b.type === "offcurve" && c.type !== "offcurve") {
      approxCubic(out, p0, a, b, c, 0);
      i += 3;
      continue;
    }
    if (b) { out.push({ x: b.x, y: b.y, on: true }); i += 2; continue; }
    break;
  }
  // Remove a duplicated closing point.
  if (out.length > 1) {
    const first = out[0], last = out[out.length - 1];
    if (first.x === last.x && first.y === last.y) out.pop();
  }
  return out;
}

interface GlyfGlyph { contours: QuadPoint[][]; minX: number; minY: number; maxX: number; maxY: number }

function glyphToGlyf(contours: Contour[]): GlyfGlyph {
  const quads = contours.map(contourToQuadPoints).filter((c) => c.length >= 2);
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  let first = true;
  for (const c of quads) for (const p of c) {
    if (first) { minX = maxX = p.x; minY = maxY = p.y; first = false; }
    else { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  }
  return { contours: quads, minX, minY, maxX, maxY };
}

function encodeGlyph(g: GlyfGlyph): Uint8Array {
  if (!g.contours.length) return new Uint8Array(0);
  const endPts: number[] = [];
  const points: QuadPoint[] = [];
  for (const c of g.contours) { points.push(...c); endPts.push(points.length - 1); }
  // Flag bits: 0 on-curve, 1 x-short, 2 y-short, 4 x-same/positive, 5 y-same/positive.
  const flags: number[] = [];
  const xBytes: number[] = []; const yBytes: number[] = [];
  let px = 0, py = 0;
  for (const p of points) {
    let flag = p.on ? 1 : 0;
    const dx = p.x - px, dy = p.y - py;
    px = p.x; py = p.y;
    if (dx === 0) flag |= 0x10;
    else if (dx > 0 && dx <= 255) { flag |= 0x02 | 0x10; xBytes.push(dx); }
    else if (dx < 0 && dx >= -255) { flag |= 0x02; xBytes.push(-dx); }
    else xBytes.push((dx >> 8) & 0xff, dx & 0xff);
    if (dy === 0) flag |= 0x20;
    else if (dy > 0 && dy <= 255) { flag |= 0x04 | 0x20; yBytes.push(dy); }
    else if (dy < 0 && dy >= -255) { flag |= 0x04; yBytes.push(-dy); }
    else yBytes.push((dy >> 8) & 0xff, dy & 0xff);
    flags.push(flag);
  }
  const header = 10;
  const total = header + endPts.length * 2 + 2 + flags.length + xBytes.length + yBytes.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setInt16(0, g.contours.length, false);
  view.setInt16(2, g.minX, false); view.setInt16(4, g.minY, false);
  view.setInt16(6, g.maxX, false); view.setInt16(8, g.maxY, false);
  let off = header;
  for (const e of endPts) { view.setUint16(off, e, false); off += 2; }
  view.setUint16(off, 0, false); off += 2; // instructionLength
  out.set(flags, off); off += flags.length;
  out.set(xBytes, off); off += xBytes.length;
  out.set(yBytes, off);
  return out;
}

function pad4(bytes: Uint8Array): Uint8Array {
  if (bytes.length % 4 === 0) return bytes;
  const out = new Uint8Array(bytes.length + (4 - (bytes.length % 4)));
  out.set(bytes);
  return out;
}

export function sfntChecksum(bytes: Uint8Array): number {
  const padded = pad4(bytes);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i, false)) >>> 0;
  return sum >>> 0;
}

export function listSfntTables(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const num = view.getUint16(4, false);
  const tags: string[] = [];
  for (let i = 0; i < num; i++) {
    const off = 12 + i * 16;
    tags.push(String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]));
  }
  return tags;
}

function buildCmap4(entries: Array<{ unicode: number; gid: number }>): Uint8Array {
  // One segment per encoded glyph plus the final 0xFFFF terminator.
  const sorted = entries.filter((e) => e.unicode <= 0xffff).sort((a, b) => a.unicode - b.unicode);
  const segCount = sorted.length + 1;
  const headerLen = 16 + segCount * 8 + sorted.length * 2;
  const out = new Uint8Array(12 + headerLen);
  const view = new DataView(out.buffer);
  // cmap header + format 4 subtable header.
  view.setUint16(0, 0, false); view.setUint16(2, 1, false);
  view.setUint16(4, 3, false); view.setUint16(6, 1, false); view.setUint32(8, 12, false);
  const base = 12;
  view.setUint16(base + 0, 4, false); view.setUint16(base + 2, headerLen, false);
  view.setUint16(base + 4, 0, false); view.setUint16(base + 6, segCount * 2, false);
  const pow = Math.pow(2, Math.floor(Math.log2(segCount)));
  view.setUint16(base + 8, pow * 2, false);
  view.setUint16(base + 10, Math.floor(Math.log2(pow)), false);
  view.setUint16(base + 12, segCount * 2 - pow * 2, false);
  let off = base + 14;
  for (const e of sorted) { view.setUint16(off, e.unicode, false); off += 2; }
  view.setUint16(off, 0xffff, false); off += 2;
  view.setUint16(off, 0, false); off += 2; // reservedPad
  for (const e of sorted) { view.setUint16(off, e.unicode, false); off += 2; }
  view.setUint16(off, 0xffff, false); off += 2;
  for (let i = 0; i < segCount; i++) { view.setInt16(off, 0, false); off += 2; } // idDelta (glyphIdArray used)
  // idRangeOffsets: with one glyph per segment, each offset lands on its
  // glyphIdArray entry, which is segCount*2 bytes ahead of the field itself.
  for (let i = 0; i < sorted.length; i++) {
    view.setUint16(off, segCount * 2, false);
    off += 2;
  }
  view.setUint16(off, 0, false); off += 2;
  for (const e of sorted) { view.setUint16(off, e.gid, false); off += 2; }
  return out;
}

function buildCmap12Subtable(entries: Array<{ unicode: number; gid: number }>): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.unicode - b.unicode);
  const out = new Uint8Array(16 + sorted.length * 12);
  const view = new DataView(out.buffer);
  view.setUint16(0, 12, false); view.setUint16(2, 0, false);
  view.setUint32(4, out.length, false); view.setUint32(8, 0, false);
  view.setUint32(12, sorted.length, false);
  sorted.forEach((e, i) => {
    const off = 16 + i * 12;
    view.setUint32(off, e.unicode, false);
    view.setUint32(off + 4, e.unicode, false);
    view.setUint32(off + 8, e.gid, false);
  });
  return out;
}

function buildCmap(entries: Array<{ unicode: number; gid: number }>): Uint8Array {
  if (!entries.some((e) => e.unicode > 0xffff)) return buildCmap4(entries);
  const fmt4Full = buildCmap4(entries);
  const fmt4 = fmt4Full.slice(12); // subtable only, cmap header replaced below
  const fmt12 = buildCmap12Subtable(entries);
  const headerLen = 4 + 2 * 8;
  const out = new Uint8Array(headerLen + fmt4.length + fmt12.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, false); view.setUint16(2, 2, false);
  view.setUint16(4, 3, false); view.setUint16(6, 1, false); view.setUint32(8, headerLen, false);
  view.setUint16(12, 3, false); view.setUint16(14, 10, false); view.setUint32(16, headerLen + fmt4.length, false);
  out.set(fmt4, headerLen);
  out.set(fmt12, headerLen + fmt4.length);
  return out;
}

function buildNameTable(family: string, style: string): Uint8Array {
  const records: Array<{ id: number; text: string }> = [
    { id: 1, text: family }, { id: 2, text: style },
    { id: 4, text: `${family} ${style}` }, { id: 6, text: `${family}-${style}`.replace(/\s+/g, "") },
  ];
  const strings: Uint8Array[] = [];
  let storage = 0;
  const headerLen = 6 + records.length * 2 * 12;
  for (const r of records) {
    // Platform 3 (UTF-16BE) and platform 1 (Mac Roman, ASCII-safe fallback).
    const utf16 = new Uint8Array(r.text.length * 2);
    for (let i = 0; i < r.text.length; i++) { utf16[i * 2] = 0; utf16[i * 2 + 1] = r.text.charCodeAt(i) & 0xff; }
    strings.push(utf16);
    strings.push(new TextEncoder().encode(r.text.replace(/[^\x20-\x7e]/g, "?")));
    storage += utf16.length + r.text.length;
  }
  const out = new Uint8Array(headerLen + storage);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, false); view.setUint16(2, records.length * 2, false); view.setUint16(4, headerLen, false);
  let recOff = 6;
  let strOff = 0;
  let sIdx = 0;
  for (const r of records) {
    const utf16 = strings[sIdx]; const mac = strings[sIdx + 1]; sIdx += 2;
    view.setUint16(recOff, 3, false); view.setUint16(recOff + 2, 1, false); view.setUint16(recOff + 4, 0x409, false);
    view.setUint16(recOff + 6, r.id, false); view.setUint16(recOff + 8, utf16.length, false); view.setUint16(recOff + 10, strOff, false);
    out.set(utf16, headerLen + strOff); strOff += utf16.length; recOff += 12;
    view.setUint16(recOff, 1, false); view.setUint16(recOff + 2, 0, false); view.setUint16(recOff + 4, 0, false);
    view.setUint16(recOff + 6, r.id, false); view.setUint16(recOff + 8, mac.length, false); view.setUint16(recOff + 10, strOff, false);
    out.set(mac, headerLen + strOff); strOff += mac.length; recOff += 12;
  }
  return out;
}

export function fontToTtfBytes(font: Font): Uint8Array<ArrayBuffer> {
  const masterId = font.currentMasterId;
  const notdef: Glyph = {
    name: ".notdef", unicode: 0, width: 500, lsb: 0, rsb: 0, category: "",
    kerningGroupLeft: "", kerningGroupRight: "", anchors: [], components: [],
    metricsKeyLeft: "", metricsKeyRight: "", layers: {},
  };
  const glyphs: Glyph[] = [notdef, ...font.glyphs];
  const glyfs = glyphs.map((g, idx) => {
    if (idx === 0) return glyphToGlyf([]);
    return glyphToGlyf(resolveGlyphContours(font, g, masterId));
  });
  const encoded = glyfs.map((g) => encodeGlyph(g));
  // glyf + loca.
  let glyfLen = 0;
  const offsets: number[] = [];
  for (const e of encoded) { offsets.push(glyfLen); glyfLen += e.length + (e.length % 2); }
  offsets.push(glyfLen);
  const useShortLoca = glyfLen < 0x20000;
  const glyfTable = new Uint8Array(glyfLen);
  encoded.forEach((e, i) => glyfTable.set(e, offsets[i]));
  const locaTable = new Uint8Array(offsets.length * (useShortLoca ? 2 : 4));
  {
    const view = new DataView(locaTable.buffer);
    offsets.forEach((o, i) => { if (useShortLoca) view.setUint16(i * 2, o / 2, false); else view.setUint32(i * 4, o, false); });
  }
  // Global bounds + hmtx.
  let gxMin = 0, gyMin = 0, gxMax = 0, gyMax = 0;
  glyfs.forEach((g, i) => { if (!encoded[i].length) return; gxMin = Math.min(gxMin, g.minX); gyMin = Math.min(gyMin, g.minY); gxMax = Math.max(gxMax, g.maxX); gyMax = Math.max(gyMax, g.maxY); });
  const hmtx = new Uint8Array(glyphs.length * 4);
  {
    const view = new DataView(hmtx.buffer);
    glyphs.forEach((g, i) => { view.setUint16(i * 4, Math.max(0, g.width || 0), false); view.setInt16(i * 4 + 2, encoded[i].length ? glyfs[i].minX : 0, false); });
  }
  const nowSec = Math.floor(Date.now() / 1000) + 2082844800;
  const tables = new Map<string, Uint8Array>();
  const head = new Uint8Array(54);
  {
    const view = new DataView(head.buffer);
    view.setUint32(0, 0x00010000, false); view.setUint32(4, 0x00010000, false);
    view.setUint32(8, 0, false); // checkSumAdjustment (patched later)
    view.setUint32(12, 0x5f0f3cf5, false);
    view.setUint16(16, 0, false); view.setUint16(18, font.unitsPerEm || 1000, false);
    view.setBigUint64(20, BigInt(nowSec), false); view.setBigUint64(28, BigInt(nowSec), false);
    view.setInt16(36, gxMin, false); view.setInt16(38, gyMin, false); view.setInt16(40, gxMax, false); view.setInt16(42, gyMax, false);
    view.setUint16(44, 0, false); view.setUint16(46, 8, false);
    view.setInt16(48, useShortLoca ? 0 : 1, false); view.setInt16(50, 0, false); view.setInt16(52, 0, false);
  }
  tables.set("head", head);
  const maxp = new Uint8Array(32);
  {
    const view = new DataView(maxp.buffer);
    view.setUint32(0, 0x00010000, false); view.setUint16(4, glyphs.length, false);
    const maxPoints = Math.max(0, ...glyfs.map((g) => g.contours.reduce((n, c) => n + c.length, 0)));
    const maxContours = Math.max(0, ...glyfs.map((g) => g.contours.length));
    view.setUint16(6, maxPoints, false); view.setUint16(8, maxContours, false);
    view.setUint16(10, maxPoints, false); view.setUint16(12, maxContours, false);
    view.setUint16(14, 2, false); view.setUint16(28, 1, false); view.setUint16(30, 1, false);
  }
  tables.set("maxp", maxp);
  const hhea = new Uint8Array(36);
  {
    const view = new DataView(hhea.buffer);
    view.setUint32(0, 0x00010000, false);
    view.setInt16(4, font.ascender || 800, false); view.setInt16(6, font.descender || -200, false); view.setInt16(8, 0, false);
    view.setUint16(10, Math.max(0, ...glyphs.map((g) => g.width || 0)), false);
    view.setInt16(12, Math.min(0, ...glyfs.map((g) => g.minX)), false);
    view.setInt16(14, 0, false); view.setInt16(16, gxMax, false);
    view.setInt16(18, 1, false); view.setInt16(20, 0, false); view.setInt16(22, 0, false);
    view.setInt16(34, glyphs.length, false);
  }
  tables.set("hhea", hhea);
  tables.set("hmtx", hmtx);
  tables.set("glyf", glyfTable);
  tables.set("loca", locaTable);
  tables.set("cmap", buildCmap(glyphs.map((g, gid) => ({ unicode: g.unicode ?? -1, gid })).filter((e) => e.unicode >= 0)));
  tables.set("name", buildNameTable(font.familyName || "Untitled", "Regular"));
  const os2 = new Uint8Array(68);
  {
    const view = new DataView(os2.buffer);
    view.setUint16(0, 0, false); view.setInt16(2, Math.round(glyphs.reduce((s, g) => s + (g.width || 0), 0) / Math.max(1, glyphs.length)), false);
    view.setUint16(4, 400, false); view.setUint16(6, 5, false); view.setUint16(8, 0, false);
    // achVendID "GWMB" at 58; fsSelection (62) regular = 0.
    os2.set([0x47, 0x57, 0x4d, 0x42], 58);
    const unicodes = glyphs.map((g) => g.unicode ?? -1).filter((u) => u >= 0);
    view.setUint16(64, unicodes.length ? Math.min(...unicodes) : 0, false);
    view.setUint16(66, unicodes.length ? Math.min(0xffff, Math.max(...unicodes)) : 0, false);
  }
  tables.set("OS/2", os2);
  const post = new Uint8Array(32);
  {
    const view = new DataView(post.buffer);
    view.setUint32(0, 0x00030000, false);
  }
  tables.set("post", post);
  return assembleSfnt(tables);
}

export function assembleSfnt(tables: Map<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  const tags = [...tables.keys()].sort();
  const numTables = tags.length;
  const dirLen = 12 + numTables * 16;
  let offset = dirLen;
  const placed = new Map<string, { data: Uint8Array; offset: number }>();
  for (const tag of tags) {
    const data = tables.get(tag) as Uint8Array;
    placed.set(tag, { data, offset });
    offset += pad4(data).length;
  }
  const out = new Uint8Array(offset);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x00010000, false);
  view.setUint16(4, numTables, false);
  const pow = Math.pow(2, Math.floor(Math.log2(numTables)));
  view.setUint16(6, pow * 16, false); view.setUint16(8, Math.floor(Math.log2(pow)), false); view.setUint16(10, numTables * 16 - pow * 16, false);
  tags.forEach((tag, i) => {
    const rec = 12 + i * 16;
    const entry = placed.get(tag) as { data: Uint8Array; offset: number };
    out.set(new TextEncoder().encode(tag), rec);
    view.setUint32(rec + 4, sfntChecksum(entry.data), false);
    view.setUint32(rec + 8, entry.offset, false);
    view.setUint32(rec + 12, entry.data.length, false);
    out.set(entry.data, entry.offset);
  });
  // Patch head checkSumAdjustment so the whole font sums to 0xB1B0AFBA.
  const headEntry = placed.get("head");
  if (headEntry) {
    const total = sfntChecksum(out);
    view.setUint32(headEntry.offset + 8, (0xb1b0afba - total) >>> 0, false);
  }
  return out as Uint8Array<ArrayBuffer>;
}

