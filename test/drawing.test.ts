import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultFont, findGlyph, glyphBounds, lineNode, offNode, curveNode, rectContour, snapshotLayer, restoreBackup, deleteBackup } from "../src/model.ts";
import type { Contour } from "../src/model.ts";
import {
  addExtremes, cutContourAt, findDuplicateNodes, fitCurveContours,
  offsetContours, removeDuplicateNodes, resegmentContours, roundCorners,
} from "../src/pathsurgery.ts";
import { fontToGlyphsJson, glyphsJsonToFont, fontToOpenStep } from "../src/glyphs-io.ts";

test("add extremes inserts an on-curve point at the curve peak", () => {
  // Cubic arch from (0,0) to (100,0) peaking near y=150 at t=0.5.
  const arch: Contour = {
    closed: false,
    nodes: [lineNode(0, 0), offNode(0, 200), offNode(100, 200), curveNode(100, 0)],
  };
  const result = addExtremes([arch]);
  assert.equal(result.changed, 1, "one vertical extreme");
  const out = result.contours[0];
  const onCurve = out.nodes.filter((n) => n.type !== "offcurve");
  assert.equal(onCurve.length, 3, "a midpoint on-curve node was inserted");
  const peak = onCurve[1];
  assert.equal(peak.x, 50);
  assert.equal(peak.y, 150);
  // Input is not mutated.
  assert.equal(arch.nodes.length, 4);
});

test("add extremes leaves line contours alone", () => {
  const result = addExtremes([rectContour(0, 0, 100, 100)]);
  assert.equal(result.changed, 0);
});

test("round corners replaces corners with arcs and keeps bounds", () => {
  const square = rectContour(0, 0, 100, 100);
  const result = roundCorners([square], 20);
  assert.equal(result.changed, 4, "all four corners rounded");
  const out = result.contours[0];
  assert.ok(out.nodes.length > square.nodes.length);
  assert.ok(out.nodes.some((n) => n.type === "offcurve"), "arcs use handles");
  assert.ok(!out.nodes.some((n) => (n.x === 0 || n.x === 100) && (n.y === 0 || n.y === 100) && n.type !== "offcurve" && ((n.x === 0 && n.y === 0) || (n.x === 100 && n.y === 100))), "sharp corner points are gone");
  const b = glyphBounds({ layers: { m: { paths: out ? [out] : [] } } } as never, "m");
  assert.ok(b);
  assert.ok(b.minX >= 0 && b.maxX <= 100 && b.minY >= 0 && b.maxY <= 100);
});

test("offset expands and shrinks closed contours", () => {
  const square = rectContour(0, 0, 100, 100);
  const grown = offsetContours([square], 10);
  assert.equal(grown.changed, 1);
  const gb = glyphBounds({ layers: { m: { paths: grown.contours } } } as never, "m");
  assert.ok(gb);
  assert.equal(gb.minX, -10);
  assert.equal(gb.maxX, 110);
  assert.equal(gb.maxY, 110);
  const shrunk = offsetContours([square], -10);
  const sb = glyphBounds({ layers: { m: { paths: shrunk.contours } } } as never, "m");
  assert.ok(sb);
  assert.equal(sb.minX, 10);
  assert.equal(sb.maxX, 90);
  // Open contours and collapsing offsets pass through untouched.
  const open: Contour = { closed: false, nodes: [lineNode(0, 0), lineNode(50, 50)] };
  assert.equal(offsetContours([open], 10).changed, 0);
  assert.equal(offsetContours([square], -60).changed, 0, "collapse returns the original");
});

test("duplicate nodes are found and removed, including the closing seam", () => {
  const dup: Contour = {
    closed: true,
    nodes: [lineNode(0, 0), lineNode(0, 0), lineNode(100, 0), lineNode(100, 100), lineNode(0, 0)],
  };
  const found = findDuplicateNodes([dup]);
  assert.equal(found.length, 2);
  const result = removeDuplicateNodes([dup]);
  assert.equal(result.changed, 2);
  assert.deepEqual(result.contours[0].nodes.map((n) => [n.x, n.y]), [[0, 0], [100, 0], [100, 100]]);
  assert.equal(findDuplicateNodes(result.contours).length, 0);
});

