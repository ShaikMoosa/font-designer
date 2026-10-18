// Phase 11 — Interpolation pro: master-compatibility report and fixes,
// piecewise interpolation through intermediate layers, instance axis
// mapping and style linking, and .glyphs round-trips for the new data.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultFont, findGlyph, cloneContours, interpolateGlyphAt,
  compatibilityReport, copyLayerBetweenMasters, instanceT, instanceAxisWeight,
} from "../src/model.ts";
import type { Font, Glyph } from "../src/model.ts";
import { fontToGlyphsJson, glyphsJsonToFont } from "../src/glyphs-io.ts";
import { fontToDesignspaceBundle, unzipToMap } from "../src/ufo.ts";

function twoMasterFont(): Font {
  const font = createDefaultFont();
  const regular = font.masters[0];
  font.masters.push({ id: "masterBold", name: "Bold", weightValue: 700 });
  for (const glyph of font.glyphs) {
    const src = glyph.layers[regular.id] || { paths: [] };
    glyph.layers.masterBold = {
      paths: src.paths.map((c) => ({
        closed: c.closed,
        nodes: c.nodes.map((n) => ({ ...n, x: n.x + 200 })),
      })),
    };
  }
  return font;
}

test("interpolation passes through intermediate layers as stops", () => {
  const font = twoMasterFont();
  const a = findGlyph(font, "A") as Glyph;
  const originalX = (a.layers.masterRegular.paths[0].nodes[0].x);
  const mid = interpolateGlyphAt(font, "A", 0.5);
  assert.equal(mid?.layers.masterRegular.paths[0].nodes[0].x, originalX + 100);
  a.intermediates = [{ axisValue: 550, paths: cloneContours(a.layers.masterRegular.paths) }];
  const throughStop = interpolateGlyphAt(font, "A", 0.5);
  assert.equal(throughStop?.layers.masterRegular.paths[0].nodes[0].x, originalX);
});

test("compatibility report names missing and mismatched layers; copy fixes them", () => {
  const font = twoMasterFont();
  const a = findGlyph(font, "A") as Glyph;
  const v = findGlyph(font, "V") as Glyph;
  delete v.layers.masterBold;
  a.layers.masterBold.paths[0].nodes.push({ x: 1, y: 1, type: "line" });
  const issues = compatibilityReport(font);
  assert.ok(issues.some((i) => i.glyphName === "V" && i.problem === "missing-layer"));
  assert.ok(issues.some((i) => i.glyphName === "A" && i.problem === "node-count"));
  assert.equal(copyLayerBetweenMasters(font, "V", "masterRegular", "masterBold"), true);
  assert.equal(copyLayerBetweenMasters(font, "A", "masterRegular", "masterBold"), true);
  assert.equal(compatibilityReport(font).length, 0);
  assert.equal(copyLayerBetweenMasters(font, "A", "masterRegular", "masterRegular"), false);
});

test("instance axis weight maps to interpolation t with clamping", () => {
  const font = twoMasterFont();
  assert.equal(instanceT(font, 400), 0);
  assert.equal(instanceT(font, 550), 0.5);
  assert.equal(instanceT(font, 700), 1);
  assert.equal(instanceT(font, 100), 0);
  assert.equal(instanceT(font, 900), 1);
  const inst = { name: "Medium", masterId: "masterBold", active: true, axisValues: { wght: 550 } };
  assert.equal(instanceAxisWeight(font, inst), 550);
  assert.equal(instanceAxisWeight(font, { name: "Bold", masterId: "masterBold", active: true }), 700);
});

test("designspace bundle carries the edited axis and master weights to the compile service", async () => {
  const font = twoMasterFont();
  font.axes = [{ tag: "wght", name: "Weight", min: 300, defaultValue: 400, max: 900 }];
  const bundle = fontToDesignspaceBundle(font);
  const map = await unzipToMap(bundle.buffer as ArrayBuffer);
  const manifest = JSON.parse(new TextDecoder().decode(map.get("designspace.json"))) as {
    axes: Array<{ min: number; max: number }>; masters: Array<{ weightValue: number }>;
  };
  assert.equal(manifest.axes[0].min, 300);
  assert.equal(manifest.axes[0].max, 900);
  assert.deepEqual(manifest.masters.map((m) => m.weightValue).sort((a, b) => a - b), [400, 700]);
});

test("intermediate layers and instance style links round-trip .glyphs JSON", () => {
  const font = twoMasterFont();
  const a = findGlyph(font, "A") as Glyph;
  a.intermediates = [{ axisValue: 550, paths: cloneContours(a.layers.masterRegular.paths) }];
  font.instances[0].styleLink = "Regular";
  font.instances[0].axisValues = { wght: 550 };
  const back = glyphsJsonToFont(fontToGlyphsJson(font), "rt.glyphs");
  const backA = findGlyph(back, "A") as Glyph;
  assert.equal(backA.intermediates?.length, 1);
  assert.equal(backA.intermediates?.[0].axisValue, 550);
  assert.equal(backA.intermediates?.[0].paths.length, a.layers.masterRegular.paths.length);
  assert.equal(back.instances[0].styleLink, "Regular");
  assert.equal(back.instances[0].axisValues?.wght, 550);
});
