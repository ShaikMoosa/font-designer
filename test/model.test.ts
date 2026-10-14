import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultFont, contourToPathD, rectContour, glyphBounds } from "../src/model.ts";
import { fontToGlyphsJson, glyphsJsonToFont } from "../src/glyphs-io.ts";
import { fontToUfoZip, unzipToMap, glyphToGlif } from "../src/ufo.ts";

test("default font has editable starter glyphs", () => {
  const font = createDefaultFont();
  assert.ok(font.glyphs.length >= 10);
  const a = font.glyphs.find((g) => g.name === "A");
  assert.ok(a);
  assert.ok(a.layers.masterRegular.paths.length >= 2);
  const d = contourToPathD(a.layers.masterRegular.paths[0]);
  assert.match(d, /^M /);
  const b = glyphBounds(a, "masterRegular");
  assert.ok(b);
  assert.equal(b.maxY, 700);
});

test("rect contour path closes", () => {
  const d = contourToPathD(rectContour(0, 0, 100, 200));
  assert.match(d, /Z$/);
});

test("glyphs JSON round-trips glyphs and kerning", () => {
  const font = createDefaultFont();
  const back = glyphsJsonToFont(fontToGlyphsJson(font), "roundtrip.glyphs");
  assert.equal(back.familyName, font.familyName);
  assert.equal(back.glyphs.length, font.glyphs.length);
  assert.equal(back.kerning["A|V"], -70);
  const a = back.glyphs.find((g) => g.name === "A");
  assert.ok(a);
  assert.equal(a.layers.masterRegular.paths.length, 2);
});

test("UFO zip contains GLIF, contents and kerning", async () => {
  const font = createDefaultFont();
  const zip = fontToUfoZip(font);
  assert.equal(zip[0], 0x50); // 'P'
  assert.equal(zip[1], 0x4b); // 'K'
  const map = await unzipToMap(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer);
  assert.ok(map.has("glyphs/contents.plist"));
  assert.ok(map.has("glyphs/A.glif"));
  assert.ok(map.has("kerning.plist"));
  const glifBytes = map.get("glyphs/A.glif");
  assert.ok(glifBytes);
  const glif = new TextDecoder().decode(glifBytes);
  assert.match(glif, /<glyph name="A"/);
  assert.match(glif, /<advance width="680"\/>/);
  const aGlyph = font.glyphs.find((g) => g.name === "A");
  assert.ok(aGlyph);
  const direct = glyphToGlif(aGlyph, "masterRegular");
  assert.match(direct, /<contour>/);
});
