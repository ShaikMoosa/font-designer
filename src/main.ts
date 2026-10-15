// App wiring: Font View, Edit View tabs, Inspector/Palette/Kerning/Font Info,
// text preview, file commands, undo/redo, and Windows keyboard shortcuts.
import {
  createDefaultFont, findGlyph, glyphToPathD, glyphToPathDResolved, glyphBounds, syncBearings,
  cloneFont, kernKey, rectContour, ellipseContour,
  compositeRecipe, interpolateGlyphAt, mastersCompatible, contoursToPathD,
} from "./model.ts";
import type { AlignMode, Font, Glyph, GlyphLayer } from "./model.ts";
import { fontToGlyphsJson, glyphsJsonToFont, fontToOpenStep, downloadText, downloadBytes } from "./glyphs-io.ts";
import { fontToUfoZip, fontToDesignspaceBundle, unzipToMap, ufoMapToFont } from "./ufo.ts";
import { fontToOtfArrayBuffer } from "./otf.ts";
import { fontToTtfBytes } from "./ttf.ts";
import { fontToWoffBytes } from "./woff.ts";
import { validateFont } from "./validate.ts";
import { parseFeatureCode, shapeText } from "./shaping.ts";
import { fixContourDirections, unionContours, differenceContours } from "./pathsurgery.ts";
import { base64ToBytes, desktopOpenFile, desktopSaveBytes, desktopSaveText, fileKindForName, isDesktop, onDesktopMenuCommand } from "./desktop.ts";

const COMPILE_SERVICE = "http://127.0.0.1:8765";
import { createEditor } from "./editor.ts";
import type { Editor, EditorHooks, MeasureInfo, Tool } from "./editor.ts";

function $<T extends Element>(sel: string): T { return document.querySelector(sel) as T; }
function qs<T extends HTMLElement>(root: ParentNode, sel: string): T { return root.querySelector(sel) as T; }

interface AppState {
  font: Font; currentGlyphName: string; openTabs: string[];
  undoStack: Font[]; redoStack: Font[]; fontViewMode: "grid" | "list";
  splitView: boolean; paneBMasterId: string;
}

const state: AppState = {
  font: createDefaultFont(),
  currentGlyphName: "A",
  openTabs: ["A"],
  undoStack: [], redoStack: [],
  fontViewMode: "grid",
  splitView: false, paneBMasterId: "",
};

function currentGlyph(): Glyph { return findGlyph(state.font, state.currentGlyphName) || state.font.glyphs[0]; }
function setStatus(msg: string): void { $("#statusMsg").textContent = msg; }

function showMeasure(info: MeasureInfo | null): void {
  $("#measureReadout").textContent = info
    ? `Measure: ${info.distance} units · dx ${info.dx} · dy ${info.dy} · ${info.angleDeg}°`
    : "";
}

const editorHooks: EditorHooks = {
  onBeginChange() { pushUndo(); },
  onMutate() { renderDynamic(false); },
  onEndChange() {
    const g = currentGlyph();
    if (g) syncBearings(state.font, g);
    renderDynamic(true);
  },
  onCoord(fp) {
    $("#coordReadout").textContent = `${Math.round(fp.x)}, ${Math.round(fp.y)}`;
  },
  onStatus(msg) { setStatus(msg); },
  onTextFocus() { const input = $<HTMLInputElement>("#previewText"); input.focus(); input.select(); },
  onRender() { /* status line updated in renderDynamic */ },
  onMeasure(info) { showMeasure(info); },
};

const editor = createEditor($<SVGSVGElement>("#editorSvg"), {
  ...editorHooks,
  onActivate() { activeEd = editor; },
});
const editorB = createEditor($<SVGSVGElement>("#editorSvgB"), {
  ...editorHooks,
  onActivate() { activeEd = editorB; },
});
let activeEd: Editor = editor;

function refreshPaneB(refit = false): void {
  if (!state.splitView) return;
  if (refit) editorB.setGlyph(state.font, currentGlyph());
  else editorB.refresh(state.font, currentGlyph());
}

function pushUndo() {
  state.undoStack.push(cloneFont(state.font));
  if (state.undoStack.length > 60) state.undoStack.shift();
  state.redoStack = [];
}
function undo(): void {
  if (!state.undoStack.length) { setStatus("Nothing to undo."); return; }
  state.redoStack.push(cloneFont(state.font));
  const prev = state.undoStack.pop();
  if (!prev) return;
  state.font = prev;
  ensureCurrentGlyph();
  editor.setGlyph(state.font, currentGlyph());
  renderAll();
  setStatus("Undone.");
}
function redo(): void {
  if (!state.redoStack.length) { setStatus("Nothing to redo."); return; }
  state.undoStack.push(cloneFont(state.font));
  const next = state.redoStack.pop();
  if (!next) return;
  state.font = next;
  ensureCurrentGlyph();
  editor.setGlyph(state.font, currentGlyph());
  renderAll();
  setStatus("Redone.");
}
function ensureCurrentGlyph() {
  if (!findGlyph(state.font, state.currentGlyphName)) {
    state.currentGlyphName = state.font.glyphs[0]?.name || "";
  }
  state.openTabs = state.openTabs.filter((n) => findGlyph(state.font, n));
  if (state.currentGlyphName && !state.openTabs.includes(state.currentGlyphName)) {
    state.openTabs.push(state.currentGlyphName);
  }
}

function openGlyph(name: string, refit = true): void {
  const g = findGlyph(state.font, name);
  if (!g) return;
  state.currentGlyphName = name;
  if (!state.openTabs.includes(name)) state.openTabs.push(name);
  if (refit) { editor.setGlyph(state.font, g); refreshPaneB(true); } else editor.refresh(state.font, g);
  renderAll();
}

function drawThumb(canvas: HTMLCanvasElement, glyph: Glyph): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width = 104, h = canvas.height = 88;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#e8ecf1";
  const d = glyphToPathDResolved(state.font, glyph, state.font.currentMasterId);
  if (!d) {
    ctx.font = "11px Segoe UI"; ctx.fillStyle = "#9aa6b3";
    ctx.fillText(glyph.name === "space" ? "space" : "empty", 8, h / 2);
    return;
  }
  const upm = state.font.unitsPerEm || 1000;
  const width = Math.max(glyph.width || 600, 1);
  const s = Math.min((w - 14) / width, (h - 14) / (upm * 1.1));
  const ox = (w - width * s) / 2, oy = h - 10;
  const path = new Path2D(d);
  ctx.save();
  ctx.translate(ox, oy); ctx.scale(s, -s);
  ctx.fill(path, "evenodd");
  ctx.restore();
}

function renderFontView() {
  const grid = $("#glyphGrid");
  const q = ($<HTMLInputElement>("#glyphSearch").value || "").trim().toLowerCase();
  grid.className = `glyph-grid${state.fontViewMode === "list" ? " list-mode" : ""}`;
  grid.innerHTML = "";
  const shown = state.font.glyphs.filter((g) => !q || g.name.toLowerCase().includes(q));
  for (const g of shown) {
    const cell = document.createElement("div");
    cell.className = `glyph-cell${g.name === state.currentGlyphName ? " is-sel" : ""}`;
    cell.title = `${g.name} — double-click to edit`;
    const canvas = document.createElement("canvas");
    cell.appendChild(canvas);
    const nm = document.createElement("div"); nm.className = "gname"; nm.textContent = g.name; cell.appendChild(nm);
    const un = document.createElement("div"); un.className = "guni";
    un.textContent = g.unicode != null ? `U+${g.unicode.toString(16).toUpperCase().padStart(4, "0")} · ${g.width}` : `— · ${g.width}`;
    cell.appendChild(un);
    cell.addEventListener("click", () => openGlyph(g.name, false));
    cell.addEventListener("dblclick", () => openGlyph(g.name, true));
    grid.appendChild(cell);
    drawThumb(canvas, g);
  }
  if (!shown.length) grid.innerHTML = '<p class="hint">No glyphs match. Add one with + Glyph.</p>';
  $("#glyphCount").textContent = `${state.font.glyphs.length} glyphs`;
  $("#gridModeBtn").classList.toggle("is-on", state.fontViewMode === "grid");
  $("#listModeBtn").classList.toggle("is-on", state.fontViewMode === "list");
}

