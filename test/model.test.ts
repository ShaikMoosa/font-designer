import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultFont, contourToPathD, rectContour, glyphBounds,
  resolveGlyphContours, interpolateGlyphAt, resolveKern, findGlyph,
  simplifyPoints, pencilContour, measureBetween, alignPoints,
} from "../src/model.ts";
import { fontToGlyphsJson, glyphsJsonToFont, parseOpenStep } from "../src/glyphs-io.ts";
import { fontToUfoZip, unzipToMap, glyphToGlif } from "../src/ufo.ts";
import { parseFeatureCode, shapeText } from "../src/shaping.ts";
import { flattenContour, unionContours, fixContourDirections } from "../src/pathsurgery.ts";
import { fontToTtfBytes, listSfntTables, sfntChecksum } from "../src/ttf.ts";
import { fontToWoffBytes, parseSfntTables } from "../src/woff.ts";
import { validateFont } from "../src/validate.ts";
import { fontToDesignspaceBundle } from "../src/ufo.ts";

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
  assert.ok(map.has("designspace.json"));
  assert.ok(map.has("kerning-groups.plist"));
});

const OPENSTEP_FIXTURE = `{
  familyName = FixtureSans;
  unitsPerEm = 1000;
  fontMaster = (
    { id = "m-regular"; name = Regular; weightValue = 400; ascender = 800; descender = -200; capHeight = 700; xHeight = 500; },
    { id = "m-bold"; name = Bold; weightValue = 700; ascender = 800; descender = -200; capHeight = 700; xHeight = 500; }
  );
  glyphs = (
    {
      glyphname = A; unicode = 0041;
      layers = (
        { layerId = "m-regular"; width = 600; paths = ( { closed = 1; nodes = ( "0 0 LINE", "300 700 LINE", "600 0 LINE" ); } ); anchors = ( { name = top; position = "{300, 700}"; } ); },
        { layerId = "m-bold"; width = 640; paths = ( { closed = 1; nodes = ( "0 0 LINE", "320 700 LINE", "640 0 LINE" ); } ); }
      );
    },
    {
      glyphname = Aacute; unicode = 00C1;
      layers = (
        { layerId = "m-regular"; width = 600; components = ( { name = A; transform = "{1, 0, 0, 1, 10, 20}"; } ); }
      );
    }
  );
  kerning = { "@A" = { "@Aacute" = -30; }; };
}`;

test("OpenStep .glyphs imports masters, anchors, components, kerning", () => {
  const parsed = parseOpenStep(OPENSTEP_FIXTURE) as { familyName?: string };
  assert.equal(parsed.familyName, "FixtureSans");
  const font = glyphsJsonToFont(OPENSTEP_FIXTURE, "Fixture.glyphs");
  assert.equal(font.familyName, "FixtureSans");
  assert.equal(font.masters.length, 2);
  assert.equal(font.glyphs.length, 2);
  const a = findGlyph(font, "A");
  assert.ok(a);
  assert.equal(a.anchors.length, 1);
  assert.equal(a.anchors[0].x, 300);
  const aacute = findGlyph(font, "Aacute");
  assert.ok(aacute);
  assert.equal(aacute.components.length, 1);
  assert.equal(aacute.components[0].glyph, "A");
  assert.equal(aacute.components[0].x, 10);
  assert.equal(font.kerning["A|Aacute"], -30);
  // Component resolution pulls the (translated) base contours in.
  const resolved = resolveGlyphContours(font, aacute, "m-regular");
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].nodes[0].x, 10);
});

test("interpolation morphs nodes and rejects single-master fonts", () => {
  const font = glyphsJsonToFont(OPENSTEP_FIXTURE, "Fixture.glyphs");
  const mid = interpolateGlyphAt(font, "A", 0.5);
  assert.ok(mid);
  const paths = mid.layers[font.currentMasterId].paths;
  assert.equal(paths[0].nodes[1].x, 310);
  const single = createDefaultFont();
  assert.equal(interpolateGlyphAt(single, "A", 0.5), null);
});

test("kerning groups resolve only without an exact pair", () => {
  const font = createDefaultFont();
  const a = findGlyph(font, "A");
  const v = findGlyph(font, "V");
  assert.ok(a && v);
  a.kerningGroupRight = "A";
  v.kerningGroupLeft = "V";
  font.kerningGroups["A|V"] = -45;
  delete font.kerning["A|V"];
  assert.equal(resolveKern(font, "A", "V"), -45);
  font.kerning["A|V"] = -99;
  assert.equal(resolveKern(font, "A", "V"), -99);
});

test("feature subset shapes ligatures and feature kerning", () => {
  const font = createDefaultFont();
  // Add f, i, fi glyphs so the ligature rule can fire.
  for (const [name, uni] of [["f", 0x66], ["i", 0x69], ["fi", 0xFB01]] as Array<[string, number]>) {
    font.glyphs.push({
      name, unicode: uni, width: 300, lsb: 20, rsb: 20, category: "Letter",
      kerningGroupLeft: "", kerningGroupRight: "", anchors: [], components: [],
      metricsKeyLeft: "", metricsKeyRight: "", layers: { masterRegular: { paths: [] } },
    });
  }
  font.featureCode = "@Upper = [A V];\nsub f i by fi;\npos @Upper V -111;\n";
  const parsed = parseFeatureCode(font.featureCode);
  assert.equal(parsed.subs.length, 1);
  assert.equal(parsed.poss.get("A|V"), -111);
  const shaped = shapeText(font, "fi AV", parsed);
  assert.equal(shaped[0].name, "fi");
  assert.equal(shaped[0].advance, 300);
  const av = shapeText(font, "AV", parsed);
  assert.equal(av[0].advance, 680 - 111);
});

