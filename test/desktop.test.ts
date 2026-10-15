import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  base64ToBytes, bytesToBase64, fileKindForName, filtersForFileName, isDesktop,
} from "../src/desktop.ts";

test("desktop bridge is absent in a plain Node/browser context", () => {
  assert.equal(isDesktop(), false);
});

test("base64 bridge round-trips every byte value", () => {
  const all = new Uint8Array(256);
  for (let i = 0; i < 256; i++) all[i] = i;
  assert.deepEqual([...base64ToBytes(bytesToBase64(all))], [...all]);
  assert.equal(bytesToBase64(new Uint8Array(0)), "");
  assert.deepEqual([...base64ToBytes("")], []);
});

test("open kind treats only .zip as binary", () => {
  assert.equal(fileKindForName("Font.ufo.zip"), "binary");
  assert.equal(fileKindForName("FONT.ZIP"), "binary");
  assert.equal(fileKindForName("Family.glyphs"), "text");
  assert.equal(fileKindForName("subset.json"), "text");
});

test("save filters follow the file extension", () => {
  assert.deepEqual(filtersForFileName("Family.glyphs"), [{ name: "Glyphs font", extensions: ["glyphs"] }]);
  assert.deepEqual(filtersForFileName("Family-Variable.ttf"), [{ name: "TrueType font", extensions: ["ttf"] }]);
  assert.deepEqual(filtersForFileName("Family.woff2"), [{ name: "WOFF2 font", extensions: ["woff2"] }]);
  assert.deepEqual(filtersForFileName("notes.txt"), [{ name: "All files", extensions: ["*"] }]);
});

test("packaging ships an Electron shell with NSIS and portable Windows builds", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    main?: string;
    scripts: Record<string, string>;
    build: {
      appId: string;
      files: string[];
      win: { target: Array<{ target: string }> };
    };
  };
  assert.equal(pkg.main, "electron/main.cjs");
  assert.match(pkg.scripts["dist:win"], /electron-builder --win nsis portable/);
  assert.equal(pkg.build.appId, "com.shaikmoosa.glyphsforwindows");
  assert.deepEqual(pkg.build.win.target.map((t) => t.target), ["nsis", "portable"]);
  assert.ok(pkg.build.files.includes("dist/**"));
  assert.ok(pkg.build.files.includes("electron/**"));
});

test("Electron shell uses native dialogs behind a secure preload bridge", () => {
  const main = readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  const preload = readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");
  assert.match(main, /showOpenDialog/);
  assert.match(main, /showSaveDialog/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /loadFile/);
  assert.match(preload, /exposeInMainWorld\("glyphsDesktop"/);
  assert.match(preload, /glyphs:open-file/);
  assert.match(preload, /glyphs:save-file/);
});
