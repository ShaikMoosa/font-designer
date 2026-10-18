// Phase 10 — Font View and glyph data: glyph-info suggestions, production
// names, tags/color/case/note fields, rename with reference updates,
// batch glyph-info application, Font View filters, glyph order, and
// interchange round-trips (.glyphs JSON/OpenStep, UFO GLIF lib).
import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultFont, findGlyph, applyGlyphInfo, renameGlyph, moveGlyphInOrder,
  glyphMatchesFilter, sortGlyphsForDisplay, parseTags,
} from "../src/model.ts";
import type { Font, Glyph } from "../src/model.ts";
import { glyphInfoFor, glyphSuggestionFor, productionNameFor } from "../src/glyphinfo.ts";
import { fontToGlyphsJson, glyphsJsonToFont, fontToOpenStep } from "../src/glyphs-io.ts";
import { glyphToGlif } from "../src/ufo.ts";

function bareGlyph(font: Font, name: string, extra: Partial<Glyph> = {}): Glyph {
  const glyph: Glyph = {
    name, unicode: null, width: 600, lsb: 40, rsb: 40, category: "Letter",
    kerningGroupLeft: "", kerningGroupRight: "", anchors: [], components: [],
    metricsKeyLeft: "", metricsKeyRight: "",
    layers: Object.fromEntries(font.masters.map((m) => [m.id, { paths: [] }])),
    ...extra,
  };
  font.glyphs.push(glyph);
  return glyph;
}

test("glyph info covers letters, digits, punctuation and production aliases", () => {
  assert.equal(glyphInfoFor("A")?.unicode, 0x41);
  assert.equal(glyphInfoFor("A")?.glyphCase, "upper");
  assert.equal(glyphInfoFor("seven")?.unicode, 0x37);
  assert.equal(glyphInfoFor("period")?.category, "Punctuation");
  assert.equal(glyphInfoFor("middot")?.production, "periodcentered");
  assert.equal(glyphInfoFor("ss")?.production, "germandbls");
  assert.equal(glyphInfoFor("notarealglyphname"), null);
});

test("glyph suggestion falls back to a single character's codepoint", () => {
  const omega = glyphSuggestionFor("Ω");
  assert.equal(omega?.unicode, 0x03a9);
  assert.equal(omega?.category, "Letter");
  assert.equal(omega?.glyphCase, "upper");
  assert.equal(omega?.production, "uni03A9");
  assert.equal(glyphSuggestionFor("florin"), null);
});

test("production name resolution prefers stored, then info, then uniXXXX", () => {
  assert.equal(productionNameFor("A", 0x41, "A.alt"), "A.alt");
  assert.equal(productionNameFor("period", 0x2e, ""), "period");
  assert.equal(productionNameFor("myglyph", 0x1234, ""), "uni1234");
  assert.equal(productionNameFor("myglyph", null, ""), "myglyph");
});

test("rename updates components, metrics keys, and kerning pairs", () => {
  const font = createDefaultFont();
  const composite = bareGlyph(font, "e-test", {
    components: [{ glyph: "e", x: 0, y: 0, scaleX: 1, scaleY: 1 }],
    metricsKeyLeft: "e",
  });
  assert.equal(renameGlyph(font, "e", "eBase"), true);
  assert.equal(composite.components[0].glyph, "eBase");
  assert.equal(composite.metricsKeyLeft, "eBase");
  assert.equal(findGlyph(font, "eBase")?.name, "eBase");
  assert.equal(renameGlyph(font, "A", "Alpha"), true);
  assert.equal(font.kerning["Alpha|V"], -70);
  assert.equal(font.kerning["A|V"], undefined);
  assert.equal(renameGlyph(font, "Alpha", "V"), false);
  assert.equal(renameGlyph(font, "Alpha", "Alpha"), false);
  assert.equal(renameGlyph(font, "missing", "x"), false);
});

