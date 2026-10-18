// Phase 11 — Interpolation pro: master-compatibility report and fixes,
// piecewise interpolation through intermediate layers, instance axis
// mapping and style linking, and .glyphs round-trips for the new data.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultFont, findGlyph, cloneContours, interpolateGlyphAt,
  compatibilityReport, copyLayerBetweenMasters, instanceT, instanceAxisWeight,
  sortedMasters, weightForT, axisStopsForGlyph, issuesForGlyph, adjacentMaster, instanceProgression, layerSummaries,
  interpolateGlyphAtLocation, masterLocation, instanceLocation, axisStopsForAxis, instanceProgressionForAxis,
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

test("R5 axis helpers order masters, map weights, and list stops", () => {
  const font = twoMasterFont();
  assert.deepEqual(sortedMasters(font).map((m) => m.name), ["Regular", "Bold"]);
  assert.equal(weightForT(font, 0), 400);
  assert.equal(weightForT(font, 0.5), 550);
  assert.equal(weightForT(font, 1), 700);
  assert.equal(weightForT(font, -1), 400);
  assert.equal(weightForT(font, 2), 700);
  const a = findGlyph(font, "A") as Glyph;
  a.intermediates = [{ axisValue: 550, paths: cloneContours(a.layers.masterRegular.paths) }];
  assert.deepEqual(axisStopsForGlyph(font, a).map((s) => `${s.kind}:${s.weight}`), ["master:400", "intermediate:550", "master:700"]);
  assert.deepEqual(instanceProgression(font, 5).map((s) => s.weight), [400, 475, 550, 625, 700]);
  assert.equal(adjacentMaster(font, "masterRegular", 1)?.id, "masterBold");
  assert.equal(adjacentMaster(font, "masterBold", 1), null);
  assert.equal(adjacentMaster(font, "masterBold", -1)?.id, "masterRegular");
});

test("R5 layer summaries and per-glyph issues drive the visual browser", () => {
  const font = twoMasterFont();
  const v = findGlyph(font, "V") as Glyph;
  delete v.layers.masterBold;
  const summaries = layerSummaries(font, v);
  assert.equal(summaries.length, 2);
  assert.equal(summaries[1].hasLayer, false);
  assert.equal(summaries[1].contours, 0);
  assert.ok(issuesForGlyph(font, "V").some((i) => i.problem === "missing-layer"));
  assert.equal(issuesForGlyph(font, "A").length, 0);
  copyLayerBetweenMasters(font, "V", "masterRegular", "masterBold");
  assert.equal(issuesForGlyph(font, "V").length, 0);
});

// Phase 12B: weight x width. Regular (400,100) node (0,0); Bold adds
// (+200, 0); Wide adds (0, +100); Bold Wide adds both. Bilinear proof
// must be exact at corners and additive at the centre.
function fourMasterFont(): Font {
  const font = twoMasterFont();
  font.axes = [
    { tag: "wght", name: "Weight", min: 400, defaultValue: 400, max: 700 },
    { tag: "wdth", name: "Width", min: 75, defaultValue: 100, max: 125 },
  ];
  const regular = font.masters.find((m) => m.id === "masterRegular") as Font["masters"][number];
  const bold = font.masters.find((m) => m.id === "masterBold") as Font["masters"][number];
  regular.axisValues = { wght: 400, wdth: 100 };
  bold.axisValues = { wght: 700, wdth: 100 };
  for (const glyph of font.glyphs) {
    const base = glyph.layers.masterRegular.paths;
    const wide = cloneContours(base);
    for (const contour of wide) for (const node of contour.nodes) node.y += 100;
    glyph.layers.masterWide = { paths: wide };
    const boldWide = cloneContours(glyph.layers.masterBold.paths);
    for (const contour of boldWide) for (const node of contour.nodes) node.y += 100;
    glyph.layers.masterBoldWide = { paths: boldWide };
  }
  font.masters.push(
    { id: "masterWide", name: "Wide", weightValue: 400, axisValues: { wght: 400, wdth: 125 } },
    { id: "masterBoldWide", name: "Bold Wide", weightValue: 700, axisValues: { wght: 700, wdth: 125 } },
  );
  font.instances.push({
    name: "Mid Wide", masterId: "masterRegular", active: true, axisValues: { wght: 550, wdth: 112 },
  });
  return font;
}