test("TTF export is a checksummed glyf font", () => {
  const font = createDefaultFont();
  const ttf = fontToTtfBytes(font);
  const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  assert.equal(view.getUint32(0, false), 0x00010000);
  const tables = listSfntTables(ttf);
  for (const tag of ["head", "maxp", "hhea", "hmtx", "glyf", "loca", "cmap", "name", "OS/2", "post"]) {
    assert.ok(tables.includes(tag), `missing table ${tag}`);
  }
  assert.equal(sfntChecksum(ttf), 0xb1b0afba);
  const parsed = parseSfntTables(ttf);
  const glyf = parsed.find((t) => t.tag === "glyf");
  assert.ok(glyf && glyf.data.length > 200);
  const maxp = parsed.find((t) => t.tag === "maxp");
  assert.ok(maxp);
  assert.equal(new DataView(maxp.data.buffer, maxp.data.byteOffset).getUint16(4, false), font.glyphs.length + 1);
});

test("WOFF wraps the TTF with matching lengths", async () => {
  const font = createDefaultFont();
  const ttf = fontToTtfBytes(font);
  const woff = await fontToWoffBytes(ttf);
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  assert.equal(view.getUint32(0, false), 0x774f4646); // wOFF
  assert.equal(view.getUint32(16, false), ttf.length);
  assert.equal(view.getUint32(4, false), 0x00010000); // flavor = TrueType
});

test("validation blocks duplicates and missing components only", () => {
  const good = validateFont(createDefaultFont());
  assert.equal(good.ok, true);
  assert.equal(good.errors.length, 0);
  const bad = createDefaultFont();
  const a = findGlyph(bad, "A");
  const v = findGlyph(bad, "V");
  assert.ok(a && v);
  v.unicode = a.unicode;
  a.components = [{ glyph: "missingbase", x: 0, y: 0, scaleX: 1, scaleY: 1 }];
  const report = validateFont(bad);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((e) => e.message.includes("Unicode")));
  assert.ok(report.errors.some((e) => e.message.includes("missingbase")));
});

test("designspace bundle carries one UFO per master", async () => {
  const font = glyphsJsonToFont(OPENSTEP_FIXTURE, "Fixture.glyphs");
  const bundle = fontToDesignspaceBundle(font);
  const map = await unzipToMap(bundle.buffer.slice(bundle.byteOffset, bundle.byteOffset + bundle.byteLength) as ArrayBuffer);
  assert.ok(map.has("designspace.json"));
  const keys = [...map.keys()];
  assert.ok(keys.some((k) => k.startsWith("masters/m-regular/glyphs/")));
  assert.ok(keys.some((k) => k.startsWith("masters/m-bold/glyphs/")));
});

test("pencil points simplify and become an editable contour", () => {
  const raw = [
    { x: 0, y: 0 }, { x: 10, y: 1 }, { x: 20, y: -1 }, { x: 30, y: 0 },
    { x: 40, y: 40 }, { x: 50, y: 80 }, { x: 52, y: 120 },
  ];
  const simplified = simplifyPoints(raw, 3);
  assert.ok(simplified.length < raw.length);
  assert.deepEqual(simplified[0], { x: 0, y: 0 });
  assert.deepEqual(simplified[simplified.length - 1], { x: 52, y: 120 });
  const contour = pencilContour(raw, 3);
  assert.ok(contour);
  assert.equal(contour.closed, false);
  assert.ok(contour.nodes.length >= 3);
  assert.ok(contour.nodes.every((n) => n.type === "line"));
  assert.equal(pencilContour([{ x: 5, y: 5 }]), null);
});

test("measure reports distance and angle", () => {
  const m = measureBetween({ x: 0, y: 0 }, { x: 30, y: 40 });
  assert.equal(m.distance, 50);
  assert.equal(m.dx, 30);
  assert.equal(m.dy, 40);
  assert.ok(Math.abs(m.angleDeg - 53.13) < 0.01);
  const flat = measureBetween({ x: 10, y: 10 }, { x: 110, y: 10 });
  assert.equal(flat.angleDeg, 0);
});

test("align moves points to shared edges and distributes evenly", () => {
  const pts = [{ x: 10, y: 0 }, { x: 50, y: 20 }, { x: 30, y: 40 }];
  assert.deepEqual(alignPoints(pts, "left").map((p) => p.x), [10, 10, 10]);
  assert.deepEqual(alignPoints(pts, "right").map((p) => p.x), [50, 50, 50]);
  assert.deepEqual(alignPoints(pts, "top").map((p) => p.y), [40, 40, 40]);
  assert.deepEqual(alignPoints(pts, "bottom").map((p) => p.y), [0, 0, 0]);
  assert.deepEqual(alignPoints(pts, "hcenter").map((p) => p.x), [30, 30, 30]);
  const spread = alignPoints([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 100, y: 0 }], "distX");
  assert.deepEqual(spread.map((p) => p.x), [0, 50, 100]);
  // Input points are not mutated.
  assert.equal(pts[1].x, 50);
});

test("path surgery flattens, unions overlaps, fixes direction", () => {
  const ring = flattenContour(rectContour(0, 0, 100, 100));
  assert.ok(ring.length >= 4);
  const merged = unionContours([rectContour(0, 0, 100, 100), rectContour(50, 50, 100, 100)]);
  assert.equal(merged.length, 1);
  const b = glyphBounds({ layers: { m: { paths: merged } } } as never, "m");
  assert.ok(b);
  assert.equal(b.maxX, 150);
  const cw = rectContour(0, 0, 100, 100);
  cw.nodes.reverse();
  const contours = [cw];
  assert.equal(fixContourDirections(contours), 1);
  assert.equal(fixContourDirections(contours), 0);
});
