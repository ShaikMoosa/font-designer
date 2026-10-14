// Beta OTF export via opentype.js. Outlines are written from the current
// master; unencoded glyphs are included as unmapped glyphs where possible.
import opentype from "opentype.js";
import { contourToPathD } from "./model.js";

function contourCommands(contour, path) {
  // Reuse the SVG segment walk by parsing our own "d" string back into
  // moveto/lineto/curveto commands (font coords are already Y-up).
  const d = contourToPathD(contour);
  if (!d) return;
  const tokens = d.match(/[MLCZ]|-?\d+(?:\.\d+)?/g) || [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === "M") path.moveTo(+tokens[i++], +tokens[i++]);
    else if (cmd === "L") path.lineTo(+tokens[i++], +tokens[i++]);
    else if (cmd === "C") path.curveTo(+tokens[i++], +tokens[i++], +tokens[i++], +tokens[i++], +tokens[i++], +tokens[i++]);
    else if (cmd === "Z") path.closePath();
  }
}

export function fontToOtfArrayBuffer(font) {
  const masterId = font.currentMasterId;
  const glyphs = [];
  glyphs.push(new opentype.Glyph({ name: ".notdef", unicode: 0, advanceWidth: 500, path: new opentype.Path() }));
  for (const g of font.glyphs) {
    const path = new opentype.Path();
    const layer = g.layers[masterId];
    if (layer) for (const c of layer.paths) contourCommands(c, path);
    glyphs.push(new opentype.Glyph({
      name: g.name,
      unicode: g.unicode != null ? g.unicode : undefined,
      advanceWidth: Math.max(0, g.width || 500),
      path,
    }));
  }
  const otf = new opentype.Font({
    familyName: font.familyName || "Untitled",
    styleName: "Regular",
    unitsPerEm: font.unitsPerEm || 1000,
    ascender: font.ascender || 800,
    descender: font.descender || -200,
    glyphs,
  });
  // Kerning pairs for encoded glyphs.
  const indexByName = new Map(glyphs.map((g, idx) => [g.name, idx]));
  for (const [key, value] of Object.entries(font.kerning || {})) {
    const [l, r] = key.split("|");
    if (indexByName.has(l) && indexByName.has(r) && value) {
      try { otf.kerningPairs[`${indexByName.get(l)},${indexByName.get(r)}`] = value; } catch { /* keep export going */ }
    }
  }
  return otf.toArrayBuffer();
}