test("12B multi-axis locations resolve masters and instances", () => {
  const font = fourMasterFont();
  assert.deepEqual(masterLocation(font, font.masters[0]), { wght: 400, wdth: 100 });
  const wide = font.masters.find((m) => m.id === "masterWide") as Font["masters"][number];
  assert.deepEqual(masterLocation(font, wide), { wght: 400, wdth: 125 });
  const inst = font.instances[font.instances.length - 1];
  assert.deepEqual(instanceLocation(font, inst), { wght: 550, wdth: 112 });
  assert.deepEqual(sortedMasters(font).map((m) => m.id), ["masterRegular", "masterWide", "masterBold", "masterBoldWide"]);
});

test("12B bilinear interpolation is exact at corners and additive inside", () => {
  const font = fourMasterFont();
  const glyph = findGlyph(font, "A") as Glyph;
  const originX = glyph.layers.masterRegular.paths[0].nodes[0].x;
  const originY = glyph.layers.masterRegular.paths[0].nodes[0].y;
  const at = (loc: Record<string, number>) => {
    const ig = interpolateGlyphAtLocation(font, "A", loc);
    assert.ok(ig, `expected interpolation at ${JSON.stringify(loc)}`);
    const node = ig.layers[font.currentMasterId].paths[0].nodes[0];
    return [node.x - originX, node.y - originY];
  };
  assert.deepEqual(at({ wght: 400, wdth: 100 }), [0, 0]);
  assert.deepEqual(at({ wght: 700, wdth: 100 }), [200, 0]);
  assert.deepEqual(at({ wght: 400, wdth: 125 }), [0, 100]);
  assert.deepEqual(at({ wght: 700, wdth: 125 }), [200, 100]);
  assert.deepEqual(at({ wght: 550, wdth: 112.5 }), [100, 50]);
  // Moving only width leaves the weight offset untouched.
  assert.deepEqual(at({ wght: 700, wdth: 112.5 }), [200, 50]);
  // Single-axis API still slices the first axis at default width.
  const slice = interpolateGlyphAt(font, "A", 0.5);
  assert.ok(slice);
  assert.deepEqual([slice.layers[font.currentMasterId].paths[0].nodes[0].x - originX, slice.layers[font.currentMasterId].paths[0].nodes[0].y - originY], [100, 0]);
});

test("12B stops and progression follow the picked axis", () => {
  const font = fourMasterFont();
  const glyph = findGlyph(font, "A") as Glyph;
  assert.deepEqual(axisStopsForAxis(font, glyph, "wdth").map((s) => s.weight), [100, 100, 125, 125]);
  const steps = instanceProgressionForAxis(font, "wdth", { wght: 700, wdth: 100 }, 3);
  assert.deepEqual(steps.map((s) => s.location.wdth), [100, 113, 125]);
  assert.ok(steps.every((s) => s.location.wght === 700));
});

test("12B two-axis data round-trips through .glyphs and designspace", async () => {
  const font = fourMasterFont();
  const restored = glyphsJsonToFont(fontToGlyphsJson(font), font.fileName);
  const wide = restored.masters.find((m) => m.id === "masterWide");
  assert.ok(wide);
  assert.deepEqual(masterLocation(restored, wide), { wght: 400, wdth: 125 });
  assert.deepEqual(restored.axes.map((a) => a.tag), ["wght", "wdth"]);
  const bundle = fontToDesignspaceBundle(restored);
  const map = await unzipToMap(bundle.buffer.slice(bundle.byteOffset, bundle.byteOffset + bundle.byteLength) as ArrayBuffer);
  const designspace = JSON.parse(new TextDecoder().decode(map.get("designspace.json"))) as {
    axes: Array<{ tag: string }>; masters: Array<{ id: string; axisValues?: Record<string, number> }>;
  };
  assert.deepEqual(designspace.axes.map((a) => a.tag), ["wght", "wdth"]);
  assert.equal(designspace.masters.length, 4);
  assert.deepEqual(designspace.masters.find((m) => m.id === "masterBoldWide")?.axisValues, { wght: 700, wdth: 125 });
});
