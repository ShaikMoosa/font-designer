// Font data model for the Windows MVP. Coordinates are font units, Y-up,
// baseline y=0. A glyph stores width/lsb/rsb plus one layer per master.
// Each layer holds contours; a contour is an ordered node list where
// type is "line" | "curve" | "smooth" (on-curve) or "offcurve" (handle).
export const KAPPA = 0.5522847498307936;

export function lineNode(x, y) { return { x: Math.round(x), y: Math.round(y), type: "line" }; }
export function curveNode(x, y) { return { x: Math.round(x), y: Math.round(y), type: "curve" }; }
export function offNode(x, y) { return { x: Math.round(x), y: Math.round(y), type: "offcurve" }; }

export function rectContour(x, y, w, h) {
  return {
    closed: true,
    nodes: [lineNode(x, y), lineNode(x + w, y), lineNode(x + w, y + h), lineNode(x, y + h)],
  };
}

export function ellipseContour(cx, cy, rx, ry) {
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

export function translateContour(c, dx, dy) {
  c.nodes.forEach((n) => { n.x += dx; n.y += dy; });
  return c;
}

// Build an SVG path "d" for a contour (Y-up font coords; caller flips Y).
export function contourToPathD(contour) {
  const pts = contour.nodes;
  if (!pts.length) return "";
  // Rotate so we start at an on-curve point when possible.
  let startIdx = pts.findIndex((p) => p.type !== "offcurve");
  if (startIdx < 0) return "";
  const seq = pts.slice(startIdx).concat(pts.slice(0, startIdx));
  const parts = [`M ${seq[0].x} ${seq[0].y}`];
  let i = 1;
  const n = seq.length;
  const take = () => seq[i++ % n];
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
    void take;
  }
  if (contour.closed) parts.push("Z");
  return parts.join(" ");
}

export function glyphToPathD(glyph, masterId) {
  const layer = glyph.layers[masterId];
  if (!layer) return "";
  return layer.paths.map(contourToPathD).filter(Boolean).join(" ");
}

export function contourBounds(contour) {
  if (!contour.nodes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of contour.nodes) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function glyphBounds(glyph, masterId) {
  const layer = glyph.layers[masterId];
  if (!layer || !layer.paths.length) return null;
  let out = null;
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

export function kernKey(left, right) { return `${left}|${right}`; }
export function getKern(font, left, right) {
  return font.kerning[kernKey(left, right)] || 0;
}

function makeGlyph(name, unicode, width, contours, extra = {}) {
  return {
    name, unicode, width,
    lsb: extra.lsb ?? 40, rsb: extra.rsb ?? 40,
    category: extra.category || "Letter",
    kerningGroupLeft: extra.kerningGroupLeft || "",
    kerningGroupRight: extra.kerningGroupRight || "",
    anchors: extra.anchors || [],
    layers: { masterRegular: { paths: contours } },
  };
}

// Original geometric starter glyphs (drawn for this MVP, not copied outlines).
export function createDefaultFont() {
  const glyphs = [];
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
    currentMasterId: "masterRegular",
    fileName: "Untitled.glyphs",
  };
}

export function findGlyph(font, name) { return font.glyphs.find((g) => g.name === name); }

export function syncBearings(font, glyph) {
  const b = glyphBounds(glyph, font.currentMasterId);
  if (!b) return;
  glyph.lsb = Math.round(b.minX);
  glyph.rsb = Math.round(glyph.width - b.maxX);
}

export function cloneFont(font) { return JSON.parse(JSON.stringify(font)); }
