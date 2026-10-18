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

test("packaging bundles the fontc sidecar and app icon into Windows builds", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
    build: {
      win: { icon?: string };
      extraResources: Array<{ from: string; to: string; filter: string[] }>;
    };
  };
  assert.match(pkg.scripts["build:fontc"], /PyInstaller/);
  assert.match(pkg.scripts["build:fontc"], /server\.py/);
  assert.match(pkg.scripts["dist:win"], /build:fontc/);
  assert.match(pkg.scripts["dist:win"], /build:icon/);
  assert.equal(pkg.build.win.icon, "build/icon.ico");
  assert.deepEqual(pkg.build.extraResources, [
    { from: "resources/fontc/fontc", to: "fontc", filter: ["**/*"] },
  ]);
  const iconGen = readFileSync(new URL("../tools/generate_icon.py", import.meta.url), "utf8");
  assert.match(iconGen, /icon\.ico/);
  assert.match(iconGen, /0xE8, 0xA3, 0x3D/);
});

test("Electron shell auto-starts and stops the bundled compile service", () => {
  const main = readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  assert.match(main, /function startFontc/);
  assert.match(main, /resourcesPath, "fontc", "fontc\.exe"/);
  assert.match(main, /GLYPHS_FONTC/);
  assert.match(main, /startFontc\(\);/);
  assert.match(main, /before-quit", stopFontc/);
  const renderer = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(renderer, /attempts = isDesktop\(\) \? 8 : 1/);
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

test("workspace shell keeps panes adjustable and canvas navigation close to the work", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  for (const id of ["leftResize", "rightResize", "previewResize"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]+role="separator"`));
  }
  for (const id of ["previousGlyphBtn", "nextGlyphBtn", "zoomOutBtn", "zoomInBtn", "zoomFitBtn"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(renderer, /glyphs-windows\.workspace\.v1/);
  assert.match(renderer, /setupPaneResizer\("#leftResize", "leftPanel"\)/);
  assert.match(renderer, /localStorage\.setItem\(WORKSPACE_PREFS_KEY/);
  assert.match(css, /--left-panel:\s*clamp/);
  assert.match(css, /#canvasHud/);
});

test("adaptive toolbar preserves expert commands at narrow effective widths", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  for (const id of ["toolbarMore", "morePathGroup", "moreAlignGroup", "moreSplitBtn", "moreAddMasterBtn"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /data-cmd="reset-layout"/);
  assert.match(renderer, /function resetWorkspaceLayout\(\)/);
  assert.match(renderer, /mod && ev\.altKey && ev\.key === "0"/);
  assert.match(css, /@media \(max-width: 1100px\)/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /\.primary-path-popover, \.primary-align-popover \{ display: none; \}/);
});

test("R2 Font View ships dense Grid/List workflows and persistent expert state", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const renderer = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  for (const id of ["fvSavedFilter", "saveFilterBtn", "fvBatchBar", "deleteSelectedBtn", "clearSelectionBtn"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /aria-multiselectable="true"/);
  assert.match(renderer, /glyphs-windows\.font-view\.v2/);
  assert.match(renderer, /updateGlyphSelection/);
  assert.match(renderer, /setupListColumnResizers/);
  assert.match(renderer, /IntersectionObserver/);
  assert.match(renderer, /event\.key\.toLowerCase\(\) === "a"/);
  assert.match(css, /\.glyph-row-head \{ position: sticky/);
  assert.match(css, /\.fv-col-resizer/);
});