function renderTabs() {
  const tabs = $("#tabs");
  tabs.innerHTML = "";
  const fv = document.createElement("button");
  fv.className = "tab"; fv.type = "button"; fv.textContent = "Font View";
  fv.addEventListener("click", () => { $<HTMLInputElement>("#glyphSearch").focus(); });
  tabs.appendChild(fv);
  for (const name of state.openTabs) {
    const b = document.createElement("button");
    b.className = `tab${name === state.currentGlyphName ? " is-on" : ""}`;
    b.type = "button"; b.textContent = name; b.setAttribute("role", "tab");
    b.addEventListener("click", () => openGlyph(name, false));
    tabs.appendChild(b);
  }
}

function renderHeader() {
  $("#docName").textContent = state.font.fileName || "Untitled.glyphs";
  const sel = $<HTMLSelectElement>("#masterSelect");
  sel.innerHTML = "";
  for (const m of state.font.masters) {
    const opt = document.createElement("option");
    opt.value = m.id; opt.textContent = m.name;
    if (m.id === state.font.currentMasterId) opt.selected = true;
    sel.appendChild(opt);
  }
  if (!state.font.masters.some((m) => m.id === state.paneBMasterId)) {
    state.paneBMasterId = (state.font.masters.find((m) => m.id !== state.font.currentMasterId) || state.font.masters[0])?.id || "";
  }
  const selB = $<HTMLSelectElement>("#paneBMaster");
  selB.innerHTML = "";
  for (const m of state.font.masters) {
    const opt = document.createElement("option");
    opt.value = m.id; opt.textContent = m.name;
    if (m.id === state.paneBMasterId) opt.selected = true;
    selB.appendChild(opt);
  }
  $<HTMLButtonElement>("#splitBtn").classList.toggle("is-on", state.splitView);
  $<HTMLElement>("#paneBLabel").hidden = !state.splitView;
  const svgB = $<SVGSVGElement>("#editorSvgB");
  if (state.splitView) svgB.removeAttribute("hidden"); else svgB.setAttribute("hidden", "");
  const g = currentGlyph();
  $("#statusRight").textContent = g
    ? `${state.font.familyName} · ${g.name} · width ${g.width} · LSB ${g.lsb} RSB ${g.rsb} · ${state.font.glyphs.length} glyphs`
    : state.font.familyName;
}

function renderDynamic(refitSide = true) {
  renderHeader();
  renderTabs();
  renderFontView();
  renderPreview();
  refreshPaneB(false);
  if (refitSide) renderSide();
}

function renderAll() {
  renderHeader();
  renderTabs();
  renderFontView();
  renderSide();
  renderPreview();
  refreshPaneB(false);
}

function escHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SVGNS = "http://www.w3.org/2000/svg";
function renderPreview() {
  const svg = $<SVGSVGElement>("#previewSvg");
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const text = $<HTMLInputElement>("#previewText").value || "";
  const size = +$<HTMLInputElement>("#previewSize").value || 72;
  const upm = state.font.unitsPerEm || 1000;
  const s = size / upm;
  // Shaping subset: ligatures, feature pos, pair + group kerning (Features tab).
  const shaped = shapeText(state.font, text);
  let cursor = 12;
  let lastBaseX = 12;
  // Height grows with the proof size so caps/descenders are never clipped.
  const proofH = Math.round(size * 1.35) + 24;
  const baseline = proofH - 20;
  svg.style.height = `${proofH}px`;
  for (const item of shaped) {
    if (!item.name) {
      const r = document.createElementNS(SVGNS, "rect");
      r.setAttribute("x", String(cursor)); r.setAttribute("y", String(baseline - size * 0.7));
      r.setAttribute("width", String(size * 0.45)); r.setAttribute("height", String(size * 0.7));
      r.setAttribute("fill", "none"); r.setAttribute("stroke", "#ff7a6b");
      svg.appendChild(r);
      cursor += size * 0.55;
      continue;
    }
    const g = findGlyph(state.font, item.name);
    const isMark = item.advance === 0 && item.dx !== undefined;
    if (g) {
      const d = glyphToPathDResolved(state.font, g, state.font.currentMasterId);
      if (d) {
        const p = document.createElementNS(SVGNS, "path");
        p.setAttribute("d", d);
        if (isMark) {
          p.setAttribute("transform", `translate(${lastBaseX + (item.dx || 0) * s} ${baseline - (item.dy || 0) * s}) scale(${s} ${-s})`);
          p.setAttribute("fill", "#6fca97");
        } else {
          p.setAttribute("transform", `translate(${cursor} ${baseline}) scale(${s} ${-s})`);
          p.setAttribute("fill", "#e8ecf1");
        }
        p.setAttribute("fill-rule", "evenodd");
        svg.appendChild(p);
      }
    }
    if (!isMark) lastBaseX = cursor;
    cursor += item.advance * s;
  }
  const totalW = Math.max(cursor + 12, 320);
  svg.setAttribute("viewBox", `0 0 ${totalW} ${proofH}`);
  svg.setAttribute("width", String(totalW));
  const bl = document.createElementNS(SVGNS, "line");
  bl.setAttribute("x1", "0"); bl.setAttribute("x2", String(totalW));
  bl.setAttribute("y1", String(baseline)); bl.setAttribute("y2", String(baseline));
  bl.setAttribute("stroke", "#3a424e");
  svg.appendChild(bl);
}

function layerOf(glyph: Glyph): GlyphLayer {
  const id = state.font.currentMasterId;
  if (!glyph.layers[id]) glyph.layers[id] = { paths: [] };
  return glyph.layers[id];
}

function bindChange(el: Element | null, fn: (el: HTMLInputElement) => void): void {
  if (!el) return;
  el.addEventListener("change", () => { pushUndo(); fn(el as HTMLInputElement); editor.refresh(state.font, currentGlyph()); renderAll(); });
}