test("re-segment splits every segment at its midpoint without moving ends", () => {
  const square = rectContour(0, 0, 100, 100);
  const result = resegmentContours([square]);
  assert.equal(result.changed, 4);
  assert.equal(result.contours[0].nodes.length, 8);
  assert.ok(result.contours[0].nodes.some((n) => n.x === 50 && n.y === 0), "midpoint inserted on the bottom edge");
  const b = glyphBounds({ layers: { m: { paths: result.contours } } } as never, "m");
  assert.ok(b && b.maxX === 100 && b.maxY === 100, "shape bounds are preserved");
});

test("fit curve turns a polyline into smooth cubics through the same points", () => {
  const tri: Contour = { closed: true, nodes: [lineNode(0, 0), lineNode(100, 0), lineNode(50, 100)] };
  const result = fitCurveContours([tri]);
  assert.equal(result.changed, 1);
  const out = result.contours[0];
  assert.ok(out.nodes.some((n) => n.type === "offcurve"), "handles were created");
  const onCurve = out.nodes.filter((n) => n.type !== "offcurve");
  assert.deepEqual(onCurve.map((n) => [n.x, n.y]), [[0, 0], [100, 0], [50, 100]], "anchor points are preserved");
  assert.ok(onCurve.every((n) => n.type === "smooth"));
});

test("cut opens a closed contour at the node and splits an open one", () => {
  const square = rectContour(0, 0, 100, 100);
  const opened = cutContourAt(square, 1);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].closed, false);
  assert.deepEqual([opened[0].nodes[0].x, opened[0].nodes[0].y], [100, 0], "cut node becomes the start");
  assert.equal(opened[0].nodes.length, 4);
  const open: Contour = { closed: false, nodes: [lineNode(0, 0), lineNode(50, 0), lineNode(100, 0)] };
  const split = cutContourAt(open, 1);
  assert.equal(split.length, 2);
  assert.deepEqual(split[0].nodes.map((n) => n.x), [0, 50]);
  assert.deepEqual(split[1].nodes.map((n) => n.x), [50, 100]);
  assert.equal(cutContourAt(open, 0).length, 1, "endpoints do not cut");
  const withHandle: Contour = { closed: false, nodes: [lineNode(0, 0), offNode(10, 10), curveNode(100, 0)] };
  assert.equal(cutContourAt(withHandle, 1).length, 1, "handles do not cut");
});

test("backup layers snapshot, restore, delete, and round-trip .glyphs", () => {
  const font = createDefaultFont();
  const a = findGlyph(font, "A");
  assert.ok(a);
  const before = JSON.stringify(a.layers.masterRegular.paths);
  const backup = snapshotLayer(a, "masterRegular", new Date("2026-01-02T03:04:05Z"));
  assert.ok(backup);
  assert.equal(a.backups?.length, 1);
  // Mutate, then restore.
  a.layers.masterRegular.paths = [rectContour(0, 0, 10, 10)];
  assert.equal(restoreBackup(a, backup.id)?.id, backup.id);
  assert.equal(JSON.stringify(a.layers.masterRegular.paths), before, "restore brings the snapshot back");
  // Snapshot is isolated from later edits.
  a.layers.masterRegular.paths[0].nodes[0].x = 999;
  assert.notEqual(a.backups?.[0].paths[0].nodes[0].x, 999);
  // Round-trips through .glyphs JSON and OpenStep saves.
  for (const text of [fontToGlyphsJson(font), fontToOpenStep(font)]) {
    const back = glyphsJsonToFont(text, "roundtrip.glyphs");
    const backA = findGlyph(back, "A");
    assert.equal(backA?.backups?.length, 1);
    assert.equal(backA?.backups?.[0].masterId, "masterRegular");
    assert.equal(backA?.backups?.[0].paths.length, a.layers.masterRegular.paths.length);
  }
  assert.equal(deleteBackup(a, backup.id), true);
  assert.equal(a.backups?.length, 0);
  assert.equal(restoreBackup(a, backup.id), null);
});