test("apply glyph info fills missing data for known names only", () => {
  const font = createDefaultFont();
  const b = bareGlyph(font, "B", { category: "Other" });
  const unknown = bareGlyph(font, "myglyph", { category: "Other" });
  const changed = applyGlyphInfo(font);
  assert.ok(changed >= 1);
  assert.equal(b.unicode, 0x42);
  assert.equal(b.category, "Letter");
  assert.equal(b.productionName, "B");
  assert.equal(b.glyphCase, "upper");
  assert.equal(unknown.unicode, null);
  assert.equal(unknown.category, "Other");
});

test("font view filters separate unicode, outline, empty, and composite glyphs", () => {
  const font = createDefaultFont();
  bareGlyph(font, "nou", {});
  bareGlyph(font, "combo", { components: [{ glyph: "e", x: 0, y: 0, scaleX: 1, scaleY: 1 }] });
  const a = findGlyph(font, "A") as Glyph;
  const space = findGlyph(font, "space") as Glyph;
  assert.equal(glyphMatchesFilter(font, a, "with-unicode"), true);
  assert.equal(glyphMatchesFilter(font, space, "empty"), true);
  assert.equal(glyphMatchesFilter(font, a, "with-outline"), true);
  assert.equal(glyphMatchesFilter(font, findGlyph(font, "nou") as Glyph, "without-unicode"), true);
  assert.equal(glyphMatchesFilter(font, findGlyph(font, "combo") as Glyph, "components"), true);
  assert.equal(glyphMatchesFilter(font, a, "colored"), false);
  a.colorLabel = 2;
  assert.equal(glyphMatchesFilter(font, a, "colored"), true);
});

test("display sorting does not disturb font order; move reorders it", () => {
  const font = createDefaultFont();
  const before = font.glyphs.map((g) => g.name);
  const byName = sortGlyphsForDisplay(font.glyphs, "name").map((g) => g.name);
  assert.deepEqual([...byName].sort(), [...before].sort());
  assert.deepEqual(font.glyphs.map((g) => g.name), before);
  assert.equal(moveGlyphInOrder(font, "space", -1), false);
  assert.equal(moveGlyphInOrder(font, "A", -1), true);
  assert.equal(font.glyphs[0].name, "A");
  assert.equal(moveGlyphInOrder(font, "A", 1), true);
  assert.equal(font.glyphs[1].name, "A");
});

test("tags parse trims, drops empties, and dedupes", () => {
  assert.deepEqual(parseTags(" latin, core ,latin,, ui "), ["latin", "core", "ui"]);
  assert.deepEqual(parseTags(""), []);
});

test("glyph data round-trips through .glyphs JSON and OpenStep", () => {
  const font = createDefaultFont();
  const a = findGlyph(font, "A") as Glyph;
  a.productionName = "A.prod";
  a.tags = ["core", "latin"];
  a.colorLabel = 3;
  a.note = "Test note";
  a.glyphCase = "upper";
  a.scriptOverride = "Latin";
  for (const roundTrip of [glyphsJsonToFont(fontToGlyphsJson(font), "rt.glyphs"), glyphsJsonToFont(fontToOpenStep(font), "rt.glyphs")]) {
    const back = findGlyph(roundTrip, "A") as Glyph;
    assert.equal(back.productionName, "A.prod");
    assert.deepEqual(back.tags, ["core", "latin"]);
    assert.equal(back.colorLabel, 3);
    assert.equal(back.note, "Test note");
    assert.equal(back.glyphCase, "upper");
    assert.equal(back.scriptOverride, "Latin");
  }
});

test("glyph data is written into the UFO GLIF lib and note", () => {
  const font = createDefaultFont();
  const a = findGlyph(font, "A") as Glyph;
  a.productionName = "A.prod";
  a.tags = ["core"];
  a.colorLabel = 7;
  a.note = "GLIF note";
  const glif = glyphToGlif(a, font.currentMasterId);
  assert.match(glif, /<note>GLIF note<\/note>/);
  assert.match(glif, /com\.glyphswindows\.productionName/);
  assert.match(glif, /<string>A\.prod<\/string>/);
  assert.match(glif, /com\.glyphswindows\.colorLabel/);
  assert.match(glif, /<integer>7<\/integer>/);
});
