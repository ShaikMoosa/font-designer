import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultFont, findGlyph, categoryForGlyph, scriptForGlyph, thumbCanvasSize, fontViewCountText, fontViewSelectionText, updateGlyphSelection, editNavigatorGlyphs } from "../src/model.ts";
import type { Glyph } from "../src/model.ts";

function glyph(name: string, unicode: number | null, category: string): Glyph {
  return {
    name, unicode, width: 500, lsb: 0, rsb: 0, category,
    kerningGroupLeft: "", kerningGroupRight: "", anchors: [], components: [],
    metricsKeyLeft: "", metricsKeyRight: "", layers: {},
  };
}

test("Font View script buckets follow Unicode ranges", () => {
  assert.equal(scriptForGlyph(glyph("A", 0x41, "Letter")), "Latin");
  assert.equal(scriptForGlyph(glyph("Alpha", 0x3b1, "Letter")), "Greek");
  assert.equal(scriptForGlyph(glyph("Zhe", 0x436, "Letter")), "Cyrillic");
  assert.equal(scriptForGlyph(glyph("Alef", 0x5d0, "Letter")), "Hebrew");
  assert.equal(scriptForGlyph(glyph("Beh", 0x628, "Letter")), "Arabic");
  assert.equal(scriptForGlyph(glyph("Ka", 0x915, "Letter")), "Devanagari");
  assert.equal(scriptForGlyph(glyph("A-jp", 0x3042, "Letter")), "Japanese");
  assert.equal(scriptForGlyph(glyph("Zhong", 0x4e2d, "Letter")), "Chinese");
  assert.equal(scriptForGlyph(glyph("Han", 0xac00, "Letter")), "Korean");
  assert.equal(scriptForGlyph(glyph("custom", null, "Letter")), "No Unicode");
  assert.equal(scriptForGlyph(glyph("emoji", 0x1f600, "Symbol")), "Other");
});

test("Font View categories normalize unknown values to Other", () => {
  assert.equal(categoryForGlyph(glyph("A", 0x41, "Letter")), "Letter");
  assert.equal(categoryForGlyph(glyph("acutecomb", 0x301, "Mark")), "Mark");
  assert.equal(categoryForGlyph(glyph("thing", null, "Weird")), "Other");
  assert.equal(categoryForGlyph(glyph("thing2", null, "")), "Other");
  const font = createDefaultFont();
  assert.equal(scriptForGlyph(findGlyph(font, "A") as Glyph), "Latin");
  assert.equal(categoryForGlyph(findGlyph(font, "space") as Glyph), "Separator");
});

test("Font View thumbnails scale with cell size and pixel ratio", () => {
  assert.deepEqual(thumbCanvasSize(88, 1), { width: 88, height: 63 });
  assert.deepEqual(thumbCanvasSize(160, 2), { width: 320, height: 230 });
  assert.deepEqual(thumbCanvasSize(10, 1), { width: 56, height: 40 });
  assert.deepEqual(thumbCanvasSize(88, 3), { width: 176, height: 127 });
});

test("Font View count text names the selection only when present", () => {
  assert.equal(fontViewCountText("A", 3, 12), "A selected · 3/12 glyphs");
  assert.equal(fontViewCountText("", 3, 12), "3/12 glyphs");
  assert.equal(fontViewCountText("", 0, 12), "0/12 glyphs");
});

test("Font View multi-selection status reports selected, visible, and total counts", () => {
  assert.equal(fontViewSelectionText(3, 24, 800), "3 selected · 24 visible · 800 total");
  assert.equal(fontViewSelectionText(0, 0, 800), "0 selected · 0 visible · 800 total");
});

test("Font View selection follows replace, Ctrl-toggle, and Shift-range semantics", () => {
  const shown = ["A", "B", "C", "D", "E"];
  assert.deepEqual(updateGlyphSelection(["A"], shown, "C", "replace", "A"), ["C"]);
  assert.deepEqual(updateGlyphSelection(["B"], shown, "D", "toggle", "B"), ["B", "D"]);
  assert.deepEqual(updateGlyphSelection(["B", "D"], shown, "B", "toggle", "B"), ["D"]);
  assert.deepEqual(updateGlyphSelection(["B"], shown, "E", "range", "B"), ["B", "C", "D", "E"]);
  assert.deepEqual(updateGlyphSelection(["A"], shown, "D", "range", "missing"), ["D"]);
});

test("Edit navigator scopes all, related, and open glyph workflows", () => {
  const font = createDefaultFont();
  const related = editNavigatorGlyphs(font, "A", "related", ["A"], "");
  assert.ok(related.some((item) => item.name === "V"));
  assert.ok(!related.some((item) => item.name === "period"));
  assert.deepEqual(editNavigatorGlyphs(font, "A", "open", ["A", "period"], "").map((item) => item.name), ["A", "period"]);
  assert.deepEqual(editNavigatorGlyphs(font, "A", "all", [], "u+0065").map((item) => item.name), ["e"]);
  const e = findGlyph(font, "e") as Glyph;
  e.tags = ["proofing"];
  assert.deepEqual(editNavigatorGlyphs(font, "A", "all", [], "proofing").map((item) => item.name), ["e"]);
});
