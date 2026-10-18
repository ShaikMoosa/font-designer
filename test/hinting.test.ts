// Phase 12A — autohinting toggle round-trips, manifest flag, gasp table.
import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultFont, autohintEnabled } from "../src/model.ts";
import { fontToGlyphsJson, glyphsJsonToFont, fontToOpenStep } from "../src/glyphs-io.ts";
import { fontToDesignspaceBundle, fontToUfoZip, unzipToMap, ufoMapToFont } from "../src/ufo.ts";
import { fontToTtfBytes, listSfntTables } from "../src/ttf.ts";

test("autohint defaults off and round-trips .glyphs JSON and OpenStep", () => {
  const font = createDefaultFont();
  assert.equal(autohintEnabled(font), false);
  font.autohintTT = true;
  assert.equal(autohintEnabled(font), true);
  const viaJson = glyphsJsonToFont(fontToGlyphsJson(font), "hint.glyphs");
  assert.equal(viaJson.autohintTT, true);
  const viaOpenStep = glyphsJsonToFont(fontToOpenStep(font), "hint.glyphs");
  assert.equal(viaOpenStep.autohintTT, true);
  font.autohintTT = false;
  const off = glyphsJsonToFont(fontToGlyphsJson(font), "hint.glyphs");
  assert.equal(off.autohintTT, false);
});

test("designspace bundle and UFO manifest carry the autohint flag", async () => {
  const font = createDefaultFont();
  font.masters.push({ id: "masterBold", name: "Bold", weightValue: 700 });
  for (const glyph of font.glyphs) glyph.layers.masterBold = glyph.layers.masterRegular;
  font.autohintTT = true;
  const bundle = await unzipToMap(fontToDesignspaceBundle(font).buffer as ArrayBuffer);
  const manifest = JSON.parse(new TextDecoder().decode(bundle.get("designspace.json"))) as { autohintTT?: boolean };
  assert.equal(manifest.autohintTT, true);
  const ufo = await unzipToMap(fontToUfoZip(font).buffer as ArrayBuffer);
  const ufoManifest = JSON.parse(new TextDecoder().decode(ufo.get("designspace.json"))) as { autohintTT?: boolean };
  assert.equal(ufoManifest.autohintTT, true);
  const imported = ufoMapToFont(ufo, "back.ufo.zip");
  assert.equal(imported.autohintTT, true);
});

test("browser TTF ships a gasp table for unhinted outlines", () => {
  const font = createDefaultFont();
  const tables = listSfntTables(fontToTtfBytes(font));
  assert.ok(tables.includes("gasp"), `gasp missing from ${tables.join(",")}`);
  assert.ok(tables.includes("glyf"));
});
