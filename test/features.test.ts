import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultFont, findGlyph, rectContour } from "../src/model.ts";
import type { Glyph } from "../src/model.ts";
import { effectiveFeatures, generateFeatures, shapeText } from "../src/shaping.ts";
import { proofExportBytes, proofGate } from "../src/proofing.ts";
import { fontToUfoZip, unzipToMap, ufoMapToFont } from "../src/ufo.ts";

function bareGlyph(name: string, unicode: number | null): Glyph {
  return {
    name, unicode, width: 300, lsb: 20, rsb: 20, category: "Letter",
    kerningGroupLeft: "", kerningGroupRight: "", anchors: [], components: [],
    metricsKeyLeft: "", metricsKeyRight: "", layers: { masterRegular: { paths: [] } },
  };
}

test("automatic kern code covers exact pairs and skips missing glyphs", () => {
  const font = createDefaultFont();
  const auto = generateFeatures(font);
  // Default kerning: A|V, V|A, A|period exist; T|o names a missing glyph.
  assert.equal(auto.kernPairs, 3);
  assert.match(auto.code, /feature kern \{/);
  assert.match(auto.code, /pos A V -70;/);
  assert.ok(!auto.code.includes("pos T o"), "pairs naming missing glyphs are skipped");
  assert.equal(auto.parsed.poss.get("A|V"), -70);
});

test("kerning groups generate classes and exact pairs override them", () => {
  const font = createDefaultFont();
  const a = findGlyph(font, "A");
  const v = findGlyph(font, "V");
  assert.ok(a && v);
  a.kerningGroupRight = "A";
  v.kerningGroupLeft = "V";
  font.kerningGroups["A|V"] = -45;
  delete font.kerning["A|V"];
  let auto = generateFeatures(font);
  assert.equal(auto.groupPairs, 1);
  assert.match(auto.code, /@KernR_A = \[A\];/);
  assert.match(auto.code, /pos @KernR_A @KernL_V -45;/);
  assert.equal(auto.parsed.poss.get("A|V"), -45);
  font.kerning["A|V"] = -99;
  auto = generateFeatures(font);
  assert.equal(auto.parsed.poss.get("A|V"), -99, "exact pair beats the group value");
  // In the FEA text the exact exception is written before the class rule.
  assert.ok(auto.code.indexOf("pos A V -99;") < auto.code.indexOf("pos @KernR_A"));
});

test("ligatures generate from glyph names, including underscore forms", () => {
  const font = createDefaultFont();
  font.glyphs.push(bareGlyph("f", 0x66), bareGlyph("i", 0x69), bareGlyph("fi", 0xfb01));
  font.glyphs.push(bareGlyph("f_f_i", null));
  const auto = generateFeatures(font);
  assert.equal(auto.ligatures, 2);
  assert.match(auto.code, /sub f i by fi;/);
  assert.match(auto.code, /sub f f i by f_f_i;/);
  const shaped = shapeText(font, "fi ffi");
  assert.equal(shaped[0].name, "fi");
});

test("marks generate mark and mark-to-mark code from anchors", () => {
  const font = createDefaultFont();
  const e = findGlyph(font, "e");
  assert.ok(e);
  e.anchors = [{ name: "top", x: 290, y: 480 }];
  const acute = bareGlyph("acutecomb", 0x0301);
  acute.category = "Mark";
  acute.anchors = [{ name: "_top", x: 30, y: 0 }, { name: "top", x: 30, y: 120 }];
  const grave = bareGlyph("gravecomb", 0x0300);
  grave.category = "Mark";
  grave.anchors = [{ name: "_top", x: 10, y: 0 }];
  font.glyphs.push(acute, grave);
  const auto = generateFeatures(font);
  assert.ok(auto.markAttachments >= 1);
  assert.equal(auto.markToMark, 1);
  assert.match(auto.code, /markClass acutecomb <anchor 30 0> @MC_top;/);
  assert.match(auto.code, /pos base e <anchor 290 480> mark @MC_top;/);
  assert.match(auto.code, /feature mkmk \{/);
  assert.match(auto.code, /pos mark acutecomb <anchor 30 120> mark @MC_top;/);
});

test("preview attaches a second mark to the first mark, not the base", () => {
  const font = createDefaultFont();
  const e = findGlyph(font, "e");
  assert.ok(e);
  e.anchors = [{ name: "top", x: 290, y: 480 }];
  const acute = bareGlyph("acutecomb", 0x0301);
  acute.category = "Mark";
  acute.anchors = [{ name: "_top", x: 30, y: 0 }, { name: "top", x: 30, y: 120 }];
  acute.layers.masterRegular.paths = [rectContour(0, 0, 60, 120)];
  const grave = bareGlyph("gravecomb", 0x0300);
  grave.category = "Mark";
  grave.anchors = [{ name: "_top", x: 10, y: 0 }];
  grave.layers.masterRegular.paths = [rectContour(0, 0, 60, 120)];
  font.glyphs.push(acute, grave);
  const shaped = shapeText(font, "é̀");
  assert.equal(shaped.length, 3);
  assert.equal(shaped[1].dx, 260);
  assert.equal(shaped[1].dy, 480);
  assert.equal(shaped[2].dx, 280, "second mark hangs on the first mark's top anchor");
  assert.equal(shaped[2].dy, 600);
});

test("manual feature code overrides generated pairs and substitutions", () => {
  const font = createDefaultFont();
  font.featureCode = "pos A V -111;\n";
  const eff = effectiveFeatures(font);
  assert.equal(eff.poss.get("A|V"), -111);
  const shaped = shapeText(font, "AV");
  assert.equal(shaped[0].advance, 680 - 111);
});

test("UFO export carries features.fea and import reads it back", async () => {
  const font = createDefaultFont();
  const zip = fontToUfoZip(font);
  const map = await unzipToMap(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer);
  const feaBytes = map.get("features.fea");
  assert.ok(feaBytes, "features.fea present in UFO zip");
  const fea = new TextDecoder().decode(feaBytes);
  assert.match(fea, /feature kern \{/);
  assert.match(fea, /pos A V -70;/);
  const back = ufoMapToFont(map, "roundtrip.ufo.zip");
  assert.match(back.featureCode, /feature kern/);
  // GLIF parsing needs DOMParser (browser/Electron), so in Node the
  // glyph list is empty; kerning and feature code still round-trip.
  assert.equal(back.kerning["A|V"], -70);
});

test("export proof gate blocks failures and desktop outages only", async () => {
  const bytes = new Uint8Array([0, 1, 0, 0]) as Uint8Array<ArrayBuffer>;
  const okFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, glyphCount: 12, cmapMappings: 11, tables: ["cmap", "head"] }),
    text: async () => "",
  });
  const proof = await proofExportBytes(bytes, "http://127.0.0.1:8765", okFetch);
  assert.equal(proof.available, true);
  assert.equal(proof.ok, true);
  assert.equal(proofGate(proof, true).deliver, true);
  assert.match(proofGate(proof, true).note, /12 glyphs/);

  const badFetch = async () => ({
    ok: false, status: 400,
    json: async () => ({ error: "font cmap has no mappings" }),
    text: async () => "",
  });
  const failed = await proofExportBytes(bytes, "http://127.0.0.1:8765", badFetch);
  assert.equal(failed.available, true);
  assert.equal(proofGate(failed, false).deliver, false, "readback failure blocks even in the browser");

  const downFetch = async () => { throw new Error("ECONNREFUSED"); };
  const down = await proofExportBytes(bytes, "http://127.0.0.1:8765", downFetch);
  assert.equal(down.available, false);
  assert.equal(proofGate(down, true).deliver, false, "desktop blocks when the bundled service is down");
  assert.equal(proofGate(down, false).deliver, true, "browser delivers with an explicit no-proof warning");
  assert.match(proofGate(down, false).note, /without fontTools proof/);
});
