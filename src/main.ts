// App wiring: Font View, Edit View tabs, Inspector/Palette/Kerning/Font Info,
// text preview, file commands, undo/redo, and Windows keyboard shortcuts.
import {
  createDefaultFont, findGlyph, glyphToPathD, glyphBounds, syncBearings,
  cloneFont, getKern, kernKey, rectContour, ellipseContour,
} from "./model.ts";
import type { Font, Glyph, GlyphLayer } from "./model.ts";
import { fontToGlyphsJson, glyphsJsonToFont, downloadText, downloadBytes } from "./glyphs-io.ts";
import { fontToUfoZip, unzipToMap, ufoMapToFont } from "./ufo.ts";
import { fontToOtfArrayBuffer } from "./otf.ts";
import { createEditor } from "./editor.ts";
import type { Tool } from "./editor.ts";

function $<T extends Element>(sel: string): T { return document.querySelector(sel) as T; }
function qs<T extends HTMLElement>(root: ParentNode, sel: string): T { return root.querySelector(sel) as T; }

interface AppState {
  font: Font; currentGlyphName: string; openTabs: string[];
  undoStack: Font[]; redoStack: Font[]; fontViewMode: "grid" | "list";
}

const state: AppState = {
  font: createDefaultFont(),
  currentGlyphName: "A",
  openTabs: ["A"],
  undoStack: [], redoStack: [],
  fontViewMode: "grid",
};

function currentGlyph(): Glyph { return findGlyph(state.font, state.currentGlyphName) || state.font.glyphs[0]; }
function setStatus(msg: string): void { $("#statusMsg").textContent = msg; }

const editor = createEditor($<SVGSVGElement>("#editorSvg"), {
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
});

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
  if (refit) editor.setGlyph(state.font, g); else editor.refresh(state.font, g);
  renderAll();
}

function drawThumb(canvas: HTMLCanvasElement, glyph: Glyph): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width = 104, h = canvas.height = 88;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#e8ecf1";
  const d = glyphToPathD(glyph, state.font.currentMasterId);
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
  if (refitSide) renderSide();
}