function renderInspector(g: Glyph): void {
  const page = $("#side-inspector");
  if (!g) { page.innerHTML = '<p class="hint">No glyph selected.</p>'; return; }
  const layer = layerOf(g);
  const nodeCount = layer.paths.reduce((n, c) => n + c.nodes.length, 0);
  const uni = g.unicode != null ? g.unicode.toString(16).toUpperCase().padStart(4, "0") : "";
  page.innerHTML = `
    <div class="field"><label>Glyph name</label><input id="inspName" type="text" value="${escHtml(g.name)}" /></div>
    <div class="field-row">
      <div class="field"><label>Unicode (hex)</label><input id="inspUni" type="text" value="${uni}" placeholder="0041" /></div>
      <div class="field"><label>Category</label><input id="inspCat" type="text" value="${escHtml(g.category || "")}" /></div>
    </div>
    <div class="field-row-3">
      <div class="field"><label>Width</label><input id="inspWidth" type="number" value="${g.width}" /></div>
      <div class="field"><label>LSB (shifts outline)</label><input id="inspLsb" type="number" value="${g.lsb}" /></div>
      <div class="field"><label>RSB (sets width)</label><input id="inspRsb" type="number" value="${g.rsb}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Left kerning group</label><input id="inspKgL" type="text" value="${escHtml(g.kerningGroupLeft || "")}" /></div>
      <div class="field"><label>Right kerning group</label><input id="inspKgR" type="text" value="${escHtml(g.kerningGroupRight || "")}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Left metrics key (glyph)</label><input id="inspMkL" type="text" value="${escHtml(g.metricsKeyLeft || "")}" placeholder="H" /></div>
      <div class="field"><label>Right metrics key (glyph)</label><input id="inspMkR" type="text" value="${escHtml(g.metricsKeyRight || "")}" placeholder="H" /></div>
    </div>
    <div class="field"><button id="syncMetricsBtn" type="button">Sync bearings from metrics keys</button></div>
    <div class="field"><label>Components (live from base glyphs)</label><div id="compList"></div></div>
    <div class="field"><button id="addCompBtn" type="button">+ Component…</button></div>
    <div class="field"><label>Smart parameters (when this glyph is used as a part)</label><div id="smartList"></div></div>
    <div class="field"><button id="addSmartBtn" type="button">+ Smart parameter…</button></div>
    <p class="hint">Layer: ${layer.paths.length} contour(s), ${nodeCount} node(s) on master
      ${escHtml(state.font.masters.find((m) => m.id === state.font.currentMasterId)?.name || "")}.
      Arrows nudge the selected node (Shift = ×10).</p>
    <div class="field"><label>Anchors</label><div id="anchorList"></div></div>
    <div class="field-row">
      <button id="addAnchorBtn" type="button">+ Anchor (top)</button>
      <button id="deleteGlyphBtn" type="button">Delete glyph</button>
    </div>
    <p class="hint">Handbook ref: Edit View (p13), Glyph Properties (p65), Anchors (p29). Full smart components, recipes and HOI are deferred in this MVP.</p>`;
  bindChange(page.querySelector("#inspName"), (el) => {
    const next = el.value.trim(); if (!next || findGlyph(state.font, next)) { setStatus("Name empty or already used — rename reverted."); state.font = state.undoStack.pop() || state.font; return; }
    const old = g.name;
    g.name = next;
    state.openTabs = state.openTabs.map((n) => (n === old ? next : n));
    state.currentGlyphName = next;
    const kern: Record<string, number> = {};
    for (const [k, v] of Object.entries(state.font.kerning)) {
      const [l, r] = k.split("|");
      kern[`${l === old ? next : l}|${r === old ? next : r}`] = v;
    }
    state.font.kerning = kern;
  });
  bindChange(page.querySelector("#inspUni"), (el) => {
    const v = el.value.trim();
    g.unicode = v ? parseInt(v, 16) : null;
  });
  bindChange(page.querySelector("#inspCat"), (el) => { g.category = el.value; });
  bindChange(page.querySelector("#inspWidth"), (el) => { g.width = Math.max(0, +el.value || 0); syncBearings(state.font, g); });
  bindChange(page.querySelector("#inspLsb"), (el) => {
    const dx = (+el.value || 0) - g.lsb;
    for (const c of layer.paths) for (const n of c.nodes) n.x += dx;
    syncBearings(state.font, g);
  });
  bindChange(page.querySelector("#inspRsb"), (el) => {
    const b = glyphBounds(g, state.font.currentMasterId);
    if (b) g.width = Math.max(0, Math.round(b.maxX + (+el.value || 0)));
    syncBearings(state.font, g);
  });
  bindChange(page.querySelector("#inspKgL"), (el) => { g.kerningGroupLeft = el.value.trim(); });
  bindChange(page.querySelector("#inspKgR"), (el) => { g.kerningGroupRight = el.value.trim(); });
  bindChange(page.querySelector("#inspMkL"), (el) => { g.metricsKeyLeft = el.value.trim(); });
  bindChange(page.querySelector("#inspMkR"), (el) => { g.metricsKeyRight = el.value.trim(); });
  qs<HTMLButtonElement>(page, "#syncMetricsBtn").addEventListener("click", () => {
    pushUndo();
    const layerNow = layerOf(g);
    if (g.metricsKeyLeft) {
      const ref = findGlyph(state.font, g.metricsKeyLeft);
      if (ref) {
        const dx = ref.lsb - g.lsb;
        for (const c of layerNow.paths) for (const n of c.nodes) n.x += dx;
      }
    }
    if (g.metricsKeyRight) {
      const ref = findGlyph(state.font, g.metricsKeyRight);
      const b = glyphBounds(g, state.font.currentMasterId);
      if (ref && b) g.width = Math.max(0, Math.round(b.maxX + ref.rsb));
    }
    syncBearings(state.font, g);
    editor.refresh(state.font, g); renderAll();
    setStatus("Bearings synced from metrics keys.");
  });
  const compList = qs<HTMLElement>(page, "#compList");
  compList.innerHTML = (g.components || []).length
    ? g.components.map((c, i) => {
      const base = findGlyph(state.font, c.glyph);
      const sliders = (base?.smartParams || []).map((p) => {
        const val = c.smart?.[p.name] ?? p.defaultValue;
        const step = Math.max((p.max - p.min) / 100, 0.01);
        return `<div class="field-row"><label>${escHtml(p.name)} <span data-smart-val="${i}:${escHtml(p.name)}">${val}</span></label><input data-smart-comp="${i}" data-smart-name="${escHtml(p.name)}" type="range" min="${p.min}" max="${p.max}" step="${step}" value="${val}" /></div>`;
      }).join("");
      return `<div class="field-row"><span>${escHtml(c.glyph)} @ ${c.x}, ${c.y}</span><button data-comp-del="${i}" type="button">Remove</button></div>${sliders}`;
    }).join("")
    : '<span class="hint">No components — this glyph is plain paths.</span>';
  compList.querySelectorAll<HTMLButtonElement>("[data-comp-del]").forEach((btn) => btn.addEventListener("click", () => {
    pushUndo(); g.components.splice(Number(btn.dataset.compDel) || 0, 1);
    editor.refresh(state.font, g); renderAll();
  }));
  compList.querySelectorAll<HTMLInputElement>("[data-smart-comp]").forEach((input) => {
    input.addEventListener("input", () => {
      const label = compList.querySelector(`[data-smart-val="${input.dataset.smartComp}:${input.dataset.smartName}"]`);
      if (label) label.textContent = input.value;
    });
    input.addEventListener("change", () => {
      const comp = g.components[Number(input.dataset.smartComp) || 0];
      const name = input.dataset.smartName;
      if (!comp || !name) return;
      pushUndo();
      comp.smart = { ...(comp.smart || {}), [name]: +input.value || 0 };
      editor.refresh(state.font, g); renderAll();
      setStatus(`Smart ${name} = ${input.value} on ${comp.glyph} — the outline updated live.`);
    });
  });
  const smartList = qs<HTMLElement>(page, "#smartList");
  smartList.innerHTML = (g.smartParams || []).length
    ? (g.smartParams || []).map((p, i) => `<div class="field-row"><span>${escHtml(p.name)} → ${escHtml(p.apply)} (${p.min}…${p.max}, default ${p.defaultValue})</span><button data-smart-del="${i}" type="button">Remove</button></div>`).join("")
    : '<span class="hint">None — add one to make this glyph an adjustable part.</span>';
  smartList.querySelectorAll<HTMLButtonElement>("[data-smart-del]").forEach((btn) => btn.addEventListener("click", () => {
    pushUndo(); (g.smartParams || []).splice(Number(btn.dataset.smartDel) || 0, 1);
    editor.refresh(state.font, g); renderAll();
  }));
  qs<HTMLButtonElement>(page, "#addSmartBtn").addEventListener("click", () => {
    const name = prompt("Parameter name (e.g. Width):", "Width");
    if (!name?.trim()) return;
    const apply = (prompt("Applies to: scaleX, scaleY, x or y:", "scaleX") || "").trim();
    if (!["scaleX", "scaleY", "x", "y"].includes(apply)) { setStatus("Smart parameter needs one of: scaleX, scaleY, x, y."); return; }
    const min = parseFloat(prompt("Minimum value:", apply.startsWith("scale") ? "0.5" : "0") || "");
    const max = parseFloat(prompt("Maximum value:", apply.startsWith("scale") ? "2" : "100") || "");
    const def = parseFloat(prompt("Default value:", apply.startsWith("scale") ? "1" : "0") || "");
    if (![min, max, def].every(Number.isFinite) || max <= min) { setStatus("Smart parameter values must be numbers with max > min."); return; }
    pushUndo();
    g.smartParams = g.smartParams || [];
    g.smartParams.push({ name: name.trim(), min, max, defaultValue: def, apply: apply as "scaleX" | "scaleY" | "x" | "y" });
    editor.refresh(state.font, g); renderAll();
    setStatus(`Smart parameter ${name.trim()} defined on ${g.name}. Glyphs using it as a component get a slider here.`);
  });
  qs<HTMLButtonElement>(page, "#addCompBtn").addEventListener("click", () => {
    const baseName = prompt("Base glyph name for the component (e.g. e, acutecomb):", "e");
    if (!baseName) return;
    if (!findGlyph(state.font, baseName.trim())) { setStatus(`Glyph ${baseName} does not exist yet — add it first.`); return; }
    pushUndo();
    g.components = g.components || [];
    g.components.push({ glyph: baseName.trim(), x: 0, y: 0, scaleX: 1, scaleY: 1 });
    editor.refresh(state.font, g); renderAll();
    setStatus(`Component ${baseName.trim()} added — it follows the base glyph live and decomposes on export.`);
  });
  const list = qs<HTMLElement>(page, "#anchorList");
  list.innerHTML = (g.anchors || []).length
    ? g.anchors.map((a, i) => `<div class="field-row"><span>${escHtml(a.name)} (${a.x}, ${a.y})</span><button data-anchor-del="${i}" type="button">Remove</button></div>`).join("")
    : '<span class="hint">No anchors yet.</span>';
  list.querySelectorAll<HTMLButtonElement>("[data-anchor-del]").forEach((btn) => btn.addEventListener("click", () => {
    pushUndo(); g.anchors.splice(Number(btn.dataset.anchorDel) || 0, 1);
    editor.refresh(state.font, g); renderAll();
  }));
  qs<HTMLButtonElement>(page, "#addAnchorBtn").addEventListener("click", () => {
    pushUndo();
    const b = glyphBounds(g, state.font.currentMasterId);
    const cx = b ? Math.round((b.minX + b.maxX) / 2) : Math.round(g.width / 2);
    const ty = b ? Math.round(b.maxY) : state.font.capHeight;
    g.anchors = g.anchors || []; g.anchors.push({ name: "top", x: cx, y: ty });
    editor.refresh(state.font, g); renderAll();
    setStatus("Anchor added — anchors export to UFO/GLIF.");
  });
  qs<HTMLButtonElement>(page, "#deleteGlyphBtn").addEventListener("click", () => {
    if (state.font.glyphs.length <= 1) { setStatus("Keep at least one glyph."); return; }
    if (!confirm(`Delete glyph ${g.name}?`)) return;
    pushUndo();
    state.font.glyphs = state.font.glyphs.filter((x) => x !== g);
    state.openTabs = state.openTabs.filter((n) => n !== g.name);
    state.currentGlyphName = state.font.glyphs[0].name;
    editor.setGlyph(state.font, currentGlyph()); renderAll();
  });
}

