// Phase 12 slice 1 — app settings normalization and sample strings.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS, SAMPLE_STRINGS, addCustomSample, allSamples,
  normalizeSettings, parseSettings, removeCustomSample, serializeSettings,
} from "../src/settings.ts";

test("settings fall back to defaults for missing or corrupt data", () => {
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings("{not json"), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings("nope"), DEFAULT_SETTINGS);
});

test("settings clamp the preview size and reject non-http service URLs", () => {
  const cleaned = normalizeSettings({ defaultPreviewSize: 999, compileServiceUrl: "ftp://x" });
  assert.equal(cleaned.defaultPreviewSize, 140);
  assert.equal(cleaned.compileServiceUrl, DEFAULT_SETTINGS.compileServiceUrl);
  assert.equal(normalizeSettings({ defaultPreviewSize: 4 }).defaultPreviewSize, 24);
  assert.equal(
    normalizeSettings({ compileServiceUrl: " http://localhost:9000/ " }).compileServiceUrl,
    "http://localhost:9000",
  );
  assert.equal(normalizeSettings({ showGuides: false }).showGuides, false);
  assert.equal(normalizeSettings({}).showNodes, true);
});

test("custom samples dedupe, cap, and round-trip through serialization", () => {
  let settings = addCustomSample(DEFAULT_SETTINGS, "  Proof me  ");
  settings = addCustomSample(settings, "Proof me");
  settings = addCustomSample(settings, "");
  assert.deepEqual(settings.customSamples, ["Proof me"]);
  for (let i = 0; i < 30; i++) settings = addCustomSample(settings, `Sample ${i}`);
  assert.equal(settings.customSamples.length, 20);
  const back = parseSettings(serializeSettings(settings));
  assert.deepEqual(back.customSamples, settings.customSamples);
  assert.deepEqual(removeCustomSample(back, "Proof me").customSamples.includes("Proof me"), false);
});

test("sample list covers Latin, figures, kerning, Greek, Cyrillic plus customs", () => {
  const ids = SAMPLE_STRINGS.map((sample) => sample.id);
  for (const id of ["latin-pangram", "figures", "kerning", "greek", "cyrillic"]) {
    assert.ok(ids.includes(id), `missing sample ${id}`);
  }
  assert.ok(SAMPLE_STRINGS.every((sample) => sample.text.length > 0));
  const withCustom = allSamples(addCustomSample(DEFAULT_SETTINGS, "My proof"));
  assert.equal(withCustom.length, SAMPLE_STRINGS.length + 1);
  assert.equal(withCustom[withCustom.length - 1].custom, true);
});