function renderAll() {
  renderHeader();
  renderTabs();
  renderFontView();
  renderSide();
  renderPreview();
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
  const byChar = new Map<string, Glyph>();
  for (const g of state.font.glyphs) {
    if (g.unicode != null) byChar.set(String.fromCodePoint(g.unicode), g);
  }
  const names = [...text].map((ch) => byChar.get(ch)?.name || null);
  let cursor = 12;
  // Height grows with the proof size so caps/descenders are never clipped.
  const proofH = Math.round(size * 1.35) + 24;
  const baseline = proofH - 20;
  svg.style.height = `${proofH}px`;
  const glyphEls: SVGPathElement[] = [];
  [...text].forEach((ch, idx) => {
    const g = byChar.get(ch);
    const nextName = names[idx + 1];
    if (!g) {
      const r = document.createElementNS(SVGNS, "rect");
      r.setAttribute("x", String(cursor)); r.setAttribute("y", String(baseline - size * 0.7));
      r.setAttribute("width", String(size * 0.45)); r.setAttribute("height", String(size * 0.7));
      r.setAttribute("fill", "none"); r.setAttribute("stroke", "#ff7a6b");
      svg.appendChild(r);
      cursor += size * 0.55;
      return;
    }
    const d = glyphToPathD(g, state.font.currentMasterId);
    if (d) {
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", d);
      p.setAttribute("transform", `translate(${cursor} ${baseline}) scale(${s} ${-s})`);
      p.setAttribute("fill", "#e8ecf1"); p.setAttribute("fill-rule", "evenodd");
      glyphEls.push(p); svg.appendChild(p);
    }
    let adv = (g.width || 0) * s;
    if (nextName) adv += (getKern(state.font, g.name, nextName) || 0) * s;
    cursor += adv;
  });
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
    <p class="hint">Handbook ref: Palette (p54) and Transformations (p56). Boolean operations, Fit Curve and extrude filters are deferred — transforms here are exact node math with undo.</p>`;
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
  qs<HTMLButtonElement>(page, "#palCopyLayer").addEventListener("click", () => {
    const name = prompt("New master name (e.g. Bold):", "Bold");
    if (!name) return;
    pushUndo();
    const id = `master${Date.now().toString(36)}`;
    state.font.masters.push({ id, name, weightValue: 700 });
    for (const glyph of state.font.glyphs) {
      const src = glyph.layers[state.font.currentMasterId] || { paths: [] };
      glyph.layers[id] = JSON.parse(JSON.stringify(src));
    }
    state.font.instances.push({ name, masterId: id, active: true });
    editor.refresh(state.font, g); renderAll();
    setStatus(`Master ${name} created from the current layers. Switch masters at the top to edit it.`);
  });
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
    <p class="hint">Kerning applies in the preview below and exports to UFO kerning.plist, .glyphs JSON and beta OTF. Handbook ref: Kerning (p120). Group kerning is stored per glyph in the Inspector; pair exceptions win here.</p>`;
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
    <p class="hint"><strong>Masters:</strong> ${f.masters.map((m) => escHtml(m.name)).join(", ") || "—"}<br/>
    <strong>Instances:</strong> ${f.instances.map((i) => escHtml(i.name)).join(", ") || "—"}</p>
    <p class="hint">Handbook ref: Font Info (p85), Masters (p88), Exports (p92). Exports use the active master. Variable-font axes and custom parameters are deferred.</p>`;
  bindChange(page.querySelector("#fiFamily"), (el) => { f.familyName = el.value; });
  bindChange(page.querySelector("#fiVersion"), (el) => { f.version = el.value; });
  bindChange(page.querySelector("#fiUpm"), (el) => { f.unitsPerEm = Math.max(16, +el.value || 1000); });
  bindChange(page.querySelector("#fiAsc"), (el) => { f.ascender = +el.value || 0; });
  bindChange(page.querySelector("#fiDesc"), (el) => { f.descender = +el.value || 0; });
  bindChange(page.querySelector("#fiCap"), (el) => { f.capHeight = +el.value || 0; });
  bindChange(page.querySelector("#fiX"), (el) => { f.xHeight = +el.value || 0; });
}

function renderSide() {
  const g = currentGlyph();
  renderInspector(g);
  renderPalette(g);
  renderKerning();
  renderFontInfo();
}

function setTool(tool: Tool): void {
  editor.setTool(tool);
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => b.classList.toggle("is-on", b.dataset.tool === tool));
  setStatus(tool === "pen" ? "Pen: click to place nodes, drag to pull handles, click the first node to close." : tool === "hand" ? "Hand: drag to pan, wheel to zoom." : tool === "text" ? "Text: type in Preview below; red boxes mean the glyph is missing." : "Select: drag white nodes and blue handles; arrows nudge.");
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
    kerningGroupLeft: "", kerningGroupRight: "", anchors: [], layers: {},
  };
  for (const m of state.font.masters) glyph.layers[m.id] = { paths: [] };
  state.font.glyphs.push(glyph);
  openGlyph(trimmed, true);
  setStatus(`Glyph ${trimmed} added — draw it with the Pen, or add Rect/Ellipse primitives.`);
}

async function handleOpenFile(file: File): Promise<void> {
  try {
    if (/\.zip$/i.test(file.name)) {
      const map = await unzipToMap(await file.arrayBuffer());
      state.font = ufoMapToFont(map, file.name);
    } else {
      state.font = glyphsJsonToFont(await file.text(), file.name);
    }
    state.undoStack = []; state.redoStack = [];
    state.currentGlyphName = state.font.glyphs[0]?.name || "";
    state.openTabs = state.currentGlyphName ? [state.currentGlyphName] : [];
    ensureCurrentGlyph();
    editor.setGlyph(state.font, currentGlyph());
    renderAll();
    setStatus(`Opened ${file.name} — ${state.font.glyphs.length} glyphs, master ${state.font.currentMasterId}.`);
  } catch (err) {
    setStatus(`Open failed: ${(err as Error).message}`);
  }
}

function saveGlyphs() {
  const base = (state.font.familyName || "Untitled").replace(/[^\w\- ]/g, "").trim() || "Untitled";
  downloadText(`${base}.glyphs`, fontToGlyphsJson(state.font));
  state.font.fileName = `${base}.glyphs`;
  renderHeader();
  setStatus("Saved .glyphs (JSON subset). It reopens here; full Glyphs app compatibility needs the deferred plist writer.");
}
function exportUfo() {
  const base = (state.font.familyName || "Untitled").replace(/[^\w\- ]/g, "").trim() || "Untitled";
  downloadBytes(`${base}.ufo.zip`, fontToUfoZip(state.font), "application/zip");
  setStatus("Exported UFO as .ufo.zip — unzip to get the .ufo folder for FontForge/fontTools.");
}
function exportOtf() {
  try {
    const buf = fontToOtfArrayBuffer(state.font);
    const base = (state.font.familyName || "Untitled").replace(/[^\w\- ]/g, "").trim() || "Untitled";
    downloadBytes(`${base}.otf`, new Uint8Array(buf), "font/otf");
    setStatus("Exported beta OTF from the active master. Proof it before shipping — hinting and OpenType features are deferred.");
  } catch (err) {
    setStatus(`OTF export failed: ${(err as Error).message}`);
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
    case "open": $<HTMLInputElement>("#fileInput").click(); break;
    case "save-glyphs": saveGlyphs(); break;
    case "export-ufo": exportUfo(); break;
    case "export-otf": exportOtf(); break;
    case "undo": undo(); break;
    case "redo": redo(); break;
    case "delete-sel": editor.deleteSelected(); break;
    case "close-path": editor.closeActivePath(); break;
    case "convert": editor.convertSelected(); break;
    case "zoom-in": editor.zoomBy(1.25); break;
    case "zoom-out": editor.zoomBy(1 / 1.25); break;
    case "zoom-fit": editor.zoomFit(); break;
    case "toggle-guides": setStatus(`Guides ${editor.toggleGuides() ? "on" : "off"}.`); break;
    case "toggle-nodes": setStatus(`Nodes ${editor.toggleNodes() ? "shown" : "hidden"}.`); break;
    case "add-glyph": addGlyphFlow(); break;
    case "add-rect": if (g) editor.addContour(rectContour(80, 0, 360, 500)); break;
    case "add-ellipse": if (g) editor.addContour(ellipseContour(300, 250, 220, 250)); break;
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
  if (mod && (ev.key === "+" || ev.key === "=")) { ev.preventDefault(); editor.zoomBy(1.25); return; }
  if (mod && ev.key === "-") { ev.preventDefault(); editor.zoomBy(1 / 1.25); return; }
  if (mod && ev.key === "0") { ev.preventDefault(); editor.zoomFit(); return; }
  if (ev.key === "Delete" || ev.key === "Backspace") { editor.deleteSelected(); return; }
  const step = ev.shiftKey ? 10 : 1;
  if (ev.key === "ArrowLeft") { ev.preventDefault(); editor.nudgeSelected(-step, 0); }
  if (ev.key === "ArrowRight") { ev.preventDefault(); editor.nudgeSelected(step, 0); }
  if (ev.key === "ArrowUp") { ev.preventDefault(); editor.nudgeSelected(0, step); }
  if (ev.key === "ArrowDown") { ev.preventDefault(); editor.nudgeSelected(0, -step); }
  const k = ev.key.toLowerCase();
  if (k === "v") setTool("select");
  if (k === "p") setTool("pen");
  if (k === "h") setTool("hand");
  if (k === "t") { setTool("text"); $<HTMLInputElement>("#previewText").focus(); }
});

// Boot.
editor.setGlyph(state.font, currentGlyph());
renderAll();
setTool("select");