function transformLayer(g: Glyph, fn: (x: number, y: number) => [number, number]): void {
  const layer = layerOf(g);
  for (const c of layer.paths) for (const n of c.nodes) {
    const r = fn(n.x, n.y); n.x = Math.round(r[0]); n.y = Math.round(r[1]);
  }
  syncBearings(state.font, g);
}

function renderPalette(g: Glyph): void {
  const page = $("#side-palette");
  if (!g) { page.innerHTML = '<p class="hint">No glyph selected.</p>'; return; }
  const b = glyphBounds(g, state.font.currentMasterId);
  const boundsTxt = b ? `X ${Math.round(b.minX)}…${Math.round(b.maxX)} · Y ${Math.round(b.minY)}…${Math.round(b.maxY)} · W ${Math.round(b.maxX - b.minX)} × H ${Math.round(b.maxY - b.minY)}` : "Empty layer";
  page.innerHTML = `
    <p class="hint"><strong>Bounds:</strong> ${boundsTxt}</p>
    <div class="field-row">
      <div class="field"><label>Move X</label><input id="palDx" type="number" value="0" /></div>
      <div class="field"><label>Move Y</label><input id="palDy" type="number" value="0" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Scale %</label><input id="palScale" type="number" value="100" /></div>
      <div class="field"><label>Rotate ° (around origin)</label><input id="palRot" type="number" value="0" /></div>
    </div>
    <div class="field-row">
      <button id="palApply" type="button">Apply transform</button>
      <button id="palFlipH" type="button">Flip horizontal</button>
    </div>
    <div class="field-row">
      <button id="palFlipV" type="button">Flip vertical</button>
      <button id="palCopyLayer" type="button">Copy layer to new master…</button>
    </div>
    <div class="field"><label>Interpolation preview (first ↔ last master)</label>
      <input id="palInterp" type="range" min="0" max="100" value="50" />
      <span id="palInterpLabel" class="hint"></span>
    </div>
    <div class="field-row">
      <button id="palExportInstance" type="button">Export instance UFO</button>
      <button id="palFixDir" type="button">Fix path direction</button>
    </div>
    <div class="field"><button id="palUnion" type="button">Remove overlaps (union, flattens curves)</button></div>
    <div class="field"><button id="palSubtract" type="button">Subtract overlaps (first contour minus the rest, flattens curves)</button></div>
    <p class="hint">Handbook ref: Palette (p54), Transformations (p56), Interpolation (p150). Interpolation needs compatible masters (same contour/node order). Union flattens curves to lines — undo is available.</p>`;
  qs<HTMLButtonElement>(page, "#palApply").addEventListener("click", () => {
    pushUndo();
    const dx = +qs<HTMLInputElement>(page, "#palDx").value || 0;
    const dy = +qs<HTMLInputElement>(page, "#palDy").value || 0;
    const sc = (+qs<HTMLInputElement>(page, "#palScale").value || 100) / 100;
    const rad = ((+qs<HTMLInputElement>(page, "#palRot").value || 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    transformLayer(g, (x, y) => {
      const rx = x * cos - y * sin, ry = x * sin + y * cos;
      return [rx * sc + dx, ry * sc + dy];
    });
    editor.refresh(state.font, g); renderAll();
    setStatus("Transform applied (Ctrl+Z to undo).");
  });
  qs<HTMLButtonElement>(page, "#palFlipH").addEventListener("click", () => {
    if (!b) return; pushUndo();
    const cx = b.minX + b.maxX;
    transformLayer(g, (x, y) => [cx - x, y]);
    // Mirroring reverses winding; keep MVP simple and note it.
    editor.refresh(state.font, g); renderAll();
    setStatus("Flipped horizontally. Check path direction before export (Handbook p24).");
  });
  qs<HTMLButtonElement>(page, "#palFlipV").addEventListener("click", () => {
    if (!b) return; pushUndo();
    const cy = b.minY + b.maxY;
    transformLayer(g, (x, y) => [x, cy - y]);
    editor.refresh(state.font, g); renderAll();
    setStatus("Flipped vertically. Check path direction before export (Handbook p24).");
  });
  const interpSlider = qs<HTMLInputElement>(page, "#palInterp");
  const interpLabel = qs<HTMLElement>(page, "#palInterpLabel");
  const updateInterp = (): void => {
    const t = (+interpSlider.value || 0) / 100;
    const ig = interpolateGlyphAt(state.font, g.name, t);
    if (!ig) {
      interpLabel.textContent = state.font.masters.length < 2 ? "Add a second master to interpolate." : "Masters incompatible for this glyph (contour/node order differs).";
      editor.setGhostD(null);
      return;
    }
    interpLabel.textContent = `t=${t.toFixed(2)} between ${state.font.masters[0].name} and ${state.font.masters[state.font.masters.length - 1].name} — dashed green ghost in the editor.`;
    editor.setGhostD(contoursToPathD(ig.layers[state.font.currentMasterId]?.paths ?? []));
  };
  interpSlider.addEventListener("input", updateInterp);
  updateInterp();
  qs<HTMLButtonElement>(page, "#palExportInstance").addEventListener("click", async () => {
    const t = (+interpSlider.value || 0) / 100;
    if (!mastersCompatible(state.font, g.name) && state.font.masters.length >= 2) {
      setStatus("Instance export needs compatible masters for every glyph — fix outline order first.");
      return;
    }
    const instanceFont = cloneFont(state.font);
    for (const glyph of instanceFont.glyphs) {
      const ig = interpolateGlyphAt(instanceFont, glyph.name, t);
      if (ig) glyph.layers[instanceFont.currentMasterId] = ig.layers[instanceFont.currentMasterId];
    }
    const base = (state.font.familyName || "Instance").replace(/[^\w\- ]/g, "").trim() || "Instance";
    if (!await deliverBytes(`${base}-Instance.ufo.zip`, fontToUfoZip(instanceFont), "application/zip")) { setStatus("Export cancelled."); return; }
    setStatus(`Exported instance UFO at t=${t.toFixed(2)} (decomposed, with designspace.json manifest).`);
  });
  qs<HTMLButtonElement>(page, "#palFixDir").addEventListener("click", () => {
    pushUndo();
    const layer = layerOf(g);
    const changed = fixContourDirections(layer.paths);
    syncBearings(state.font, g);
    editor.refresh(state.font, g); renderAll();
    setStatus(changed ? `Reversed ${changed} contour(s) to counter-clockwise.` : "All closed contours already run counter-clockwise.");
  });
  qs<HTMLButtonElement>(page, "#palUnion").addEventListener("click", () => {
    pushUndo();
    const layer = layerOf(g);
    const before = layer.paths.length;
    layer.paths = unionContours(layer.paths);
    syncBearings(state.font, g);
    editor.refresh(state.font, g); renderAll();
    setStatus(`Remove overlaps: ${before} → ${layer.paths.length} contour(s). Curves were flattened — Ctrl+Z restores them.`);
  });
  qs<HTMLButtonElement>(page, "#palSubtract").addEventListener("click", () => {
    pushUndo();
    const layer = layerOf(g);
    const before = layer.paths.length;
    layer.paths = differenceContours(layer.paths);
    syncBearings(state.font, g);
    editor.refresh(state.font, g); renderAll();
    setStatus(`Subtract: ${before} → ${layer.paths.length} contour(s). Curves were flattened — Ctrl+Z restores them.`);
  });
  qs<HTMLButtonElement>(page, "#palCopyLayer").addEventListener("click", () => { addMasterCopy(); });
}

function renderKerning(): void {
  const page = $("#side-kerning");
  const rows = Object.entries(state.font.kerning).sort((a, b) => a[0].localeCompare(b[0]));
  page.innerHTML = `
    <div class="field-row">
      <div class="field"><label>Left glyph</label><input id="kernL" type="text" placeholder="A" /></div>
      <div class="field"><label>Right glyph</label><input id="kernR" type="text" placeholder="V" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Value</label><input id="kernV" type="number" value="-50" /></div>
      <div class="field"><label>&nbsp;</label><button id="kernAdd" type="button">Add / update pair</button></div>
    </div>
    <table class="kern"><thead><tr><th>Pair</th><th>Value</th><th></th></tr></thead>
    <tbody>${rows.map(([k, v]) => `<tr><td>${escHtml(k.replace("|", " → "))}</td><td><input data-kern-edit="${escHtml(k)}" type="number" value="${v}" /></td><td><button data-kern-del="${escHtml(k)}" type="button">Delete</button></td></tr>`).join("") || '<tr><td colspan="3">No pairs yet.</td></tr>'}</tbody></table>
    <p class="hint">Kerning applies in the preview below and exports to UFO kerning.plist, .glyphs JSON and beta OTF. Handbook ref: Kerning (p120). Group kerning is stored per glyph in the Inspector; pair exceptions win here.</p>
    <div class="field-row">
      <div class="field"><label>Left group (right side)</label><input id="kernGL" type="text" placeholder="A" /></div>
      <div class="field"><label>Right group (left side)</label><input id="kernGR" type="text" placeholder="V" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Group value</label><input id="kernGV" type="number" value="-40" /></div>
      <div class="field"><label>&nbsp;</label><button id="kernGAdd" type="button">Add group pair</button></div>
    </div>
    <div id="kernGroups"></div>`;
  qs<HTMLButtonElement>(page, "#kernAdd").addEventListener("click", () => {
    const l = qs<HTMLInputElement>(page, "#kernL").value.trim();
    const r = qs<HTMLInputElement>(page, "#kernR").value.trim();
    const v = +qs<HTMLInputElement>(page, "#kernV").value || 0;
    if (!l || !r) { setStatus("Enter both glyph names for the pair."); return; }
    pushUndo(); state.font.kerning[kernKey(l, r)] = v; renderAll();
    setStatus(`Kerning ${l} → ${r} = ${v}. Watch the preview update.`);
  });
  page.querySelectorAll<HTMLInputElement>("[data-kern-edit]").forEach((input) => input.addEventListener("change", () => {
    const key = input.dataset.kernEdit;
    if (!key) return;
    pushUndo(); state.font.kerning[key] = +input.value || 0; renderAll();
  }));
  page.querySelectorAll<HTMLButtonElement>("[data-kern-del]").forEach((btn) => btn.addEventListener("click", () => {
    const key = btn.dataset.kernDel;
    if (!key) return;
    pushUndo(); delete state.font.kerning[key]; renderAll();
  }));
  const groupsEl = qs<HTMLElement>(page, "#kernGroups");
  const groupRows = Object.entries(state.font.kerningGroups || {}).sort((a, b) => a[0].localeCompare(b[0]));
  groupsEl.innerHTML = groupRows.length
    ? `<table class="kern"><thead><tr><th>Group pair</th><th>Value</th><th></th></tr></thead><tbody>${groupRows.map(([k, v]) => `<tr><td>${escHtml(k.replace("|", " → "))}</td><td>${v}</td><td><button data-kern-gdel="${escHtml(k)}" type="button">Delete</button></td></tr>`).join("")}</tbody></table>`
    : '<p class="hint">No group pairs yet. Set groups per glyph in the Inspector, then add the group value here.</p>';
  groupsEl.querySelectorAll<HTMLButtonElement>("[data-kern-gdel]").forEach((btn) => btn.addEventListener("click", () => {
    const key = btn.dataset.kernGdel;
    if (!key) return;
    pushUndo(); delete state.font.kerningGroups[key]; renderAll();
  }));
  qs<HTMLButtonElement>(page, "#kernGAdd").addEventListener("click", () => {
    const l = qs<HTMLInputElement>(page, "#kernGL").value.trim();
    const r = qs<HTMLInputElement>(page, "#kernGR").value.trim();
    const v = +qs<HTMLInputElement>(page, "#kernGV").value || 0;
    if (!l || !r) { setStatus("Enter both group names."); return; }
    pushUndo(); state.font.kerningGroups[`${l}|${r}`] = v; renderAll();
    setStatus(`Group kerning ${l} → ${r} = ${v} (pair exceptions still win).`);
  });
}

function renderFeatures(): void {
  const page = $("#side-features");
  const parsed = parseFeatureCode(state.font.featureCode || "");
  page.innerHTML = `
    <div class="field"><label>Feature code (subset)</label>
      <textarea id="featureCode" spellcheck="false">${escHtml(state.font.featureCode || "")}</textarea>
    </div>
    <div class="field"><button id="featureApply" type="button">Apply feature code</button></div>
    <p class="hint">Parsed: ${parsed.classes.size} class(es), ${parsed.subs.length} substitution(s), ${parsed.poss.size} position pair(s). Supported: <span class="muted">@Class = [A B];</span>, <span class="muted">sub f i by fi;</span>, <span class="muted">pos A V -70;</span> (classes expand in pos). Applied live in the preview below. Handbook ref: Feature Code (p179).</p>
    <p class="warn">Subset only: combining marks position on top/_top anchors in the preview; complex-script shaping and full OpenType layout are deferred — proof final fonts in a real shaper before shipping.</p>`;
  qs<HTMLButtonElement>(page, "#featureApply").addEventListener("click", () => {
    pushUndo();
    state.font.featureCode = qs<HTMLTextAreaElement>(page, "#featureCode").value;
    renderAll();
    const p = parseFeatureCode(state.font.featureCode);
    setStatus(`Feature code applied: ${p.subs.length} sub(s), ${p.poss.size} pos pair(s). Try the preview text “fi” or “AV”.`);
  });
}

function renderFontInfo(): void {
  const page = $("#side-fontinfo");
  const f = state.font;
  page.innerHTML = `
    <div class="field"><label>Family name</label><input id="fiFamily" type="text" value="${escHtml(f.familyName)}" /></div>
    <div class="field-row">
      <div class="field"><label>Version</label><input id="fiVersion" type="text" value="${escHtml(f.version)}" /></div>
      <div class="field"><label>Units per em</label><input id="fiUpm" type="number" value="${f.unitsPerEm}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Ascender</label><input id="fiAsc" type="number" value="${f.ascender}" /></div>
      <div class="field"><label>Descender</label><input id="fiDesc" type="number" value="${f.descender}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Cap height</label><input id="fiCap" type="number" value="${f.capHeight}" /></div>
      <div class="field"><label>x-height</label><input id="fiX" type="number" value="${f.xHeight}" /></div>
    </div>
    <p class="hint"><strong>Masters:</strong> ${f.masters.map((m) => escHtml(`${m.name} (${m.weightValue})`)).join(", ") || "—"}<br/>
    <strong>Instances:</strong> ${f.instances.map((i) => escHtml(i.name)).join(", ") || "—"}<br/>
    <strong>Axes:</strong> ${(f.axes || []).map((a) => escHtml(`${a.name} ${a.min}…${a.max} (default ${a.defaultValue})`)).join(", ") || "—"}</p>
    <p class="hint">Handbook ref: Font Info (p85), Masters (p88), Exports (p92). Exports use the active master. Variable-font axes and custom parameters are deferred.</p>`;
  bindChange(page.querySelector("#fiFamily"), (el) => { f.familyName = el.value; });
  bindChange(page.querySelector("#fiVersion"), (el) => { f.version = el.value; });
  bindChange(page.querySelector("#fiUpm"), (el) => { f.unitsPerEm = Math.max(16, +el.value || 1000); });
  bindChange(page.querySelector("#fiAsc"), (el) => { f.ascender = +el.value || 0; });
  bindChange(page.querySelector("#fiDesc"), (el) => { f.descender = +el.value || 0; });
  bindChange(page.querySelector("#fiCap"), (el) => { f.capHeight = +el.value || 0; });
  bindChange(page.querySelector("#fiX"), (el) => { f.xHeight = +el.value || 0; });
}

function renderSide(): void {
  const g = currentGlyph();
  renderInspector(g);
  renderPalette(g);
  renderKerning();
  renderFeatures();
  renderExport();
  renderFontInfo();
}

function setTool(tool: Tool): void {
  editor.setTool(tool);
  editorB.setTool(tool);
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => b.classList.toggle("is-on", b.dataset.tool === tool));
  setStatus(tool === "pen" ? "Pen: click to place nodes, drag to pull handles, click the first node to close."
    : tool === "pencil" ? "Pencil: drag a freehand stroke — it becomes an editable open contour on release."
    : tool === "measure" ? "Measure: click two points (snaps to nodes); the readout shows distance and angle. Nothing is modified."
    : tool === "hand" ? "Hand: drag to pan, wheel to zoom."
    : tool === "text" ? "Text: type in Preview below; red boxes mean the glyph is missing."
    : "Select: drag nodes/handles; Shift-click selects multiple nodes for alignment; arrows nudge the selection.");
}

function addMasterCopy(): void {
  const name = prompt("New master name (e.g. Bold):", "Bold");
  if (!name) return;
  pushUndo();
  const id = `master${Date.now().toString(36)}`;
  state.font.masters.push({ id, name, weightValue: 700 });
  for (const glyph of state.font.glyphs) {
    const src = glyph.layers[state.font.currentMasterId] || { paths: [] };
    glyph.layers[id] = JSON.parse(JSON.stringify(src)) as GlyphLayer;
  }
  state.font.instances.push({ name, masterId: id, active: true });
  state.paneBMasterId = id;
  editorB.setMasterOverride(id);
  renderAll();
  refreshPaneB(true);
  setStatus(`Master ${name} created from the current layers. ${state.splitView ? "Pane B shows it — edit both masters side by side." : "Use Masters side-by-side to edit it next to the current master."}`);
}

function toggleSplitView(): void {
  state.splitView = !state.splitView;
  renderHeader();
  if (state.splitView) {
    editorB.setMasterOverride(state.paneBMasterId || null);
    editorB.setGlyph(state.font, currentGlyph());
    setStatus(state.font.masters.length < 2
      ? "Side-by-side on, but this font has one master — use + Master (copy) to create the second one."
      : "Side-by-side masters: click a pane to make it active, then draw/edit. Each pane keeps its own master.");
  } else {
    activeEd = editor;
    setStatus("Side-by-side off.");
  }
}

function addGlyphFlow(): void {
  const name = prompt("Glyph name (e.g. B, eacute, or a single character):", "B");
  if (!name) return;
  const trimmed = name.trim();
  if (findGlyph(state.font, trimmed)) { setStatus(`Glyph ${trimmed} already exists.`); return; }
  pushUndo();
  const glyph: Glyph = {
    name: trimmed,
    unicode: [...trimmed].length === 1 ? (trimmed.codePointAt(0) ?? null) : null,
    width: 600, lsb: 40, rsb: 40, category: "Letter",
    kerningGroupLeft: "", kerningGroupRight: "", anchors: [], components: [],
    metricsKeyLeft: "", metricsKeyRight: "", layers: {},
  };
  for (const m of state.font.masters) glyph.layers[m.id] = { paths: [] };
  state.font.glyphs.push(glyph);
  // Auto-composite from the recipe table when every base glyph exists.
  const recipe = compositeRecipe(trimmed);
  if (recipe && recipe.every((base) => findGlyph(state.font, base))) {
    glyph.components = recipe.map((base, idx) => ({
      glyph: base, x: idx === 0 ? 0 : Math.round(glyph.width / 2 - 60), y: 0, scaleX: 1, scaleY: 1,
    }));
    openGlyph(trimmed, true);
    setStatus(`Glyph ${trimmed} built as composite (${recipe.join(" + ")}). Edit the bases to update it live.`);
    return;
  }
  openGlyph(trimmed, true);
  setStatus(`Glyph ${trimmed} added — draw it with the Pen, or add Rect/Ellipse primitives.`);
}

function createCompositeFlow(): void {
  const g = currentGlyph();
  if (!g) return;
  const recipe = compositeRecipe(g.name);
  if (!recipe) { setStatus(`No recipe for ${g.name}. Add components manually in the Inspector.`); return; }
  const missing = recipe.filter((base) => !findGlyph(state.font, base));
  if (missing.length) { setStatus(`Missing base glyph(s): ${missing.join(", ")} — add them first.`); return; }
  pushUndo();
  g.components = recipe.map((base, idx) => ({
    glyph: base, x: idx === 0 ? 0 : Math.round(g.width / 2 - 60), y: 0, scaleX: 1, scaleY: 1,
  }));
  editor.refresh(state.font, g); renderAll();
  setStatus(`${g.name} is now a composite (${recipe.join(" + ")}).`);
}

function applyOpenedFont(font: Font, fileName: string): void {
  state.font = font;
  state.undoStack = []; state.redoStack = [];
  state.currentGlyphName = state.font.glyphs[0]?.name || "";
  state.openTabs = state.currentGlyphName ? [state.currentGlyphName] : [];
  ensureCurrentGlyph();
  editor.setGlyph(state.font, currentGlyph());
  renderAll();
  setStatus(`Opened ${fileName} — ${state.font.glyphs.length} glyphs, master ${state.font.currentMasterId}.`);
}

async function handleOpenFile(file: File): Promise<void> {
  try {
    if (/\.zip$/i.test(file.name)) {
      const map = await unzipToMap(await file.arrayBuffer());
      applyOpenedFont(ufoMapToFont(map, file.name), file.name);
    } else {
      applyOpenedFont(glyphsJsonToFont(await file.text(), file.name), file.name);
    }
  } catch (err) {
    setStatus(`Open failed: ${(err as Error).message}`);
  }
}

async function handleDesktopOpen(): Promise<void> {
  try {
    const picked = await desktopOpenFile();
    if (!picked) { setStatus("Open cancelled."); return; }
    if (fileKindForName(picked.name) === "binary") {
      const bytes = base64ToBytes(picked.base64 || "");
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const map = await unzipToMap(buffer);
      applyOpenedFont(ufoMapToFont(map, picked.name), picked.name);
    } else {
      applyOpenedFont(glyphsJsonToFont(picked.text || "", picked.name), picked.name);
    }
  } catch (err) {
    setStatus(`Open failed: ${(err as Error).message}`);
  }
}

function openFontFlow(): void {
  if (isDesktop()) { void handleDesktopOpen(); return; }
  $<HTMLInputElement>("#fileInput").click();
}

/** Desktop: native save dialog. Browser: download. False means the user cancelled. */
async function deliverText(filename: string, text: string, mime: string): Promise<boolean> {
  const saved = await desktopSaveText(filename, text);
  if (saved) {
    if (saved.saved) setStatus(`Saved to ${saved.path || saved.name || filename}.`);
    return saved.saved;
  }
  downloadText(filename, text, mime);
  return true;
}

async function deliverBytes(filename: string, bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<boolean> {
  const saved = await desktopSaveBytes(filename, bytes);
  if (saved) {
    if (saved.saved) setStatus(`Saved to ${saved.path || saved.name || filename}.`);
    return saved.saved;
  }
  downloadBytes(filename, bytes, mime);
  return true;
}

async function saveGlyphs(): Promise<void> {
  const base = (state.font.familyName || "Untitled").replace(/[^\w\- ]/g, "").trim() || "Untitled";
  if (!await deliverText(`${base}.glyphs`, fontToOpenStep(state.font), "text/plain")) { setStatus("Save cancelled."); return; }
  state.font.fileName = `${base}.glyphs`;
  renderHeader();
  setStatus("Saved .glyphs (OpenStep plist: masters, layers, anchors, components, kerning). Glyphs-only fields this app does not model are not preserved.");
}
async function saveGlyphsJson(): Promise<void> {
  const base = (state.font.familyName || "Untitled").replace(/[^\w\- ]/g, "").trim() || "Untitled";
  if (!await deliverText(`${base}.glyphs`, fontToGlyphsJson(state.font), "application/json")) { setStatus("Save cancelled."); return; }
  state.font.fileName = `${base}.glyphs`;
  renderHeader();
  setStatus("Saved .glyphs (JSON subset fallback — reopens here; prefer OpenStep for other tools).");
}
async function exportUfo(): Promise<void> {
  const base = (state.font.familyName || "Untitled").replace(/[^\w\- ]/g, "").trim() || "Untitled";
  if (!await deliverBytes(`${base}.ufo.zip`, fontToUfoZip(state.font), "application/zip")) { setStatus("Export cancelled."); return; }
  setStatus("Exported UFO as .ufo.zip — unzip to get the .ufo folder for FontForge/fontTools.");
}
async function probeCompileService(statusEl: HTMLElement): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 900);
    const res = await fetch(`${COMPILE_SERVICE}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info = (await res.json()) as { fontTools?: string; brotli?: boolean };
    statusEl.textContent = `Compile service: online (fontTools ${info.fontTools ?? "?"}, brotli ${info.brotli ? "yes" : "no"}). WOFF2/variable enabled.`;
    return true;
  } catch {
    statusEl.textContent = "Compile service: offline. Browser formats (OTF/TTF/WOFF) still work; start tools/fontc for WOFF2/variable.";
    return false;
  }
}

function renderExport(): void {
  const page = $("#side-export");
  const report = validateFont(state.font);
  const issueList = (items: Array<{ severity: string; message: string }>) => items.length
    ? `<ul>${items.map((i) => `<li>${escHtml(i.message)}</li>`).join("")}</ul>` : "<p class=\"hint\">None.</p>";
  page.innerHTML = `
    <div class="field"><label>Format</label>
      <select id="exportFormat">
        <option value="otf">OpenType CFF (.otf) — browser</option>
        <option value="ttf">TrueType (.ttf) — browser, curves approximated</option>
        <option value="woff">WOFF (.woff from TTF) — browser</option>
        <option value="woff2">WOFF2 (.woff2) — compile service</option>
        <option value="variable">Variable font (.ttf) — compile service</option>
      </select>
    </div>
    <div class="field"><button id="exportGo" type="button" ${report.ok ? "" : "disabled"}>Export font</button></div>
    <p id="exportService" class="hint">Compile service: probing…</p>
    <div class="field"><label>Validation errors (block export)</label>${issueList(report.errors)}</div>
    <div class="field"><label>Warnings</label>${issueList(report.warnings)}</div>
    <p class="hint">Exports use the active master (variable uses all masters). Handbook ref: Import &amp; Export (p104), Font Info Exports (p92). Full shaping/hinting stays deferred — proof binaries externally.</p>`;
  void probeCompileService(qs<HTMLElement>(page, "#exportService"));
  qs<HTMLButtonElement>(page, "#exportGo").addEventListener("click", () => { void runExport(qs<HTMLSelectElement>(page, "#exportFormat").value); });
}

async function runExport(format: string): Promise<void> {
  const base = (state.font.familyName || "Untitled").replace(/[^\w\- ]/g, "").trim() || "Untitled";
  try {
    if (format === "otf") {
      if (!await deliverBytes(`${base}.otf`, new Uint8Array(fontToOtfArrayBuffer(state.font)), "font/otf")) { setStatus("Export cancelled."); return; }
      setStatus("Exported OTF (CFF, active master).");
      return;
    }
    if (format === "ttf") {
      if (!await deliverBytes(`${base}.ttf`, fontToTtfBytes(state.font), "font/ttf")) { setStatus("Export cancelled."); return; }
      setStatus("Exported TTF (glyf). Cubic curves were approximated by quadratics (tolerance 4 units).");
      return;
    }
    if (format === "woff") {
      if (!await deliverBytes(`${base}.woff`, await fontToWoffBytes(fontToTtfBytes(state.font)), "font/woff")) { setStatus("Export cancelled."); return; }
      setStatus("Exported WOFF (from the TTF build).");
      return;
    }
    if (format === "woff2") {
      const res = await fetch(`${COMPILE_SERVICE}/compile/woff2`, { method: "POST", body: fontToTtfBytes(state.font) as BlobPart });
      if (!res.ok) throw new Error(`service HTTP ${res.status}: ${await res.text()}`);
      if (!await deliverBytes(`${base}.woff2`, new Uint8Array(await res.arrayBuffer()), "font/woff2")) { setStatus("Export cancelled."); return; }
      setStatus("Exported WOFF2 via the compile service.");
      return;
    }
    if (format === "variable") {
      if (state.font.masters.length < 2) { setStatus("Variable export needs at least two masters — copy a layer to a new master in the Palette first."); return; }
      const res = await fetch(`${COMPILE_SERVICE}/compile/variable`, { method: "POST", body: fontToDesignspaceBundle(state.font) as BlobPart });
      if (!res.ok) throw new Error(`service HTTP ${res.status}: ${await res.text()}`);
      if (!await deliverBytes(`${base}-Variable.ttf`, new Uint8Array(await res.arrayBuffer()), "font/ttf")) { setStatus("Export cancelled."); return; }
      setStatus("Exported variable font via the compile service. Check the default instance against the Palette interpolation ghost.");
      return;
    }
  } catch (err) {
    setStatus(`Export failed (${format}): ${(err as Error).message}. Browser formats still work without the service.`);
  }
}

function dispatch(cmd: string): void {
  const g = currentGlyph();
  switch (cmd) {
    case "new":
      if (!confirm("Start a new font? Unsaved changes in this tab will be lost (export first if needed).")) return;
      state.font = createDefaultFont(); state.undoStack = []; state.redoStack = [];
      state.currentGlyphName = "A"; state.openTabs = ["A"];
      editor.setGlyph(state.font, currentGlyph()); renderAll(); setStatus("New font — Handbook Sans starter set.");
      break;
    case "open": openFontFlow(); break;
    case "save-glyphs": void saveGlyphs(); break;
    case "save-glyphs-json": void saveGlyphsJson(); break;
    case "export-ufo": void exportUfo(); break;
    case "export-font": document.querySelector<HTMLButtonElement>('[data-side="export"]')?.click(); break;
    case "undo": undo(); break;
    case "redo": redo(); break;
    case "delete-sel": activeEd.deleteSelected(); break;
    case "close-path": activeEd.closeActivePath(); break;
    case "convert": activeEd.convertSelected(); break;
    case "zoom-in": activeEd.zoomBy(1.25); break;
    case "zoom-out": activeEd.zoomBy(1 / 1.25); break;
    case "zoom-fit": activeEd.zoomFit(); break;
    case "toggle-guides": setStatus(`Guides ${activeEd.toggleGuides() ? "on" : "off"}.`); break;
    case "toggle-nodes": setStatus(`Nodes ${activeEd.toggleNodes() ? "shown" : "hidden"}.`); break;
    case "add-glyph": addGlyphFlow(); break;
    case "create-composite": createCompositeFlow(); break;
    case "add-rect": if (g) activeEd.addContour(rectContour(80, 0, 360, 500)); break;
    case "add-ellipse": if (g) activeEd.addContour(ellipseContour(300, 250, 220, 250)); break;
    default: break;
  }
}

document.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((b) => b.addEventListener("click", () => { const cmd = b.dataset.cmd; if (cmd) dispatch(cmd); }));
document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => b.addEventListener("click", () => setTool((b.dataset.tool || "select") as Tool)));
document.querySelectorAll<HTMLButtonElement>("[data-side]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll<HTMLButtonElement>("[data-side]").forEach((x) => x.classList.toggle("is-on", x === b));
  document.querySelectorAll<HTMLElement>(".side-page").forEach((p) => p.classList.toggle("is-on", p.id === `side-${b.dataset.side}`));
}));
$("#gridModeBtn").addEventListener("click", () => { state.fontViewMode = "grid"; renderFontView(); });
$("#listModeBtn").addEventListener("click", () => { state.fontViewMode = "list"; renderFontView(); });
$<HTMLInputElement>("#glyphSearch").addEventListener("input", renderFontView);
$("#addGlyphBtn").addEventListener("click", addGlyphFlow);
$<HTMLSelectElement>("#masterSelect").addEventListener("change", (ev) => {
  const target = ev.target as HTMLSelectElement;
  state.font.currentMasterId = target.value;
  editor.refresh(state.font, currentGlyph());
  renderAll();
  setStatus(`Active master: ${state.font.masters.find((m) => m.id === target.value)?.name}.`);
});
$<HTMLInputElement>("#fileInput").addEventListener("change", (ev) => {
  const input = ev.target as HTMLInputElement;
  const f = input.files?.[0];
  if (f) void handleOpenFile(f);
  input.value = "";
});
$<HTMLInputElement>("#previewText").addEventListener("input", renderPreview);
$<HTMLInputElement>("#previewSize").addEventListener("input", renderPreview);
$("#splitBtn").addEventListener("click", toggleSplitView);
$("#addMasterBtn").addEventListener("click", addMasterCopy);
$<HTMLSelectElement>("#paneBMaster").addEventListener("change", (ev) => {
  state.paneBMasterId = (ev.target as HTMLSelectElement).value;
  editorB.setMasterOverride(state.paneBMasterId || null);
  editorB.refresh(state.font, currentGlyph());
  setStatus(`Pane B master: ${state.font.masters.find((m) => m.id === state.paneBMasterId)?.name || ""}.`);
});
document.querySelectorAll<HTMLButtonElement>("[data-align]").forEach((b) => b.addEventListener("click", () => {
  activeEd.alignSelection((b.dataset.align || "left") as AlignMode);
}));
$("#rectBtn").addEventListener("click", () => dispatch("add-rect"));
$("#ellipseBtn").addEventListener("click", () => dispatch("add-ellipse"));
$("#closePathBtn").addEventListener("click", () => dispatch("close-path"));
$("#convertBtn").addEventListener("click", () => dispatch("convert"));
$("#deleteBtn").addEventListener("click", () => dispatch("delete-sel"));
$("#undoBtn").addEventListener("click", () => dispatch("undo"));
$("#redoBtn").addEventListener("click", () => dispatch("redo"));

document.addEventListener("keydown", (ev) => {
  const tag = document.activeElement?.tagName;
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  const mod = ev.ctrlKey || ev.metaKey;
  if (mod && ev.key.toLowerCase() === "n") { ev.preventDefault(); dispatch("new"); return; }
  if (mod && ev.key.toLowerCase() === "o") { ev.preventDefault(); dispatch("open"); return; }
  if (mod && ev.key.toLowerCase() === "s") { ev.preventDefault(); dispatch("save-glyphs"); return; }
  if (mod && ev.key.toLowerCase() === "e") { ev.preventDefault(); dispatch("export-ufo"); return; }
  if (mod && ev.key.toLowerCase() === "z" && !ev.shiftKey) { ev.preventDefault(); undo(); return; }
  if ((mod && ev.key.toLowerCase() === "y") || (mod && ev.shiftKey && ev.key.toLowerCase() === "z")) { ev.preventDefault(); redo(); return; }
  if (typing) return;
  if (mod && (ev.key === "+" || ev.key === "=")) { ev.preventDefault(); activeEd.zoomBy(1.25); return; }
  if (mod && ev.key === "-") { ev.preventDefault(); activeEd.zoomBy(1 / 1.25); return; }
  if (mod && ev.key === "0") { ev.preventDefault(); activeEd.zoomFit(); return; }
  if (ev.key === "Delete" || ev.key === "Backspace") { activeEd.deleteSelected(); return; }
  const step = ev.shiftKey ? 10 : 1;
  if (ev.key === "ArrowLeft") { ev.preventDefault(); activeEd.nudgeSelected(-step, 0); }
  if (ev.key === "ArrowRight") { ev.preventDefault(); activeEd.nudgeSelected(step, 0); }
  if (ev.key === "ArrowUp") { ev.preventDefault(); activeEd.nudgeSelected(0, step); }
  if (ev.key === "ArrowDown") { ev.preventDefault(); activeEd.nudgeSelected(0, -step); }
  const k = ev.key.toLowerCase();
  if (k === "v") setTool("select");
  if (k === "p") setTool("pen");
  if (k === "b") setTool("pencil");
  if (k === "m") setTool("measure");
  if (k === "h") setTool("hand");
  if (k === "t") { setTool("text"); $<HTMLInputElement>("#previewText").focus(); }
});

// Boot. In the Electron shell the native menu drives the same commands.
onDesktopMenuCommand((command) => dispatch(command));
editor.setGlyph(state.font, currentGlyph());
renderAll();
setTool("select");
