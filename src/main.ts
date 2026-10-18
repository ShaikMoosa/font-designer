// App wiring: Font View, Edit View tabs, Inspector/Palette/Kerning/Font Info,
// text preview, file commands, undo/redo, and Windows keyboard shortcuts.
import {
  createDefaultFont, findGlyph, glyphToPathD, glyphToPathDResolved, glyphBounds, syncBearings,
  cloneFont, kernKey, rectContour, ellipseContour,
  compositeRecipe, interpolateGlyphAt, mastersCompatible, contoursToPathD,
  deleteBackup, restoreBackup, snapshotLayer,
  GLYPH_CATEGORIES, categoryForGlyph, scriptForGlyph, thumbCanvasSize, fontViewCountText, fontViewSelectionText,
  renameGlyph, moveGlyphInOrder, applyGlyphInfo, glyphMatchesFilter, sortGlyphsForDisplay, GLYPH_FILTERS, parseTags,
  updateGlyphSelection, glyphHasOutline,
  editNavigatorGlyphs, resolveKern,
  compatibilityReport, copyLayerBetweenMasters, instanceT, instanceAxisWeight, cloneContours,
  sortedMasters, axisRange, weightForT, axisStopsForGlyph, issuesForGlyph, adjacentMaster, instanceProgression, layerSummaries,
} from "./model.ts";
import type { EditNavigatorScope, GlyphFilter, GlyphSortMode } from "./model.ts";
import { glyphInfoFor, glyphSuggestionFor, productionNameFor, COLOR_LABELS } from "./glyphinfo.ts";
import type { AlignMode, Font, Glyph, GlyphLayer } from "./model.ts";
import { fontToGlyphsJson, glyphsJsonToFont, fontToOpenStep, downloadText, downloadBytes } from "./glyphs-io.ts";
import { fontToUfoZip, fontToDesignspaceBundle, unzipToMap, ufoMapToFont } from "./ufo.ts";
import { fontToOtfArrayBuffer } from "./otf.ts";
import { fontToTtfBytes } from "./ttf.ts";
import { fontToWoffBytes } from "./woff.ts";
import { validateFont } from "./validate.ts";
import { effectiveFeatures, generateFeatures, parseFeatureCode, shapeText } from "./shaping.ts";
import { proofExportBytes, proofGate } from "./proofing.ts";
import { addExtremes, findDuplicateNodes, fitCurveContours, fixContourDirections, offsetContours, removeDuplicateNodes, resegmentContours, roundCorners, unionContours, differenceContours } from "./pathsurgery.ts";
import { base64ToBytes, desktopOpenFile, desktopSaveBytes, desktopSaveText, fileKindForName, isDesktop, onDesktopMenuCommand } from "./desktop.ts";

import { SETTINGS_KEY, addCustomSample, allSamples, normalizeSettings, parseSettings, removeCustomSample, serializeSettings } from "./settings.ts";
import type { AppSettings } from "./settings.ts";

let appSettings: AppSettings = parseSettings(null);
function compileService(): string { return appSettings.compileServiceUrl; }
function persistSettings(): void {
  try { localStorage.setItem(SETTINGS_KEY, serializeSettings(appSettings)); } catch { /* Settings stay usable without storage. */ }
}
import { createEditor } from "./editor.ts";
import type { Editor, EditorHooks, GhostLayer, MeasureInfo, Tool } from "./editor.ts";

function $<T extends Element>(sel: string): T { return document.querySelector(sel) as T; }
function qs<T extends HTMLElement>(root: ParentNode, sel: string): T { return root.querySelector(sel) as T; }

interface AppState {
  font: Font; currentGlyphName: string; openTabs: string[];
  undoStack: Font[]; redoStack: Font[]; fontViewMode: "grid" | "list";
  splitView: boolean; paneBMasterId: string;
  workspace: "edit" | "font";
  fontCategory: string; fontLanguage: string; cellSize: number;
  glyphFilter: GlyphFilter; glyphSort: GlyphSortMode;
  selectedGlyphNames: Set<string>; selectionAnchorName: string; focusedGlyphName: string;
  fontViewScroll: Record<"grid" | "list", number>;
  activeSavedFilterId: string;
  editNavScope: EditNavigatorScope;
  editMode: "edit" | "text";
  compareMode: CompareMode;
  ghostOpacity: number;
  axisT: number;
  proofInterpolated: boolean;
}

type CompareMode = "off" | "overlay" | "split";

interface SavedFontFilter {
  id: string;
  name: string;
  query: string;
  category: string;
  language: string;
  filter: GlyphFilter;
  sort: GlyphSortMode;
}

interface FontViewPrefs {
  mode: "grid" | "list";
  cellSize: number;
  filter: GlyphFilter;
  sort: GlyphSortMode;
  listColumns: Record<string, number>;
  savedFilters: SavedFontFilter[];
}

interface WorkspacePrefs {
  leftPanel: number;
  rightPanel: number;
  previewHeight: number;
  previewWidth: number;
  previewDock: "bottom" | "right";
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  previewCollapsed: boolean;
  editNavScope: EditNavigatorScope;
}

type TransformOrigin = "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";

interface PalettePrefs {
  openSections: string[];
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
  skew: number;
  scaleLocked: boolean;
  origin: TransformOrigin;
}

const WORKSPACE_PREFS_KEY = "glyphs-windows.workspace.v1";
const FONT_VIEW_PREFS_KEY = "glyphs-windows.font-view.v2";
const PALETTE_PREFS_KEY = "glyphs-windows.palette.v1";
const LIST_COLUMN_DEFAULTS: Record<string, number> = {
  id: 38, export: 48, name: 132, unicode: 78, script: 82,
  category: 90, status: 94, width: 62, lsb: 56, rsb: 56,
};
const DEFAULT_WORKSPACE_PREFS: WorkspacePrefs = {
  leftPanel: 220,
  rightPanel: 286,
  previewHeight: 115,
  previewWidth: 300,
  previewDock: "bottom",
  leftCollapsed: false,
  rightCollapsed: false,
  previewCollapsed: false,
  editNavScope: "all",
};
const DEFAULT_PALETTE_PREFS: PalettePrefs = {
  openSections: ["dimensions", "transformations", "layers"],
  dx: 0, dy: 0, scaleX: 100, scaleY: 100, rotate: 0, skew: 0,
  scaleLocked: true,
  origin: "center",
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback;
}

function loadWorkspacePrefs(): WorkspacePrefs {
  try {
    const stored = JSON.parse(localStorage.getItem(WORKSPACE_PREFS_KEY) || "{}") as Partial<WorkspacePrefs>;
    return {
      leftPanel: clampNumber(stored.leftPanel, DEFAULT_WORKSPACE_PREFS.leftPanel, 176, 340),
      rightPanel: clampNumber(stored.rightPanel, DEFAULT_WORKSPACE_PREFS.rightPanel, 236, 380),
      previewHeight: clampNumber(stored.previewHeight, DEFAULT_WORKSPACE_PREFS.previewHeight, 82, 360),
      previewWidth: clampNumber(stored.previewWidth, DEFAULT_WORKSPACE_PREFS.previewWidth, 230, 520),
      previewDock: stored.previewDock === "right" ? "right" : "bottom",
      leftCollapsed: stored.leftCollapsed === true,
      rightCollapsed: stored.rightCollapsed === true,
      previewCollapsed: stored.previewCollapsed === true,
      editNavScope: stored.editNavScope === "related" || stored.editNavScope === "open" ? stored.editNavScope : "all",
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_PREFS };
  }
}

function loadFontViewPrefs(): FontViewPrefs {
  try {
    const stored = JSON.parse(localStorage.getItem(FONT_VIEW_PREFS_KEY) || "{}") as Partial<FontViewPrefs>;
    const filterIds = new Set(GLYPH_FILTERS.map((item) => item.id));
    const columns = { ...LIST_COLUMN_DEFAULTS };
    for (const key of Object.keys(columns)) {
      columns[key] = clampNumber(stored.listColumns?.[key], columns[key], key === "name" ? 92 : 42, key === "name" ? 300 : 180);
    }
    const savedFilters = Array.isArray(stored.savedFilters)
      ? stored.savedFilters.filter((item): item is SavedFontFilter => Boolean(item && typeof item.id === "string" && typeof item.name === "string" && filterIds.has(item.filter)))
      : [];
    return {
      mode: stored.mode === "list" ? "list" : "grid",
      cellSize: clampNumber(stored.cellSize, 112, 56, 160),
      filter: filterIds.has(stored.filter as GlyphFilter) ? stored.filter as GlyphFilter : "all",
      sort: stored.sort === "name" || stored.sort === "unicode" ? stored.sort : "order",
      listColumns: columns,
      savedFilters,
    };
  } catch {
    return { mode: "grid", cellSize: 112, filter: "all", sort: "order", listColumns: { ...LIST_COLUMN_DEFAULTS }, savedFilters: [] };
  }
}

function loadPalettePrefs(): PalettePrefs {
  try {
    const stored = JSON.parse(localStorage.getItem(PALETTE_PREFS_KEY) || "{}") as Partial<PalettePrefs>;
    const validOrigins = new Set<TransformOrigin>(["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"]);
    const value = (candidate: unknown, fallback: number, min: number, max: number): number => {
      const number = Number(candidate);
      return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    };
    return {
      openSections: Array.isArray(stored.openSections) ? stored.openSections.filter((item): item is string => typeof item === "string") : [...DEFAULT_PALETTE_PREFS.openSections],
      dx: value(stored.dx, 0, -10000, 10000),
      dy: value(stored.dy, 0, -10000, 10000),
      scaleX: value(stored.scaleX, 100, -1000, 1000),
      scaleY: value(stored.scaleY, 100, -1000, 1000),
      rotate: value(stored.rotate, 0, -360, 360),
      skew: value(stored.skew, 0, -89, 89),
      scaleLocked: stored.scaleLocked !== false,
      origin: validOrigins.has(stored.origin as TransformOrigin) ? stored.origin as TransformOrigin : "center",
    };
  } catch {
    return { ...DEFAULT_PALETTE_PREFS, openSections: [...DEFAULT_PALETTE_PREFS.openSections] };
  }
}

const workspacePrefs = loadWorkspacePrefs();
const fontViewPrefs = loadFontViewPrefs();
const palettePrefs = loadPalettePrefs();
const paletteHiddenMasters = new Set<string>();

const state: AppState = {
  font: createDefaultFont(),
  currentGlyphName: "A",
  openTabs: ["A"],
  undoStack: [], redoStack: [],
  fontViewMode: fontViewPrefs.mode,
  splitView: false, paneBMasterId: "",
  workspace: "edit",
  fontCategory: "All", fontLanguage: "All", cellSize: fontViewPrefs.cellSize,
  glyphFilter: fontViewPrefs.filter, glyphSort: fontViewPrefs.sort,
  selectedGlyphNames: new Set(["A"]), selectionAnchorName: "A", focusedGlyphName: "A",
  fontViewScroll: { grid: 0, list: 0 },
  activeSavedFilterId: "",
  editNavScope: workspacePrefs.editNavScope,
  editMode: "edit",
  compareMode: "off",
  ghostOpacity: 0.55,
  axisT: 0.5,
  proofInterpolated: false,
};

const MASTERS_PREFS_KEY = "glyphs-windows.masters.v1";
function loadMastersPrefs(): { compareMode: CompareMode; ghostOpacity: number } {
  try {
    const raw = localStorage.getItem(MASTERS_PREFS_KEY);
    if (!raw) return { compareMode: "off", ghostOpacity: 0.55 };
    const stored = JSON.parse(raw) as { compareMode?: string; ghostOpacity?: number };
    const mode: CompareMode = stored.compareMode === "overlay" || stored.compareMode === "split" ? stored.compareMode : "off";
    const opacity = typeof stored.ghostOpacity === "number" ? Math.max(0.1, Math.min(1, stored.ghostOpacity)) : 0.55;
    return { compareMode: mode, ghostOpacity: opacity };
  } catch {
    return { compareMode: "off", ghostOpacity: 0.55 };
  }
}
function persistMastersPrefs(): void {
  try {
    localStorage.setItem(MASTERS_PREFS_KEY, JSON.stringify({ compareMode: state.compareMode, ghostOpacity: state.ghostOpacity }));
  } catch {
    // Masters bar remains usable without persistence.
  }
}
{
  const mastersPrefs = loadMastersPrefs();
  state.compareMode = mastersPrefs.compareMode;
  state.ghostOpacity = mastersPrefs.ghostOpacity;
  if (state.compareMode === "split") state.splitView = true;
}

function persistFontViewPrefs(): void {
  try {
    localStorage.setItem(FONT_VIEW_PREFS_KEY, JSON.stringify({
      mode: state.fontViewMode,
      cellSize: state.cellSize,
      filter: state.glyphFilter,
      sort: state.glyphSort,
      listColumns: fontViewPrefs.listColumns,
      savedFilters: fontViewPrefs.savedFilters,
    } satisfies FontViewPrefs));
  } catch {
    // Font View remains fully usable when persistence is unavailable.
  }
}

function persistPalettePrefs(): void {
  try {
    localStorage.setItem(PALETTE_PREFS_KEY, JSON.stringify(palettePrefs));
  } catch {
    // The Palette remains usable when persistence is unavailable.
  }
}

function normalizeFontViewSelection(): void {
  const validNames = new Set(state.font.glyphs.map((glyph) => glyph.name));
  state.selectedGlyphNames = new Set([...state.selectedGlyphNames].filter((name) => validNames.has(name)));
  if (!validNames.has(state.selectionAnchorName)) state.selectionAnchorName = state.currentGlyphName;
  if (!validNames.has(state.focusedGlyphName)) state.focusedGlyphName = state.currentGlyphName;
}

function setWorkspace(mode: "edit" | "font"): void {
  state.workspace = mode;
  $("#app").classList.toggle("workspace-font", mode === "font");
  $("#wsFontBtn").classList.toggle("is-on", mode === "font");
  $("#wsEditBtn").classList.toggle("is-on", mode === "edit");
  $<HTMLButtonElement>("#toggleLeftBtn").disabled = mode === "font";
  updateChromeToggleLabels();
  renderTabs();
  if (mode === "font") renderFontView();
  else requestAnimationFrame(() => activeEd.refresh(state.font, currentGlyph()));
}

function currentGlyph(): Glyph { return findGlyph(state.font, state.currentGlyphName) || state.font.glyphs[0]; }
function setStatus(msg: string): void { $("#statusMsg").textContent = msg; }

function showMeasure(info: MeasureInfo | null): void {
  const message = info
    ? `Measure: ${info.distance} units · dx ${info.dx} · dy ${info.dy} · ${info.angleDeg}°`
    : "";
  $("#measureReadout").textContent = message;
  if (message) setStatus(message);
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
  onRender() { /* supplied per editor so the active canvas owns the zoom readout */ },
  onMeasure(info) { showMeasure(info); },
};

let activeEd: Editor;
let lastEditTool: Exclude<Tool, "text"> = "select";
function activateEditor(next: Editor, surface: SVGSVGElement): void {
  activeEd = next;
  document.querySelectorAll<SVGSVGElement>("#panes > svg").forEach((svg) => svg.classList.toggle("is-active-pane", svg === surface));
  updateSelectionReadout();
}

function updateSelectionReadout(): void {
  const count = activeEd?.getSelectionCount?.() || 0;
  $("#infoSelection").textContent = count ? `${count} node${count === 1 ? "" : "s"} selected` : "No nodes selected";
  const paletteSelection = document.querySelector<HTMLElement>("#paletteSelectionContext");
  if (paletteSelection) {
    const layer = layerOf(currentGlyph());
    const nodes = layer.paths.reduce((total, contour) => total + contour.nodes.length, 0);
    paletteSelection.textContent = count ? `${count} selected` : `${layer.paths.length} paths · ${nodes} nodes`;
  }
  document.querySelectorAll<HTMLButtonElement>("[data-pal-align]").forEach((button) => { button.disabled = count < 2; });
  const master = state.font.masters.find((item) => item.id === state.font.currentMasterId);
  const context = document.querySelector<HTMLElement>("#sideContext");
  if (context) context.textContent = count ? `${count} nodes · ${currentGlyph().name}` : `${editorToolLabel(lastEditTool)} · ${master?.name || "Layer"}`;
}

const editor = createEditor($<SVGSVGElement>("#editorSvg"), {
  ...editorHooks,
  onActivate() { activateEditor(editor, $<SVGSVGElement>("#editorSvg")); },
  onRender(info) { if (!activeEd || activeEd === editor) { updateZoomReadout(info.scale); updateSelectionReadout(); } },
});
const editorB = createEditor($<SVGSVGElement>("#editorSvgB"), {
  ...editorHooks,
  onActivate() { activateEditor(editorB, $<SVGSVGElement>("#editorSvgB")); },
  onRender(info) { if (activeEd === editorB) { updateZoomReadout(info.scale); updateSelectionReadout(); } },
});
activeEd = editor;

let viewportResizeFrame = 0;
const viewportResizeObserver = new ResizeObserver(() => {
  cancelAnimationFrame(viewportResizeFrame);
  viewportResizeFrame = requestAnimationFrame(() => {
    editor.resizeViewport();
    if (state.splitView) editorB.resizeViewport();
  });
});
viewportResizeObserver.observe($<HTMLElement>("#canvasWrap"));

function updateZoomReadout(scale: number): void {
  $("#zoomReadout").textContent = `${Math.round(scale * 100)}%`;
}

function updateCanvasHud(): void {
  const glyphIndex = state.font.glyphs.findIndex((glyph) => glyph.name === state.currentGlyphName);
  $("#canvasGlyphLabel").textContent = state.currentGlyphName || "—";
  $<HTMLButtonElement>("#previousGlyphBtn").disabled = glyphIndex <= 0;
  $<HTMLButtonElement>("#nextGlyphBtn").disabled = glyphIndex < 0 || glyphIndex >= state.font.glyphs.length - 1;
}

function updateSpacingContext(): void {
  const names = shapeText(state.font, $<HTMLInputElement>("#previewText").value || "")
    .map((item) => item.name)
    .filter((name): name is string => Boolean(name));
  const index = names.indexOf(state.currentGlyphName);
  const left = index > 0 ? names[index - 1] : "";
  const right = index >= 0 && index < names.length - 1 ? names[index + 1] : "";
  $("#infoLeftKern").textContent = left ? `${left}/${state.currentGlyphName} ${resolveKern(state.font, left, state.currentGlyphName)}` : "—";
  $("#infoRightKern").textContent = right ? `${state.currentGlyphName}/${right} ${resolveKern(state.font, state.currentGlyphName, right)}` : "—";
  $("#infoKernContext").classList.toggle("is-empty", !left && !right);
}

function navigateGlyph(delta: -1 | 1): void {
  const glyphIndex = state.font.glyphs.findIndex((glyph) => glyph.name === state.currentGlyphName);
  const next = state.font.glyphs[glyphIndex + delta];
  if (!next) return;
  openGlyph(next.name, true);
  setStatus(`${delta < 0 ? "Previous" : "Next"} glyph: ${next.name}.`);
}

function refreshPaneB(refit = false): void {
  if (!state.splitView) return;
  if (refit) editorB.setGlyph(state.font, currentGlyph());
  else editorB.refresh(state.font, currentGlyph());
}

function interpolatedPathD(glyph: Glyph, t: number): string {
  const ig = interpolateGlyphAt(state.font, glyph.name, t);
  if (!ig) return "";
  return contoursToPathD(ig.layers[state.font.currentMasterId]?.paths ?? []);
}

/** Ghost outlines for the current compare mode; hidden masters never ghost. */
function comparisonGhosts(): GhostLayer[] {
  const glyph = currentGlyph();
  if (!glyph || state.font.masters.length < 2) return [];
  const ghosts: GhostLayer[] = [];
  if (state.compareMode === "overlay") {
    for (const master of sortedMasters(state.font)) {
      if (master.id === state.font.currentMasterId || paletteHiddenMasters.has(master.id)) continue;
      const d = glyphToPathDResolved(state.font, glyph, master.id);
      if (d) ghosts.push({ d, kind: "master" });
    }
  }
  const interpD = interpolatedPathD(glyph, state.axisT);
  if (interpD) ghosts.push({ d: interpD, kind: "interp" });
  return ghosts;
}

function updateComparisonGhosts(): void {
  const ghosts = comparisonGhosts();
  editor.setGhostLayers(ghosts, state.ghostOpacity);
  editorB.setGhostLayers(state.compareMode === "split" ? ghosts.filter((g) => g.kind === "interp") : [], state.ghostOpacity);
}

function setCompareMode(mode: CompareMode, announce = true): void {
  state.compareMode = mode;
  state.splitView = mode === "split";
  persistMastersPrefs();
  renderHeader();
  if (state.splitView) {
    editorB.setMasterOverride(state.paneBMasterId || null);
    editorB.setGlyph(state.font, currentGlyph());
  } else {
    activeEd = editor;
  }
  updateComparisonGhosts();
  renderMastersBar();
  if (announce) {
    setStatus(mode === "overlay" ? "Overlay compare: other masters ghost over the active outline. Drag the axis to proof interpolation."
      : mode === "split" ? "Split compare: masters side by side. Click a pane to edit its master."
        : "Compare off. Use Overlay or Split to inspect masters without leaving Edit View.");
  }
}

function syncAxisControls(): void {
  const weightEl = document.querySelector<HTMLOutputElement>("#mbWeight");
  if (weightEl) {
    const glyph = currentGlyph();
    const ok = glyph ? interpolateGlyphAt(state.font, glyph.name, state.axisT) !== null : false;
    weightEl.textContent = `${weightForT(state.font, state.axisT)} · t=${state.axisT.toFixed(2)}${state.font.masters.length >= 2 && !ok ? " · incompatible" : ""}`;
  }
  const cursor = document.querySelector<HTMLElement>("#mastersBar .axis-cursor");
  if (cursor) cursor.style.left = `${state.axisT * 100}%`;
  const slider = document.querySelector<HTMLInputElement>("#mbAxis");
  if (slider && document.activeElement !== slider) slider.value = String(Math.round(state.axisT * 1000));
  document.querySelectorAll<HTMLButtonElement>("#mastersBar [data-mb-step]").forEach((cell) => {
    const current = Math.abs((Number(cell.dataset.mbStep) || 0) - state.axisT) < 0.13;
    cell.classList.toggle("is-current", current);
    cell.setAttribute("aria-pressed", String(current));
  });
  const glyphForProof = currentGlyph();
  document.querySelectorAll<HTMLButtonElement>("#mastersBar [data-mb-step]").forEach((cell) => {
    const path = cell.querySelector("path");
    if (path && glyphForProof) path.setAttribute("d", interpolatedPathD(glyphForProof, Number(cell.dataset.mbStep) || 0));
  });
  const palSlider = document.querySelector<HTMLInputElement>("#palInterp");
  if (palSlider && document.activeElement !== palSlider) palSlider.value = String(Math.round(state.axisT * 100));
}

function setAxisT(t: number, announce = false): void {
  state.axisT = Math.max(0, Math.min(1, t));
  updateComparisonGhosts();
  syncAxisControls();
  if (state.proofInterpolated) renderPreview();
  if (announce) setStatus(`Axis proof at weight ${weightForT(state.font, state.axisT)} (t=${state.axisT.toFixed(2)}).`);
}

function navigateMaster(delta: -1 | 1): void {
  const next = adjacentMaster(state.font, state.font.currentMasterId, delta);
  if (!next) { setStatus(delta < 0 ? "Already on the lightest master." : "Already on the heaviest master."); return; }
  state.font.currentMasterId = next.id;
  editor.refresh(state.font, currentGlyph());
  renderAll();
  setStatus(`Active master: ${next.name} (${next.weightValue}).`);
}

function renderMastersBar(): void {
  const bar = $<HTMLElement>("#mastersBar");
  const glyph = currentGlyph();
  const masters = sortedMasters(state.font);
  const range = axisRange(state.font);
  const weight = weightForT(state.font, state.axisT);
  const issues = glyph ? issuesForGlyph(state.font, glyph.name) : [];
  const allIssues = state.font.masters.length >= 2 ? compatibilityReport(state.font) : [];
  if (masters.length < 2) {
    bar.innerHTML = `<div class="masters-bar-inner is-single">
      <span class="masters-bar-label">Masters</span>
      <span class="masters-chip is-active">${escHtml(masters[0]?.name || "Regular")} · ${masters[0]?.weightValue ?? ""}</span>
      <span class="hint">Add a second master to compare, interpolate, and proof instances.</span>
      <button id="mbAddMaster" type="button">+ Master from current</button>
    </div>`;
    qs<HTMLButtonElement>(bar, "#mbAddMaster").addEventListener("click", addMasterCopy);
    return;
  }
  const summaries = glyph ? layerSummaries(state.font, glyph) : [];
  const stops = glyph ? axisStopsForGlyph(state.font, glyph) : [];
  const span = Math.max(1, range.max - range.min);
  const chips = summaries.map((s) => {
    const active = s.masterId === state.font.currentMasterId;
    const hidden = paletteHiddenMasters.has(s.masterId);
    const missing = !s.hasLayer;
    return `<span class="masters-chip${active ? " is-active" : ""}${hidden ? " is-hidden" : ""}${missing ? " is-missing" : ""}">
      <button class="masters-chip-main" data-mb-master="${escHtml(s.masterId)}" type="button" aria-pressed="${active}" title="Make ${escHtml(s.masterName)} active">${escHtml(s.masterName)} ${s.weight}</button>
      <button class="masters-chip-eye icon-btn" data-mb-eye="${escHtml(s.masterId)}" type="button" aria-pressed="${!hidden}" aria-label="${hidden ? "Show" : "Hide"} ${escHtml(s.masterName)} overlay" title="${hidden ? "Show overlay" : "Hide overlay"}">${hidden ? "○" : "●"}</button>
      <small>${missing ? "Missing" : `${s.contours}c · ${s.nodes}n`}</small>
    </span>`;
  }).join("");
  const stopMarks = stops.map((stop) => {
    const left = Math.max(0, Math.min(100, ((stop.weight - range.min) / span) * 100));
    return `<span class="axis-stop is-${stop.kind}${stop.masterId === state.font.currentMasterId ? " is-active" : ""}" style="left:${left}%" title="${escHtml(stop.label)} · ${stop.weight}"><i aria-hidden="true"></i><small>${stop.weight}</small></span>`;
  }).join("");
  const progression = instanceProgression(state.font, 5).map((step) => {
    const d = glyph ? interpolatedPathD(glyph, step.t) : "";
    const current = Math.abs(step.t - state.axisT) < 0.13;
    return `<button class="progression-cell${current ? " is-current" : ""}" data-mb-step="${step.t}" type="button" aria-pressed="${current}" title="Proof at weight ${step.weight}">
      <svg viewBox="-80 -720 760 1020" aria-hidden="true"><path d="${escHtml(d)}" transform="scale(1 -1)" fill-rule="evenodd"></path></svg>
      <small>${step.weight}</small>
    </button>`;
  }).join("");
  const interpOk = glyph ? interpolateGlyphAt(state.font, glyph.name, state.axisT) !== null : false;
  bar.innerHTML = `<div class="masters-bar-inner">
    <div class="masters-bar-row">
      <span class="masters-bar-label">Masters</span>
      <div class="masters-chips" role="group" aria-label="Master and layer browser">${chips}</div>
      <div class="hud-group" role="group" aria-label="Master navigation">
        <button id="mbPrevMaster" class="hud-button" type="button" title="Previous master ([)" aria-label="Previous master">‹</button>
        <button id="mbNextMaster" class="hud-button" type="button" title="Next master (])" aria-label="Next master">›</button>
      </div>
      <div class="seg masters-compare" role="group" aria-label="Comparison mode">
        <button data-mb-compare="off" class="${state.compareMode === "off" ? "is-on" : ""}" type="button" aria-pressed="${state.compareMode === "off"}">Off</button>
        <button data-mb-compare="overlay" class="${state.compareMode === "overlay" ? "is-on" : ""}" type="button" aria-pressed="${state.compareMode === "overlay"}">Overlay</button>
        <button data-mb-compare="split" class="${state.compareMode === "split" ? "is-on" : ""}" type="button" aria-pressed="${state.compareMode === "split"}">Split</button>
      </div>
      <label class="masters-ghost">Ghost <input id="mbGhost" type="range" min="10" max="100" value="${Math.round(state.ghostOpacity * 100)}" aria-label="Ghost opacity" /></label>
      <span class="masters-compat${issues.length ? " is-bad" : ""}" role="status">${issues.length ? `${issues.length} issue(s) on ${escHtml(glyph?.name || "")}` : allIssues.length ? `${allIssues.length} font issue(s)` : "Compatible"}</span>
    </div>
    <div class="masters-bar-row masters-axis-row">
      <span class="masters-bar-label">Axis ${escHtml(state.font.axes[0]?.tag || "wght")}</span>
      <div class="axis-track" aria-hidden="true"><div class="axis-line"></div>${stopMarks}<span class="axis-cursor" style="left:${state.axisT * 100}%"><i></i></span></div>
      <input id="mbAxis" type="range" min="0" max="1000" value="${Math.round(state.axisT * 1000)}" aria-label="Interpolation axis position" />
      <output id="mbWeight" aria-live="polite">${weight} · t=${state.axisT.toFixed(2)}${interpOk ? "" : " · incompatible"}</output>
      <label class="masters-proof"><input id="mbProof" type="checkbox" ${state.proofInterpolated ? "checked" : ""} /> Proof text interpolated</label>
    </div>
    <div class="masters-bar-row masters-progression-row">
      <span class="masters-bar-label">Instances</span>
      <div class="progression-strip" role="group" aria-label="Instance progression preview">${progression}</div>
      <button id="mbExportProof" type="button" ${interpOk ? "" : "disabled"}>Export proof as UFO</button>
      ${issues.length ? `<button id="mbFixGlyph" type="button">Fix ${escHtml(glyph?.name || "")}: copy base layer</button>` : ""}
      <button id="mbFontInfo" type="button">Compatibility in Font Info</button>
    </div>
  </div>`;
  bar.querySelectorAll<HTMLButtonElement>("[data-mb-master]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.mbMaster;
    if (!id || id === state.font.currentMasterId) return;
    state.font.currentMasterId = id;
    editor.refresh(state.font, currentGlyph());
    renderAll();
  }));
  bar.querySelectorAll<HTMLButtonElement>("[data-mb-eye]").forEach((button) => button.addEventListener("click", () => {
    const id = button.dataset.mbEye;
    if (!id) return;
    if (paletteHiddenMasters.has(id)) paletteHiddenMasters.delete(id); else paletteHiddenMasters.add(id);
    updateComparisonGhosts();
    renderMastersBar();
    renderPalette(currentGlyph());
  }));
  bar.querySelectorAll<HTMLButtonElement>("[data-mb-compare]").forEach((button) => button.addEventListener("click", () => {
    setCompareMode((button.dataset.mbCompare || "off") as CompareMode);
  }));
  qs<HTMLInputElement>(bar, "#mbGhost").addEventListener("input", (event) => {
    state.ghostOpacity = (+(event.target as HTMLInputElement).value || 55) / 100;
    persistMastersPrefs();
    updateComparisonGhosts();
  });
  qs<HTMLInputElement>(bar, "#mbAxis").addEventListener("input", (event) => {
    setAxisT((+(event.target as HTMLInputElement).value || 0) / 1000);
  });
  qs<HTMLInputElement>(bar, "#mbProof").addEventListener("change", (event) => {
    state.proofInterpolated = (event.target as HTMLInputElement).checked;
    updateComparisonGhosts();
    renderPreview();
    setStatus(state.proofInterpolated ? "Preview text now proofs the interpolated instance at the axis position." : "Preview text shows the active master again.");
  });
  qs<HTMLButtonElement>(bar, "#mbPrevMaster").addEventListener("click", () => navigateMaster(-1));
  qs<HTMLButtonElement>(bar, "#mbNextMaster").addEventListener("click", () => navigateMaster(1));
  bar.querySelectorAll<HTMLButtonElement>("[data-mb-step]").forEach((button) => button.addEventListener("click", () => {
    setAxisT(Number(button.dataset.mbStep) || 0, true);
  }));
  qs<HTMLButtonElement>(bar, "#mbExportProof").addEventListener("click", () => { void exportInstanceUfo(state.axisT, `Proof-${weight}`); });
  const fixButton = bar.querySelector<HTMLButtonElement>("#mbFixGlyph");
  fixButton?.addEventListener("click", () => {
    if (!glyph) return;
    const base = sortedMasters(state.font)[0];
    const target = issues.find((issue) => !issue.masterId.startsWith("inter@"));
    if (!base || !target) { setStatus("This issue is an intermediate-layer mismatch — recapture the stop from a compatible outline."); return; }
    pushUndo();
    if (copyLayerBetweenMasters(state.font, glyph.name, base.id, target.masterId)) {
      editor.refresh(state.font, glyph);
      renderAll();
      setStatus(`Copied the ${base.name} layer of ${glyph.name} over ${target.masterName} — redraw that master.`);
    } else {
      state.undoStack.pop();
      setStatus("Could not apply the fix (source layer missing).");
    }
  });
  qs<HTMLButtonElement>(bar, "#mbFontInfo").addEventListener("click", () => openWorkflow("fontinfo"));
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
  normalizeFontViewSelection();
}

function openGlyph(name: string, refit = true): void {
  const g = findGlyph(state.font, name);
  if (!g) return;
  state.currentGlyphName = name;
  state.selectedGlyphNames = new Set([name]);
  state.selectionAnchorName = name;
  state.focusedGlyphName = name;
  if (!state.openTabs.includes(name)) state.openTabs.push(name);
  if (refit) { editor.setGlyph(state.font, g); refreshPaneB(true); } else editor.refresh(state.font, g);
  renderAll();
}

function drawThumb(canvas: HTMLCanvasElement, glyph: Glyph): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const thumb = thumbCanvasSize(state.cellSize, window.devicePixelRatio || 1);
  const w = canvas.width = thumb.width, h = canvas.height = thumb.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#26262c"; // Light theme: dark glyph previews.
  const d = glyphToPathDResolved(state.font, glyph, state.font.currentMasterId);
  if (!d) {
    ctx.font = "11px Segoe UI"; ctx.fillStyle = "#8a8a94"; ctx.textAlign = "center";
    ctx.fillText(glyph.name === "space" ? "space" : "empty", w / 2, h / 2);
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

const pendingThumbnails = new WeakMap<HTMLCanvasElement, Glyph>();
const thumbnailObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const canvas = entry.target as HTMLCanvasElement;
    const glyph = pendingThumbnails.get(canvas);
    if (glyph) drawThumb(canvas, glyph);
    thumbnailObserver?.unobserve(canvas);
  }
}, { root: $<HTMLElement>("#glyphGrid"), rootMargin: "180px" });

function queueThumbnail(canvas: HTMLCanvasElement, glyph: Glyph): void {
  pendingThumbnails.set(canvas, glyph);
  if (thumbnailObserver) thumbnailObserver.observe(canvas); else drawThumb(canvas, glyph);
}

function renderNavList(el: HTMLElement, label: string, items: Array<{ name: string; count: number }>, active: string, onPick: (name: string) => void): void {
  el.innerHTML = "";
  const all = document.createElement("button");
  all.type = "button";
  all.className = `fv-nav-item fv-nav-all${active === "All" ? " is-on" : ""}`;
  all.textContent = label;
  all.addEventListener("click", () => onPick("All"));
  el.appendChild(all);
  for (const item of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `fv-nav-item${active === item.name ? " is-on" : ""}`;
    b.innerHTML = `<span class="fv-nav-chev" aria-hidden="true">›</span><span class="fv-nav-letter" aria-hidden="true">${escHtml(item.name.charAt(0))}</span><span class="fv-nav-name">${escHtml(item.name)}</span><span class="fv-nav-count">${item.count}</span>`;
    b.addEventListener("click", () => onPick(item.name));
    el.appendChild(b);
  }
}

function renderGlyphDetails(): void {
  const page = $("#glyphDetails");
  const selected = state.font.glyphs.filter((glyph) => state.selectedGlyphNames.has(glyph.name));
  if (!selected.length) {
    page.innerHTML = '<p class="hint">No glyphs selected. Click a glyph, Ctrl-click to toggle, or Shift-click to select a range.</p>';
    return;
  }
  if (selected.length > 1) {
    const widths = selected.map((glyph) => glyph.width);
    const outlined = selected.filter((glyph) => glyphHasOutline(state.font, glyph)).length;
    const composites = selected.filter((glyph) => (glyph.components || []).length > 0).length;
    const unicode = selected.filter((glyph) => glyph.unicode != null).length;
    const categories = [...new Set(selected.map(categoryForGlyph))];
    page.innerHTML = `
      <div class="fv-detail-glyph fv-detail-count" aria-hidden="true">${selected.length}</div>
      <div class="fv-detail-name">Selected glyphs</div>
      <div class="fv-detail-summary">
        <span>Unicode</span><strong>${unicode}/${selected.length}</strong>
        <span>Outlines</span><strong>${outlined}/${selected.length}</strong>
        <span>Components</span><strong>${composites}/${selected.length}</strong>
        <span>Width range</span><strong>${Math.min(...widths)}–${Math.max(...widths)}</strong>
        <span>Categories</span><strong>${escHtml(categories.join(", "))}</strong>
      </div>
      <p class="hint">Batch actions apply to this selection even when a search or filter hides part of it.</p>`;
    return;
  }
  const g = selected[0];
  const uni = g.unicode != null ? `U+${g.unicode.toString(16).toUpperCase().padStart(4, "0")}` : "—";
  const layerInfo = state.font.masters.map((m) => {
    const layer = g.layers[m.id];
    const nodes = layer ? layer.paths.reduce((n, c) => n + c.nodes.length, 0) : 0;
    return `${m.name}: ${layer ? layer.paths.length : 0} contour(s), ${nodes} node(s)`;
  }).join("<br/>");
  const glyphChar = g.name === "space" ? "space"
    : (g.unicode != null && g.unicode >= 0x21 && g.unicode <= 0x10ffff ? String.fromCodePoint(g.unicode) : g.name.charAt(0));
  page.innerHTML = `
    <div class="fv-detail-glyph" aria-hidden="true">${escHtml(glyphChar)}</div>
    <div class="fv-detail-name">${escHtml(g.name)}</div>
    <div class="fv-bearings"><span>LSB ${g.lsb}</span><strong>${g.width}</strong><span>RSB ${g.rsb}</span></div>
    <div class="fv-detail-grid">
      <span>Unicode</span><strong><span class="fv-uni-chip">${uni}</span></strong>
      <span>Category</span><strong>${escHtml(categoryForGlyph(g))}</strong>
      <span>Script</span><strong>${escHtml(scriptForGlyph(g))}</strong>
      <span>Kerning groups</span><strong>L ${escHtml(g.kerningGroupLeft || "—")} · R ${escHtml(g.kerningGroupRight || "—")}</strong>
      <span>Components</span><strong>${(g.components || []).length}</strong>
      <span>Backups</span><strong>${(g.backups || []).length}</strong>
      <span>Production</span><strong>${escHtml(productionNameFor(g.name, g.unicode, g.productionName || ""))}</strong>
      <span>Case</span><strong>${escHtml(g.glyphCase || "auto")}</strong>
      <span>Color</span><strong>${g.colorLabel != null && COLOR_LABELS[g.colorLabel] ? escHtml(COLOR_LABELS[g.colorLabel].name) : "—"}</strong>
      <span>Tags</span><strong>${escHtml((g.tags || []).join(", ") || "—")}</strong>
    </div>
    <p class="hint">${layerInfo}</p>
    <p class="hint">Double-click a glyph to edit it. Production name, tags, color label, case, and note are edited in the Inspector.</p>`;
}

function glyphsForView(settings: Pick<SavedFontFilter, "query" | "category" | "language" | "filter" | "sort">): Glyph[] {
  const q = settings.query.trim().toLowerCase();
  const filtered = state.font.glyphs.filter((g) =>
    (!q || [
      g.name,
      g.unicode == null ? "" : `u+${g.unicode.toString(16).padStart(4, "0")}`,
      categoryForGlyph(g), scriptForGlyph(g), g.productionName || "", ...(g.tags || []),
    ].join(" ").toLowerCase().includes(q))
    && (settings.category === "All" || categoryForGlyph(g) === settings.category)
    && (settings.language === "All" || scriptForGlyph(g) === settings.language)
    && glyphMatchesFilter(state.font, g, settings.filter));
  return sortGlyphsForDisplay(filtered, settings.sort);
}

function currentFontViewSettings(): Pick<SavedFontFilter, "query" | "category" | "language" | "filter" | "sort"> {
  return {
    query: ($<HTMLInputElement>("#glyphSearch").value || "").trim(),
    category: state.fontCategory,
    language: state.fontLanguage,
    filter: state.glyphFilter,
    sort: state.glyphSort,
  };
}

function filteredGlyphs(): Glyph[] {
  return glyphsForView(currentFontViewSettings());
}

function visibleGlyphs(): Glyph[] {
  if (state.workspace === "font") return filteredGlyphs();
  return editNavigatorGlyphs(
    state.font,
    state.currentGlyphName,
    state.editNavScope,
    state.openTabs,
    $<HTMLInputElement>("#glyphSearch").value,
  );
}

let currentCompatBad = new Set<string>();
function compatBadGlyphs(): Set<string> { return currentCompatBad; }

function glyphViewStatus(glyph: Glyph): { state: "outline" | "component" | "empty"; label: string } {
  if ((glyph.components || []).length) return { state: "component", label: "Component" };
  if (glyphHasOutline(state.font, glyph)) return { state: "outline", label: "Outline" };
  return { state: "empty", label: "Empty" };
}

function renderSavedFilters(): void {
  const nav = $("#savedFilterNav");
  const select = $<HTMLSelectElement>("#fvSavedFilter");
  nav.innerHTML = "";
  select.innerHTML = '<option value="">Current view</option>';
  if (!fontViewPrefs.savedFilters.length) nav.innerHTML = '<p class="hint">Save the current search and taxonomy as a reusable view.</p>';
  for (const preset of fontViewPrefs.savedFilters) {
    const count = glyphsForView(preset).length;
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    select.appendChild(option);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `fv-nav-item${state.activeSavedFilterId === preset.id ? " is-on" : ""}`;
    button.innerHTML = `<span class="fv-nav-chev" aria-hidden="true">›</span><span class="fv-nav-letter" aria-hidden="true">F</span><span class="fv-nav-name">${escHtml(preset.name)}</span><span class="fv-nav-count">${count}</span>`;
    button.addEventListener("click", () => applySavedFilter(preset.id));
    nav.appendChild(button);
  }
  select.value = state.activeSavedFilterId;
  $<HTMLButtonElement>("#deleteFilterBtn").disabled = !state.activeSavedFilterId;
}

function applySavedFilter(id: string): void {
  const preset = fontViewPrefs.savedFilters.find((item) => item.id === id);
  if (!preset) return;
  state.activeSavedFilterId = preset.id;
  state.fontCategory = preset.category;
  state.fontLanguage = preset.language;
  state.glyphFilter = preset.filter;
  state.glyphSort = preset.sort;
  $<HTMLInputElement>("#glyphSearch").value = preset.query;
  $<HTMLSelectElement>("#fvFilter").value = preset.filter;
  $<HTMLSelectElement>("#fvSort").value = preset.sort;
  state.fontViewScroll[state.fontViewMode] = 0;
  renderFontView();
  setStatus(`Saved filter “${preset.name}” applied.`);
}

function bindFontViewItem(element: HTMLElement, glyph: Glyph, shown: Glyph[], index: number): void {
  element.id = `fv-glyph-${index}`;
  element.dataset.glyphName = glyph.name;
  element.setAttribute("aria-selected", String(state.selectedGlyphNames.has(glyph.name)));
  element.addEventListener("click", (event) => {
    if (state.workspace !== "font") { openGlyph(glyph.name, false); return; }
    const mouse = event as MouseEvent;
    const mode = mouse.shiftKey ? "range" : (mouse.ctrlKey || mouse.metaKey) ? "toggle" : "replace";
    commitFontViewSelection(glyph.name, shown, mode);
    $<HTMLElement>("#glyphGrid").focus({ preventScroll: true });
  });
  element.addEventListener("dblclick", () => { setWorkspace("edit"); openGlyph(glyph.name, true); });
}

function applyListColumnStyles(grid: HTMLElement): void {
  for (const [key, value] of Object.entries(fontViewPrefs.listColumns)) grid.style.setProperty(`--fv-col-${key}`, `${value}px`);
}

function setupListColumnResizers(head: HTMLElement, grid: HTMLElement): void {
  head.querySelectorAll<HTMLElement>("[data-resize-col]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const key = handle.dataset.resizeCol || "";
      if (!key || fontViewPrefs.listColumns[key] == null) return;
      const startX = event.clientX;
      const startWidth = fontViewPrefs.listColumns[key];
      handle.classList.add("is-dragging");
      handle.setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent) => {
        const min = key === "name" ? 92 : 42;
        const max = key === "name" ? 300 : 180;
        const width = Math.min(max, Math.max(min, Math.round(startWidth + moveEvent.clientX - startX)));
        fontViewPrefs.listColumns[key] = width;
        grid.style.setProperty(`--fv-col-${key}`, `${width}px`);
      };
      const finish = () => {
        handle.classList.remove("is-dragging");
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        persistFontViewPrefs();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    });
  });
}

function updateFontViewSelectionUI(shown = visibleGlyphs()): void {
  normalizeFontViewSelection();
  const selectedCount = state.selectedGlyphNames.size;
  const items = [...document.querySelectorAll<HTMLElement>("#glyphGrid [data-glyph-name]")];
  for (const item of items) {
    const name = item.dataset.glyphName || "";
    const selected = state.selectedGlyphNames.has(name);
    item.classList.toggle("is-sel", selected);
    item.classList.toggle("is-current", name === state.focusedGlyphName);
    item.setAttribute("aria-selected", String(selected));
  }
  const active = items.find((item) => item.dataset.glyphName === state.focusedGlyphName);
  const grid = $<HTMLElement>("#glyphGrid");
  if (active) grid.setAttribute("aria-activedescendant", active.id); else grid.removeAttribute("aria-activedescendant");
  const countText = state.workspace === "font"
    ? fontViewSelectionText(selectedCount, shown.length, state.font.glyphs.length)
    : `${shown.length}/${state.font.glyphs.length}`;
  $("#glyphCount").textContent = countText;
  $("#glyphCount").setAttribute("title", fontViewSelectionText(selectedCount, shown.length, state.font.glyphs.length));
  $("#fvSelectionHint").textContent = selectedCount ? `${selectedCount} selected` : "No selection";
  $<HTMLButtonElement>("#applyInfoBtn").disabled = selectedCount === 0;
  $<HTMLButtonElement>("#batchCategoryBtn").disabled = selectedCount === 0;
  $<HTMLButtonElement>("#deleteSelectedBtn").disabled = selectedCount === 0 || selectedCount >= state.font.glyphs.length;
  $<HTMLButtonElement>("#clearSelectionBtn").disabled = selectedCount === 0;
  const canMove = selectedCount === 1 && state.glyphSort === "order";
  $<HTMLButtonElement>("#moveGlyphPrevBtn").disabled = !canMove;
  $<HTMLButtonElement>("#moveGlyphNextBtn").disabled = !canMove;
  renderGlyphDetails();
}

function commitFontViewSelection(name: string, shown: Glyph[], mode: "replace" | "toggle" | "range"): void {
  const ordered = shown.map((glyph) => glyph.name);
  const next = updateGlyphSelection([...state.selectedGlyphNames], ordered, name, mode, state.selectionAnchorName);
  state.selectedGlyphNames = new Set(next);
  if (mode !== "range") state.selectionAnchorName = name;
  state.focusedGlyphName = name;
  const primaryName = state.selectedGlyphNames.has(name) ? name : next[next.length - 1] || name;
  const glyph = findGlyph(state.font, primaryName);
  if (glyph) {
    state.currentGlyphName = glyph.name;
    editor.refresh(state.font, glyph);
    refreshPaneB(false);
    renderHeader();
    renderSide();
    renderPreview();
  }
  updateFontViewSelectionUI(shown);
  setStatus(fontViewSelectionText(state.selectedGlyphNames.size, shown.length, state.font.glyphs.length));
}

function renderFontView() {
  currentCompatBad = state.font.masters.length >= 2
    ? new Set(compatibilityReport(state.font).map((issue) => issue.glyphName))
    : new Set<string>();
  const grid = $<HTMLElement>("#glyphGrid");
  const previousMode = grid.dataset.viewMode as "grid" | "list" | undefined;
  if (previousMode) state.fontViewScroll[previousMode] = grid.scrollTop;
  grid.querySelectorAll<HTMLCanvasElement>("canvas").forEach((canvas) => thumbnailObserver?.unobserve(canvas));
  const shown = visibleGlyphs();
  renderNavList($("#categoryNav"), "All",
    GLYPH_CATEGORIES.map((name) => ({ name, count: state.font.glyphs.filter((g) => categoryForGlyph(g) === name).length })),
    state.fontCategory, (name) => { state.fontCategory = name; state.activeSavedFilterId = ""; state.fontViewScroll[state.fontViewMode] = 0; renderFontView(); });
  const scripts = [...new Set(state.font.glyphs.map((g) => scriptForGlyph(g)))].sort();
  renderNavList($("#languageNav"), "All languages",
    scripts.map((name) => ({ name, count: state.font.glyphs.filter((g) => scriptForGlyph(g) === name).length })),
    state.fontLanguage, (name) => { state.fontLanguage = name; state.activeSavedFilterId = ""; state.fontViewScroll[state.fontViewMode] = 0; renderFontView(); });
  renderSavedFilters();
  const titleParts = [state.fontCategory !== "All" ? state.fontCategory : null, state.fontLanguage !== "All" ? state.fontLanguage : null].filter(Boolean);
  $("#fontViewTitle").textContent = titleParts.length ? titleParts.join(", ") : "All glyphs";
  const sortLabel = state.glyphSort === "name" ? "Name order" : state.glyphSort === "unicode" ? "Unicode order" : "Font order";
  $("#fontViewSubtitle").textContent = state.fontViewMode === "list" ? `${sortLabel} · resizable columns` : `${sortLabel} · ${state.cellSize}px cells`;
  const search = $<HTMLInputElement>("#glyphSearch");
  search.placeholder = state.workspace === "font" ? "Search glyphs by name, Unicode, tag" : "Find glyph, Unicode, tag";
  document.querySelectorAll<HTMLButtonElement>("[data-nav-scope]").forEach((button) => {
    const active = button.dataset.navScope === state.editNavScope;
    button.classList.toggle("is-on", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#editNavContext").textContent = `${shown.length} glyph${shown.length === 1 ? "" : "s"}`;
  grid.style.setProperty("--fv-cell", `${state.cellSize}px`);
  grid.className = state.workspace === "font"
    ? `glyph-grid${state.fontViewMode === "list" ? " list-mode" : ""}${state.cellSize < 78 ? " is-compact" : ""}${state.cellSize >= 124 ? " is-roomy" : ""}`
    : "glyph-grid edit-nav-grid";
  grid.dataset.viewMode = state.fontViewMode;
  grid.setAttribute("role", state.fontViewMode === "list" && state.workspace === "font" ? "grid" : "listbox");
  applyListColumnStyles(grid);
  grid.innerHTML = "";
  if (state.workspace !== "font") {
    const groups = new Map<string, Glyph[]>();
    for (const glyph of shown) {
      const group = categoryForGlyph(glyph);
      groups.set(group, [...(groups.get(group) || []), glyph]);
    }
    let index = 0;
    for (const [group, glyphs] of groups) {
      const heading = document.createElement("div");
      heading.className = "edit-nav-group";
      heading.innerHTML = `<span>${escHtml(group)}</span><span>${glyphs.length}</span>`;
      grid.appendChild(heading);
      for (const glyph of glyphs) {
        const status = glyphViewStatus(glyph);
        const cell = document.createElement("div");
        cell.className = `edit-nav-cell${glyph.name === state.currentGlyphName ? " is-sel is-current" : ""}`;
        cell.setAttribute("role", "option");
        cell.title = `${glyph.name} · ${status.label} · width ${glyph.width}`;
        const canvas = document.createElement("canvas");
        cell.appendChild(canvas);
        const label = document.createElement("span");
        label.className = "edit-nav-name";
        label.textContent = glyph.name;
        cell.appendChild(label);
        const meta = document.createElement("span");
        meta.className = "edit-nav-meta";
        meta.textContent = glyph.unicode == null ? `${glyph.width}` : glyph.unicode.toString(16).toUpperCase().padStart(4, "0");
        cell.appendChild(meta);
        const dot = document.createElement("i");
        dot.className = `edit-nav-status is-${status.state}`;
        dot.setAttribute("aria-label", status.label);
        cell.appendChild(dot);
        bindFontViewItem(cell, glyph, shown, index++);
        grid.appendChild(cell);
        drawThumb(canvas, glyph);
      }
    }
  } else if (state.fontViewMode === "list") {
    const head = document.createElement("div");
    head.className = "glyph-row glyph-row-head";
    head.setAttribute("role", "row");
    const columns: Array<[string, string]> = [["", ""], ["id", "ID"], ["export", "Export"], ["name", "Name"], ["unicode", "Unicode"], ["script", "Script"], ["category", "Category"], ["status", "Status"], ["width", "Width"], ["lsb", "LSB"], ["rsb", "RSB"]];
    head.innerHTML = columns.map(([key, label], index) => `<span class="${index === 0 ? "fv-row-select" : ""}" role="columnheader">${label}${key ? `<i class="fv-col-resizer" data-resize-col="${key}" aria-hidden="true"></i>` : ""}</span>`).join("");
    grid.appendChild(head);
    setupListColumnResizers(head, grid);
    const fragment = document.createDocumentFragment();
    shown.forEach((g, idx) => {
      const status = glyphViewStatus(g);
      const row = document.createElement("div");
      row.className = `glyph-row${state.selectedGlyphNames.has(g.name) ? " is-sel" : ""}${g.name === state.focusedGlyphName ? " is-current" : ""}`;
      row.setAttribute("role", "row");
      row.title = `${g.name} — double-click to edit`;
      row.innerHTML = `<span class="fv-row-select"><i class="fv-selection-box" aria-hidden="true"></i></span><span class="numeric">${state.font.glyphs.indexOf(g)}</span><span class="fv-export-mark"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>Yes</span><span class="gname">${escHtml(g.name)}</span><span class="numeric">${g.unicode != null ? g.unicode.toString(16).toUpperCase().padStart(4, "0") : "—"}</span><span>${escHtml(scriptForGlyph(g))}</span><span>${escHtml(categoryForGlyph(g))}</span><span class="fv-status-tag" data-state="${status.state}"><i class="fv-status-dot" aria-hidden="true"></i>${status.label}</span><span class="numeric">${g.width}</span><span class="numeric">${g.lsb}</span><span class="numeric">${g.rsb}</span>`;
      bindFontViewItem(row, g, shown, idx);
      fragment.appendChild(row);
    });
    grid.appendChild(fragment);
  } else {
    const fragment = document.createDocumentFragment();
    shown.forEach((g, idx) => {
      const status = glyphViewStatus(g);
      const cell = document.createElement("div");
      cell.className = `glyph-cell${state.selectedGlyphNames.has(g.name) ? " is-sel" : ""}${g.name === state.focusedGlyphName ? " is-current" : ""}`;
      cell.setAttribute("role", "option");
      cell.title = `${g.name} — double-click to edit`;
      const canvas = document.createElement("canvas");
      cell.appendChild(canvas);
      if (g.colorLabel != null && COLOR_LABELS[g.colorLabel]) {
        const dot = document.createElement("span");
        dot.className = "fv-color-dot";
        dot.style.background = COLOR_LABELS[g.colorLabel].hex;
        dot.title = `Color label: ${COLOR_LABELS[g.colorLabel].name}`;
        cell.appendChild(dot);
      }
      const name = document.createElement("div"); name.className = "gname"; name.textContent = g.name; cell.appendChild(name);
      const meta = document.createElement("div"); meta.className = "gmeta";
      meta.innerHTML = `<span class="guni">${g.unicode != null ? `U+${g.unicode.toString(16).toUpperCase().padStart(4, "0")}` : "—"}</span><span class="gstatus">${status.label}</span>${compatBadGlyphs().has(g.name) ? '<span class="gcompat" title="Interpolation issue — open in Edit View">⚠ masters</span>' : ""}`;
      cell.appendChild(meta);
      bindFontViewItem(cell, g, shown, idx);
      fragment.appendChild(cell);
      if (idx < 80) drawThumb(canvas, g); else queueThumbnail(canvas, g);
    });
    grid.appendChild(fragment);
  }
  if (!shown.length) grid.innerHTML = '<p class="hint">No glyphs match the current search and filters. Clear a filter or add a glyph.</p>';
  updateFontViewSelectionUI(shown);
  $("#gridModeBtn").classList.toggle("is-on", state.fontViewMode === "grid");
  $("#listModeBtn").classList.toggle("is-on", state.fontViewMode === "list");
  $<HTMLButtonElement>("#gridModeBtn").setAttribute("aria-pressed", String(state.fontViewMode === "grid"));
  $<HTMLButtonElement>("#listModeBtn").setAttribute("aria-pressed", String(state.fontViewMode === "list"));
  $<HTMLElement>(".fv-size").hidden = state.workspace === "font" && state.fontViewMode === "list";
  requestAnimationFrame(() => { grid.scrollTop = state.fontViewScroll[state.fontViewMode]; });
}

function scrollFocusedFontItem(): void {
  const item = [...document.querySelectorAll<HTMLElement>("#glyphGrid [data-glyph-name]")]
    .find((candidate) => candidate.dataset.glyphName === state.focusedGlyphName);
  item?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function handleFontViewKeydown(event: KeyboardEvent): void {
  if (state.workspace !== "font") return;
  const shown = filteredGlyphs();
  if (!shown.length) return;
  const names = shown.map((glyph) => glyph.name);
  let index = Math.max(0, names.indexOf(state.focusedGlyphName));
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
    event.preventDefault();
    state.selectedGlyphNames = new Set(names);
    state.selectionAnchorName = names[0];
    state.focusedGlyphName = names[names.length - 1];
    state.currentGlyphName = state.focusedGlyphName;
    updateFontViewSelectionUI(shown);
    scrollFocusedFontItem();
    setStatus(fontViewSelectionText(names.length, names.length, state.font.glyphs.length));
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    setWorkspace("edit");
    openGlyph(names[index], true);
    return;
  }
  if (event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    commitFontViewSelection(names[index], shown, event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "replace");
    scrollFocusedFontItem();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    state.selectedGlyphNames.clear();
    updateFontViewSelectionUI(shown);
    setStatus("Font View selection cleared.");
    return;
  }
  if (event.key === "Delete") {
    event.preventDefault();
    $<HTMLButtonElement>("#deleteSelectedBtn").click();
    return;
  }
  const items = [...document.querySelectorAll<HTMLElement>("#glyphGrid [data-glyph-name]")];
  const firstTop = items[0]?.offsetTop ?? 0;
  const columns = state.fontViewMode === "list" ? 1 : Math.max(1, items.filter((item) => item.offsetTop === firstTop).length);
  const pageRows = Math.max(1, Math.floor($<HTMLElement>("#glyphGrid").clientHeight / Math.max(1, items[0]?.offsetHeight || state.cellSize)) - 1);
  let nextIndex = index;
  if (event.key === "ArrowLeft") nextIndex -= 1;
  else if (event.key === "ArrowRight") nextIndex += 1;
  else if (event.key === "ArrowUp") nextIndex -= columns;
  else if (event.key === "ArrowDown") nextIndex += columns;
  else if (event.key === "PageUp") nextIndex -= columns * pageRows;
  else if (event.key === "PageDown") nextIndex += columns * pageRows;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = names.length - 1;
  else return;
  event.preventDefault();
  nextIndex = Math.max(0, Math.min(names.length - 1, nextIndex));
  const nextName = names[nextIndex];
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
    state.focusedGlyphName = nextName;
    updateFontViewSelectionUI(shown);
  } else {
    commitFontViewSelection(nextName, shown, event.shiftKey ? "range" : "replace");
  }
  scrollFocusedFontItem();
}

function renderTabs() {
  const tabs = $("#tabs");
  tabs.innerHTML = "";
  const fv = document.createElement("button");
  fv.className = `tab${state.workspace === "font" ? " is-on" : ""}`; fv.type = "button"; fv.textContent = "Font View";
  fv.setAttribute("role", "tab");
  fv.setAttribute("aria-selected", String(state.workspace === "font"));
  fv.addEventListener("click", () => { setWorkspace("font"); $<HTMLInputElement>("#glyphSearch").focus(); });
  tabs.appendChild(fv);
  for (const name of state.openTabs) {
    const b = document.createElement("button");
    const active = state.workspace === "edit" && name === state.currentGlyphName;
    b.className = `tab${active ? " is-on" : ""}`;
    b.type = "button"; b.textContent = name; b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(active));
    b.addEventListener("click", () => { setWorkspace("edit"); openGlyph(name, false); });
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
  const moreSplit = $<HTMLButtonElement>("#moreSplitBtn");
  moreSplit.classList.toggle("is-on", state.splitView);
  moreSplit.textContent = state.splitView ? "Close master split" : "Split masters side-by-side";
  $<HTMLElement>("#paneBLabel").hidden = !state.splitView;
  const svgB = $<SVGSVGElement>("#editorSvgB");
  if (state.splitView) svgB.removeAttribute("hidden"); else svgB.setAttribute("hidden", "");
  const g = currentGlyph();
  const master = state.font.masters.find((m) => m.id === state.font.currentMasterId);
  $("#infoGlyph").textContent = g?.name || "—";
  $("#infoUnicode").textContent = g?.unicode == null ? "No Unicode" : `U+${g.unicode.toString(16).toUpperCase().padStart(4, "0")}`;
  $("#infoLSB").textContent = String(g?.lsb ?? "—");
  $("#infoWidth").textContent = String(g?.width ?? "—");
  $("#infoRSB").textContent = String(g?.rsb ?? "—");
  $("#infoMaster").textContent = master?.name || "";
  $("#sideContext").textContent = g ? `${g.name} · ${master?.name || ""}` : "No selection";
  $("#statusRight").textContent = g
    ? `${state.font.familyName} · ${g.name} · width ${g.width} · LSB ${g.lsb} RSB ${g.rsb} · ${state.font.glyphs.length} glyphs`
    : state.font.familyName;
  updateCanvasHud();
  updateSpacingContext();
  updateSelectionReadout();
}

function renderDynamic(refitSide = true) {
  if (refitSide) renderMastersBar();
  updateComparisonGhosts();
  renderHeader();
  renderTabs();
  renderFontView();
  renderPreview();
  refreshPaneB(false);
  if (refitSide) renderSide();
}

function renderAll() {
  renderMastersBar();
  updateComparisonGhosts();
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
  updateSpacingContext();
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
      const d = state.proofInterpolated && state.font.masters.length >= 2
        ? (interpolatedPathD(g, state.axisT) || glyphToPathDResolved(state.font, g, state.font.currentMasterId))
        : glyphToPathDResolved(state.font, g, state.font.currentMasterId);
      if (d) {
        const p = document.createElementNS(SVGNS, "path");
        p.setAttribute("d", d);
        if (isMark) {
          p.setAttribute("transform", `translate(${lastBaseX + (item.dx || 0) * s} ${baseline - (item.dy || 0) * s}) scale(${s} ${-s})`);
          p.setAttribute("fill", "#1f9d63");
        } else {
          p.setAttribute("transform", `translate(${cursor} ${baseline}) scale(${s} ${-s})`);
          p.setAttribute("fill", "#26262c");
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
  bl.setAttribute("stroke", "#cfcfd8");
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
    <div id="inspSuggestion"></div>
    <div class="field-row">
      <div class="field"><label>Production name</label><input id="inspProd" type="text" value="${escHtml(g.productionName || "")}" placeholder="${escHtml(productionNameFor(g.name, g.unicode, ""))}" /></div>
      <div class="field"><label>Script (override)</label><input id="inspScript" type="text" value="${escHtml(g.scriptOverride || "")}" placeholder="${escHtml(scriptForGlyph({ ...g, scriptOverride: "" }))}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Case</label><select id="inspCase">
        <option value=""${!g.glyphCase ? " selected" : ""}>Auto</option>
        <option value="upper"${g.glyphCase === "upper" ? " selected" : ""}>Uppercase</option>
        <option value="lower"${g.glyphCase === "lower" ? " selected" : ""}>Lowercase</option>
      </select></div>
      <div class="field"><label>Color label</label><select id="inspColor">
        <option value="-1"${g.colorLabel == null || g.colorLabel < 0 ? " selected" : ""}>None</option>
        ${COLOR_LABELS.map((c, i) => `<option value="${i}"${g.colorLabel === i ? " selected" : ""}>${c.name}</option>`).join("")}
      </select></div>
    </div>
    <div class="field"><label>Tags (comma-separated)</label><input id="inspTags" type="text" value="${escHtml((g.tags || []).join(", "))}" placeholder="latin, core" /></div>
    <div class="field"><label>Note</label><textarea id="inspNote" rows="2">${escHtml(g.note || "")}</textarea></div>
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
    const old = g.name;
    const next = el.value.trim();
    if (!renameGlyph(state.font, old, next)) {
      setStatus("Name empty, unchanged, or already used — rename reverted.");
      state.font = state.undoStack.pop() || state.font;
      return;
    }
    state.openTabs = state.openTabs.map((n) => (n === old ? next : n));
    state.currentGlyphName = next;
    if (state.selectedGlyphNames.delete(old)) state.selectedGlyphNames.add(next);
    if (state.selectionAnchorName === old) state.selectionAnchorName = next;
    if (state.focusedGlyphName === old) state.focusedGlyphName = next;
    setStatus(`Renamed ${old} to ${next} — components, metrics keys, and kerning pairs updated.`);
  });
  const suggestion = glyphSuggestionFor(g.name);
  const suggEl = qs<HTMLElement>(page, "#inspSuggestion");
  if (suggestion && (g.unicode !== suggestion.unicode || categoryForGlyph(g) !== suggestion.category)) {
    suggEl.innerHTML = `<p class="hint">Glyph info suggests U+${suggestion.unicode.toString(16).toUpperCase().padStart(4, "0")} · ${escHtml(suggestion.category)}${suggestion.production ? ` · ${escHtml(suggestion.production)}` : ""}. <button id="applySuggestionBtn" type="button">Apply</button></p>`;
    qs<HTMLButtonElement>(suggEl, "#applySuggestionBtn").addEventListener("click", () => {
      pushUndo();
      g.unicode = suggestion.unicode;
      g.category = suggestion.category;
      if (suggestion.production && !g.productionName) g.productionName = suggestion.production;
      if (suggestion.glyphCase && !g.glyphCase) g.glyphCase = suggestion.glyphCase;
      editor.refresh(state.font, currentGlyph()); renderAll();
      setStatus(`Glyph info applied to ${g.name}.`);
    });
  }
  bindChange(page.querySelector("#inspProd"), (el) => { g.productionName = el.value.trim(); });
  bindChange(page.querySelector("#inspScript"), (el) => { g.scriptOverride = el.value.trim(); });
  bindChange(page.querySelector("#inspCase"), (el) => { g.glyphCase = (el.value === "upper" || el.value === "lower" ? el.value : "") as Glyph["glyphCase"]; });
  bindChange(page.querySelector("#inspColor"), (el) => { const v = Number(el.value); g.colorLabel = v >= 0 ? v : undefined; });
  bindChange(page.querySelector("#inspTags"), (el) => { g.tags = parseTags(el.value); });
  bindChange(page.querySelector("#inspNote"), (el) => { g.note = el.value; });
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
    state.selectedGlyphNames = new Set([state.currentGlyphName]);
    state.selectionAnchorName = state.currentGlyphName;
    state.focusedGlyphName = state.currentGlyphName;
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

function transformOriginPoint(bounds: ReturnType<typeof glyphBounds>, origin: TransformOrigin): [number, number] {
  if (!bounds) return [0, 0];
  const x = origin.endsWith("left") || origin === "left" ? bounds.minX : origin.endsWith("right") || origin === "right" ? bounds.maxX : (bounds.minX + bounds.maxX) / 2;
  const y = origin.startsWith("top") || origin === "top" ? bounds.maxY : origin.startsWith("bottom") || origin === "bottom" ? bounds.minY : (bounds.minY + bounds.maxY) / 2;
  return [x, y];
}

function renderPalette(g: Glyph): void {
  const page = $("#side-palette");
  if (!g) { page.innerHTML = '<p class="hint">No glyph selected.</p>'; return; }
  const layer = layerOf(g);
  const b = glyphBounds(g, state.font.currentMasterId);
  const boundsTxt = b ? `X ${Math.round(b.minX)}…${Math.round(b.maxX)} · Y ${Math.round(b.minY)}…${Math.round(b.maxY)} · W ${Math.round(b.maxX - b.minX)} × H ${Math.round(b.maxY - b.minY)}` : "Empty layer";
  const selectionCount = activeEd.getSelectionCount();
  const nodeCount = layer.paths.reduce((total, contour) => total + contour.nodes.length, 0);
  const currentMaster = state.font.masters.find((master) => master.id === state.font.currentMasterId);
  const open = (section: string): string => palettePrefs.openSections.includes(section) ? " open" : "";
  const masterRows = state.font.masters.map((master) => `
    <div class="layer-row${master.id === state.font.currentMasterId ? " is-active" : ""}${paletteHiddenMasters.has(master.id) ? " is-hidden" : ""}">
      <button class="layer-visibility icon-btn" data-layer-visibility="${escHtml(master.id)}" type="button" aria-label="${paletteHiddenMasters.has(master.id) ? "Show" : "Hide"} ${escHtml(master.name)} layer" aria-pressed="${!paletteHiddenMasters.has(master.id)}" title="${paletteHiddenMasters.has(master.id) ? "Show layer" : "Hide layer"}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.8 8s2.3-3.3 6.2-3.3S14.2 8 14.2 8 11.9 11.3 8 11.3 1.8 8 1.8 8Z"/><circle cx="8" cy="8" r="1.6"/>${paletteHiddenMasters.has(master.id) ? '<path d="m3 3 10 10"/>' : ""}</svg></button>
      <button class="layer-select" data-master-layer="${escHtml(master.id)}" type="button"><span><strong>${escHtml(master.name)}</strong><small>${master.weightValue || 0} weight · ${(g.layers[master.id]?.paths.length ?? 0)}c · ${(g.layers[master.id]?.paths.reduce((n, c) => n + c.nodes.length, 0) ?? 0)}n${g.layers[master.id] ? "" : " · missing"}</small></span></button>
      <span class="layer-kind">${master.id === state.font.currentMasterId ? "Active" : "Master"}</span>
    </div>`).join("");
  const componentRows = (g.components || []).map((component) => `<div class="component-row"><span>${escHtml(component.glyph)}</span><span>${Math.round(component.x)}, ${Math.round(component.y)}</span></div>`).join("");
  const originCells: TransformOrigin[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
  const originMatrix = originCells.map((origin) => `<button data-origin="${origin}" class="origin-cell${palettePrefs.origin === origin ? " is-on" : ""}" type="button" aria-label="Transform from ${origin.replace("-", " ")}" aria-pressed="${palettePrefs.origin === origin}"><span></span></button>`).join("");
  page.innerHTML = `
    <div class="palette-context">
      <div><strong>${escHtml(g.name)}</strong><span>${escHtml(currentMaster?.name || "Layer")}</span></div>
      <span id="paletteSelectionContext">${selectionCount ? `${selectionCount} selected` : `${layer.paths.length} paths · ${nodeCount} nodes`}</span>
    </div>
    <details class="palette-section" data-palette-section="dimensions"${open("dimensions")}>
      <summary><span>Dimensions</span><small>${g.width} width</small></summary>
      <div class="palette-section-body">
        <p class="measurement-readout">${boundsTxt}</p>
        <div class="field-row-3 compact-fields">
          <div class="field"><label>Width</label><input id="palWidth" type="number" value="${g.width}" /></div>
          <div class="field"><label>LSB</label><input id="palLsb" type="number" value="${g.lsb}" /></div>
          <div class="field"><label>RSB</label><input id="palRsb" type="number" value="${g.rsb}" /></div>
        </div>
      </div>
    </details>
    <details class="palette-section" data-palette-section="transformations"${open("transformations")}>
      <summary><span>Transformations</span><small id="palTransformSummary">Ready</small></summary>
      <div class="palette-section-body">
        <div class="transform-layout">
          <div><span class="control-label">Origin</span><div class="origin-matrix" role="group" aria-label="Transform origin">${originMatrix}</div></div>
          <div class="transform-values">
            <div class="field-row compact-fields"><div class="field"><label>Move X</label><input id="palDx" type="number" value="${palettePrefs.dx}" /></div><div class="field"><label>Move Y</label><input id="palDy" type="number" value="${palettePrefs.dy}" /></div></div>
            <div class="scale-row compact-fields"><div class="field"><label>Scale X %</label><input id="palScaleX" type="number" value="${palettePrefs.scaleX}" /></div><button id="palScaleLock" class="icon-btn${palettePrefs.scaleLocked ? " is-on" : ""}" type="button" aria-label="${palettePrefs.scaleLocked ? "Unlock" : "Lock"} scale proportions" aria-pressed="${palettePrefs.scaleLocked}" title="Lock scale proportions"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/></svg></button><div class="field"><label>Scale Y %</label><input id="palScaleY" type="number" value="${palettePrefs.scaleY}" /></div></div>
            <div class="field-row compact-fields"><div class="field"><label>Rotate °</label><input id="palRot" type="number" value="${palettePrefs.rotate}" /></div><div class="field"><label>Skew X °</label><input id="palSkew" type="number" min="-89" max="89" value="${palettePrefs.skew}" /></div></div>
          </div>
        </div>
        <div class="transform-icon-row" role="group" aria-label="Transform and alignment controls">
          <button id="palFlipH" class="icon-btn" type="button" aria-label="Flip horizontal" title="Flip horizontal"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2.5 4.5 6.5 8l-4 3.5ZM13.5 4.5 9.5 8l4 3.5Z"/></svg></button>
          <button id="palFlipV" class="icon-btn" type="button" aria-label="Flip vertical" title="Flip vertical"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h12M4.5 2.5 8 6.5l3.5-4ZM4.5 13.5 8 9.5l3.5 4Z"/></svg></button>
          <span class="control-separator"></span>
          <button data-pal-align="left" class="icon-btn" type="button" aria-label="Align selection left" title="Align left" ${selectionCount < 2 ? "disabled" : ""}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2v12M5 4h7M5 8h5M5 12h8"/></svg></button>
          <button data-pal-align="hcenter" class="icon-btn" type="button" aria-label="Align selection center" title="Align center" ${selectionCount < 2 ? "disabled" : ""}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M4 4h8M5 8h6M3 12h10"/></svg></button>
          <button data-pal-align="right" class="icon-btn" type="button" aria-label="Align selection right" title="Align right" ${selectionCount < 2 ? "disabled" : ""}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 2v12M4 4h7M6 8h5M3 12h8"/></svg></button>
          <button id="palApply" class="primary-action transform-apply" type="button">Apply</button>
        </div>
      </div>
    </details>
    <details class="palette-section" data-palette-section="layers"${open("layers")}>
      <summary><span>Layers</span><small>${state.font.masters.length} master${state.font.masters.length === 1 ? "" : "s"}</small></summary>
      <div class="palette-section-body"><div class="layer-list">${masterRows}</div><div id="palCompat"></div><div class="palette-actions"><button id="palCopyLayer" type="button">New master from layer…</button></div><div class="subsection-label">Intermediate layers</div><div id="intermediateList"></div><button id="palAddIntermediate" class="quiet-action" type="button">Capture intermediate…</button></div>
    </details>
    <details class="palette-section" data-palette-section="components"${open("components")} ${(g.components || []).length ? "" : "hidden"}>
      <summary><span>Components</span><small>${(g.components || []).length}</small></summary>
      <div class="palette-section-body"><div class="component-list">${componentRows}</div><button id="palEditComponents" class="quiet-action" type="button">Edit components in Glyph</button></div>
    </details>
    <details class="palette-section" data-palette-section="fit"${open("fit")} ${state.font.masters.length > 1 ? "" : "hidden"}>
      <summary><span>Fit Curve</span><small>Interpolation</small></summary>
      <div class="palette-section-body"><div class="field"><label>Preview first ↔ last master</label><input id="palInterp" type="range" min="0" max="100" value="50" /><span id="palInterpLabel" class="hint"></span></div><button id="palExportInstance" type="button">Export preview as UFO</button></div>
    </details>
    <details class="palette-section" data-palette-section="filters"${open("filters")} ${layer.paths.length ? "" : "hidden"}>
      <summary><span>Filters</span><small>Outline</small></summary>
      <div class="palette-section-body"><div class="filter-grid"><button id="palExtremes" type="button">Add extremes</button><button id="palFitCurve" type="button">Fit curve</button><button id="palRound" type="button">Round corners…</button><button id="palOffset" type="button">Offset curve…</button><button id="palResegment" type="button">Re-segment</button><button id="palDupes" type="button">Remove duplicates</button><button id="palFixDir" type="button">Fix direction</button><button id="palUnion" type="button">Union paths</button><button id="palSubtract" class="filter-wide" type="button">Subtract paths</button></div><span id="palDupeReport" class="hint"></span><p class="hint">Union, subtract, and offset flatten curves. Undo restores the original outline.</p></div>
    </details>
    <details class="palette-section" data-palette-section="backups"${open("backups")} ${layer.paths.length || (g.backups || []).length ? "" : "hidden"}>
      <summary><span>Backup layers</span><small>${(g.backups || []).filter((backup) => backup.masterId === state.font.currentMasterId).length}</small></summary>
      <div class="palette-section-body"><div id="backupList"></div><button id="palBackup" class="quiet-action" type="button">Back up active layer</button></div>
    </details>`;
  $<SVGSVGElement>("#editorSvg").classList.toggle("palette-outline-hidden", paletteHiddenMasters.has(state.font.currentMasterId));
  page.querySelectorAll<HTMLDetailsElement>("[data-palette-section]").forEach((section) => section.addEventListener("toggle", () => {
    const id = section.dataset.paletteSection;
    if (!id) return;
    const openSections = new Set(palettePrefs.openSections);
    if (section.open) openSections.add(id); else openSections.delete(id);
    palettePrefs.openSections = [...openSections];
    persistPalettePrefs();
  }));
  bindChange(page.querySelector("#palWidth"), (input) => { g.width = Math.max(0, +input.value || 0); syncBearings(state.font, g); });
  bindChange(page.querySelector("#palLsb"), (input) => {
    const next = +input.value || 0;
    const dx = next - g.lsb;
    for (const contour of layer.paths) for (const node of contour.nodes) node.x += dx;
    g.lsb = next; syncBearings(state.font, g);
  });
  bindChange(page.querySelector("#palRsb"), (input) => {
    const bounds = glyphBounds(g, state.font.currentMasterId);
    g.rsb = +input.value || 0;
    if (bounds) g.width = Math.max(0, Math.round(bounds.maxX + g.rsb));
  });
  page.querySelectorAll<HTMLButtonElement>("[data-master-layer]").forEach((button) => button.addEventListener("click", () => {
    const masterId = button.dataset.masterLayer;
    if (!masterId || masterId === state.font.currentMasterId) return;
    state.font.currentMasterId = masterId;
    $<SVGSVGElement>("#editorSvg").classList.toggle("palette-outline-hidden", paletteHiddenMasters.has(masterId));
    editor.refresh(state.font, g); renderAll();
    setStatus(`Active layer: ${state.font.masters.find((master) => master.id === masterId)?.name || "Master"}.`);
  }));
  page.querySelectorAll<HTMLButtonElement>("[data-layer-visibility]").forEach((button) => button.addEventListener("click", () => {
    const masterId = button.dataset.layerVisibility;
    if (!masterId) return;
    if (paletteHiddenMasters.has(masterId)) paletteHiddenMasters.delete(masterId); else paletteHiddenMasters.add(masterId);
    updateComparisonGhosts();
    renderMastersBar();
    $<SVGSVGElement>("#editorSvg").classList.toggle("palette-outline-hidden", paletteHiddenMasters.has(state.font.currentMasterId));
    renderPalette(g);
    setStatus(`${state.font.masters.find((master) => master.id === masterId)?.name || "Layer"} ${paletteHiddenMasters.has(masterId) ? "hidden" : "visible"}.`);
  }));
  qs<HTMLButtonElement>(page, "#palEditComponents").addEventListener("click", () => {
    document.querySelector<HTMLButtonElement>('[data-side="inspector"]')?.click();
    requestAnimationFrame(() => qs<HTMLElement>($("#side-inspector"), "#compList").scrollIntoView({ block: "center" }));
  });
  const dxInput = qs<HTMLInputElement>(page, "#palDx");
  const dyInput = qs<HTMLInputElement>(page, "#palDy");
  const scaleXInput = qs<HTMLInputElement>(page, "#palScaleX");
  const scaleYInput = qs<HTMLInputElement>(page, "#palScaleY");
  const rotateInput = qs<HTMLInputElement>(page, "#palRot");
  const skewInput = qs<HTMLInputElement>(page, "#palSkew");
  const transformSummary = qs<HTMLElement>(page, "#palTransformSummary");
  const updateTransformPrefs = (source?: HTMLInputElement): void => {
    if (palettePrefs.scaleLocked && source === scaleXInput) scaleYInput.value = scaleXInput.value;
    if (palettePrefs.scaleLocked && source === scaleYInput) scaleXInput.value = scaleYInput.value;
    palettePrefs.dx = +dxInput.value || 0;
    palettePrefs.dy = +dyInput.value || 0;
    palettePrefs.scaleX = +scaleXInput.value || 100;
    palettePrefs.scaleY = +scaleYInput.value || 100;
    palettePrefs.rotate = +rotateInput.value || 0;
    palettePrefs.skew = Math.min(89, Math.max(-89, +skewInput.value || 0));
    transformSummary.textContent = `${palettePrefs.scaleX} × ${palettePrefs.scaleY}% · ${palettePrefs.rotate}°`;
    persistPalettePrefs();
  };
  [dxInput, dyInput, scaleXInput, scaleYInput, rotateInput, skewInput].forEach((input) => input.addEventListener("input", () => updateTransformPrefs(input)));
  updateTransformPrefs();
  qs<HTMLButtonElement>(page, "#palScaleLock").addEventListener("click", (event) => {
    palettePrefs.scaleLocked = !palettePrefs.scaleLocked;
    if (palettePrefs.scaleLocked) scaleYInput.value = scaleXInput.value;
    const button = event.currentTarget as HTMLButtonElement;
    button.classList.toggle("is-on", palettePrefs.scaleLocked);
    button.setAttribute("aria-pressed", String(palettePrefs.scaleLocked));
    button.setAttribute("aria-label", `${palettePrefs.scaleLocked ? "Unlock" : "Lock"} scale proportions`);
    updateTransformPrefs();
  });
  page.querySelectorAll<HTMLButtonElement>("[data-origin]").forEach((button) => button.addEventListener("click", () => {
    palettePrefs.origin = (button.dataset.origin || "center") as TransformOrigin;
    page.querySelectorAll<HTMLButtonElement>("[data-origin]").forEach((cell) => {
      const active = cell === button;
      cell.classList.toggle("is-on", active); cell.setAttribute("aria-pressed", String(active));
    });
    persistPalettePrefs();
  }));
  page.querySelectorAll<HTMLButtonElement>("[data-pal-align]").forEach((button) => button.addEventListener("click", () => {
    activeEd.alignSelection((button.dataset.palAlign || "left") as AlignMode);
  }));
  qs<HTMLButtonElement>(page, "#palApply").addEventListener("click", () => {
    pushUndo();
    updateTransformPrefs();
    const dx = palettePrefs.dx, dy = palettePrefs.dy;
    const scaleX = palettePrefs.scaleX / 100, scaleY = palettePrefs.scaleY / 100;
    const rad = (palettePrefs.rotate * Math.PI) / 180;
    const skew = Math.tan((palettePrefs.skew * Math.PI) / 180);
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const [originX, originY] = transformOriginPoint(b, palettePrefs.origin);
    transformLayer(g, (x, y) => {
      const scaledX = (x - originX) * scaleX;
      const scaledY = (y - originY) * scaleY;
      const skewedX = scaledX + scaledY * skew;
      const rx = skewedX * cos - scaledY * sin;
      const ry = skewedX * sin + scaledY * cos;
      return [originX + rx + dx, originY + ry + dy];
    });
    editor.refresh(state.font, g); renderAll();
    setStatus(`Transform applied from ${palettePrefs.origin.replace("-", " ")} (Ctrl+Z to undo).`);
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
  interpSlider.value = String(Math.round(state.axisT * 100));
  const updateInterp = (): void => {
    const t = (+interpSlider.value || 0) / 100;
    const ig = interpolateGlyphAt(state.font, g.name, t);
    if (!ig) {
        interpLabel.textContent = state.font.masters.length < 2 ? "Add a second master to interpolate." : "Masters incompatible for this glyph (contour/node order differs). See the Masters bar for the fix.";
      setAxisT(t);
      return;
    }
    interpLabel.textContent = `t=${t.toFixed(2)} between ${state.font.masters[0].name} and ${state.font.masters[state.font.masters.length - 1].name} — dashed green ghost in the editor.`;
    setAxisT(t);
  };
  interpSlider.addEventListener("input", updateInterp);
  updateInterp();
  qs<HTMLButtonElement>(page, "#palExportInstance").addEventListener("click", async () => {
    const t = (+interpSlider.value || 0) / 100;
    await exportInstanceUfo(t, "Instance");
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
  const applyOp = (label: string, op: (paths: GlyphLayer["paths"]) => { contours: GlyphLayer["paths"]; changed: number }): void => {
    const layer = layerOf(g);
    const result = op(layer.paths);
    if (!result.changed) { setStatus(`${label}: nothing to change on this layer.`); return; }
    pushUndo();
    layer.paths = result.contours;
    syncBearings(state.font, g);
    editor.refresh(state.font, g); renderAll();
    setStatus(`${label}: ${result.changed} change(s) — Ctrl+Z restores the previous outline.`);
  };
  qs<HTMLButtonElement>(page, "#palExtremes").addEventListener("click", () => applyOp("Add extremes", (p) => addExtremes(p)));
  qs<HTMLButtonElement>(page, "#palFitCurve").addEventListener("click", () => applyOp("Fit curve", (p) => fitCurveContours(p)));
  qs<HTMLButtonElement>(page, "#palResegment").addEventListener("click", () => applyOp("Re-segment", (p) => resegmentContours(p)));
  qs<HTMLButtonElement>(page, "#palRound").addEventListener("click", () => {
    const raw = prompt("Corner radius in font units:", "30");
    if (raw == null) return;
    const radius = parseFloat(raw);
    if (!Number.isFinite(radius) || radius <= 0) { setStatus("Round corners needs a positive radius."); return; }
    applyOp(`Round corners (r=${radius})`, (p) => roundCorners(p, radius));
  });
  qs<HTMLButtonElement>(page, "#palOffset").addEventListener("click", () => {
    const raw = prompt("Offset distance in font units (positive expands, negative shrinks):", "20");
    if (raw == null) return;
    const distance = parseFloat(raw);
    if (!Number.isFinite(distance) || distance === 0) { setStatus("Offset needs a non-zero distance."); return; }
    applyOp(`Offset curve (${distance})`, (p) => offsetContours(p, distance));
  });
  const dupeReport = qs<HTMLElement>(page, "#palDupeReport");
  const dupesNow = findDuplicateNodes(layerOf(g).paths);
  dupeReport.textContent = dupesNow.length ? `${dupesNow.length} duplicate node(s) on this layer.` : "No duplicate nodes on this layer.";
  qs<HTMLButtonElement>(page, "#palDupes").addEventListener("click", () => applyOp("Remove duplicate nodes", (p) => removeDuplicateNodes(p)));
  const backupList = qs<HTMLElement>(page, "#backupList");
  const backups = (g.backups || []).filter((bk) => bk.masterId === state.font.currentMasterId);
  backupList.innerHTML = backups.length
    ? backups.map((bk) => `<div class="field-row"><span>${escHtml(bk.name)} (${bk.paths.length} contour(s))</span><button data-backup-restore="${escHtml(bk.id)}" type="button">Restore</button><button data-backup-del="${escHtml(bk.id)}" type="button">Delete</button></div>`).join("")
    : '<span class="hint">No backups for the active master yet.</span>';
  backupList.querySelectorAll<HTMLButtonElement>("[data-backup-restore]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.backupRestore;
    if (!id) return;
    pushUndo();
    const restored = restoreBackup(g, id);
    if (!restored) { setStatus("Backup not found."); return; }
    syncBearings(state.font, g);
    editor.refresh(state.font, g); renderAll();
    setStatus(`Restored backup ${restored.name} — Ctrl+Z returns to the pre-restore outline.`);
  }));
  backupList.querySelectorAll<HTMLButtonElement>("[data-backup-del]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.backupDel;
    if (!id) return;
    pushUndo();
    deleteBackup(g, id);
    renderAll();
    setStatus("Backup deleted.");
  }));
  qs<HTMLButtonElement>(page, "#palBackup").addEventListener("click", () => {
    pushUndo();
    const backup = snapshotLayer(g, state.font.currentMasterId);
    if (!backup) { setStatus("No layer to back up for the active master."); return; }
    renderAll();
    setStatus(`Backup layer saved: ${backup.name}. Restore it any time from the Palette.`);
  });
  const palCompat = qs<HTMLElement>(page, "#palCompat");
  const glyphIssues = state.font.masters.length >= 2 ? issuesForGlyph(state.font, g.name) : [];
  palCompat.innerHTML = state.font.masters.length < 2
    ? '<p class="hint">Single master — no compatibility check needed.</p>'
    : glyphIssues.length
      ? glyphIssues.map((issue, i) => `<div class="compat-row"><span>${escHtml(issue.masterName)}: ${escHtml(issue.detail)}</span>${issue.masterId.startsWith("inter@") ? "" : `<button data-pal-fix="${i}" type="button">Fix</button>`}</div>`).join("")
      : '<p class="hint">This glyph is interpolation-compatible.</p>';
  palCompat.querySelectorAll<HTMLButtonElement>("[data-pal-fix]").forEach((button) => button.addEventListener("click", () => {
    const issue = glyphIssues[Number(button.dataset.palFix) || 0];
    if (!issue) return;
    const base = sortedMasters(state.font)[0];
    pushUndo();
    if (copyLayerBetweenMasters(state.font, g.name, base.id, issue.masterId)) {
      editor.refresh(state.font, g);
      renderAll();
      setStatus(`Copied the ${base.name} layer of ${g.name} over ${issue.masterName} — redraw that master.`);
    } else {
      state.undoStack.pop();
      setStatus("Could not apply the fix (source layer missing).");
    }
  }));
  const intermediateList = qs<HTMLElement>(page, "#intermediateList");
  intermediateList.innerHTML = (g.intermediates || []).length
    ? (g.intermediates || []).map((s, i) => `<div class="field-row"><span>Weight ${s.axisValue} · ${s.paths.length} contour(s)</span><span><button data-inter-load="${i}" type="button">Load</button> <button data-inter-del="${i}" type="button">Delete</button></span></div>`).join("")
    : '<span class="hint">No intermediate layers yet.</span>';
  intermediateList.querySelectorAll<HTMLButtonElement>("[data-inter-del]").forEach((btn) => btn.addEventListener("click", () => {
    pushUndo();
    (g.intermediates || []).splice(Number(btn.dataset.interDel) || 0, 1);
    renderAll();
    setStatus("Intermediate layer deleted.");
  }));
  intermediateList.querySelectorAll<HTMLButtonElement>("[data-inter-load]").forEach((btn) => btn.addEventListener("click", () => {
    const stop = (g.intermediates || [])[Number(btn.dataset.interLoad) || 0];
    if (!stop) return;
    pushUndo();
    layerOf(g).paths = cloneContours(stop.paths);
    syncBearings(state.font, g);
    editor.refresh(state.font, g); renderAll();
    setStatus(`Intermediate at weight ${stop.axisValue} loaded into the active master layer — edit, then capture again to update the stop.`);
  }));
  qs<HTMLButtonElement>(page, "#palAddIntermediate").addEventListener("click", () => {
    if (state.font.masters.length < 2) { setStatus("Add a second master first — intermediates sit between two masters."); return; }
    const weights = state.font.masters.map((m) => m.weightValue || 0);
    const lo = Math.min(...weights), hi = Math.max(...weights);
    const raw = prompt(`Weight for the intermediate layer (between ${lo} and ${hi}):`, String(Math.round((lo + hi) / 2)));
    if (raw == null) return;
    const axisValue = Number(raw);
    if (!Number.isFinite(axisValue) || axisValue <= lo || axisValue >= hi) { setStatus(`Enter a weight strictly between ${lo} and ${hi}.`); return; }
    pushUndo();
    g.intermediates = [...(g.intermediates || []).filter((s) => s.axisValue !== axisValue), { axisValue, paths: cloneContours(layerOf(g).paths) }]
      .sort((a, b) => a.axisValue - b.axisValue);
    renderAll();
    setStatus(`Intermediate layer captured at weight ${axisValue} from the active master layer.`);
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
  const auto = generateFeatures(state.font);
  const effective = effectiveFeatures(state.font);
  page.innerHTML = `
    <div class="field"><label>Automatic feature code (generated, read-only)</label>
      <textarea id="autoFeatureCode" spellcheck="false" readonly>${escHtml(auto.code)}</textarea>
    </div>
    <p class="hint">Generated: ${auto.kernPairs} kern pair(s), ${auto.groupPairs} group pair(s), ${auto.ligatures} ligature(s), ${auto.markAttachments} mark attachment(s), ${auto.markToMark} mark-to-mark. Exported as UFO <span class="muted">features.fea</span> and shaped live in the preview below.</p>
    <div class="field"><label>Manual feature code (subset, overrides automatic)</label>
      <textarea id="featureCode" spellcheck="false">${escHtml(state.font.featureCode || "")}</textarea>
    </div>
    <div class="field-row">
      <button id="featureApply" type="button">Apply manual code</button>
      <button id="featureUseAuto" type="button">Copy automatic into manual</button>
    </div>
    <p class="hint">Manual parsed: ${parsed.classes.size} class(es), ${parsed.subs.length} substitution(s), ${parsed.poss.size} position pair(s). Effective preview total: ${effective.subs.length} substitution(s), ${effective.poss.size} position pair(s). Supported: <span class="muted">@Class = [A B];</span>, <span class="muted">sub f i by fi;</span>, <span class="muted">pos A V -70;</span> (classes expand in pos). Handbook ref: Feature Code (p179), Font Info Features (p92).</p>
    <p class="warn">Subset only: marks position on anchors in the preview (including mark-to-mark); complex-script shaping and full OpenType layout are deferred — exports are proofed by fontTools readback in the Export tab.</p>`;
  qs<HTMLButtonElement>(page, "#featureApply").addEventListener("click", () => {
    pushUndo();
    state.font.featureCode = qs<HTMLTextAreaElement>(page, "#featureCode").value;
    renderAll();
    const p = effectiveFeatures(state.font);
    setStatus(`Feature code applied: ${p.subs.length} effective sub(s), ${p.poss.size} effective pos pair(s). Try the preview text “fi” or “AV”.`);
  });
  qs<HTMLButtonElement>(page, "#featureUseAuto").addEventListener("click", () => {
    qs<HTMLTextAreaElement>(page, "#featureCode").value = auto.code;
    setStatus("Automatic code copied into the manual editor — Apply manual code to use it as manual (automatic generation still applies underneath).");
  });
}

function renderFontInfo(): void {
  const page = $("#side-fontinfo");
  const f = state.font;
  const autoFeatures = generateFeatures(f);
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
    <p class="hint"><strong>Features:</strong> automatic ${autoFeatures.kernPairs + autoFeatures.groupPairs} kern rule(s), ${autoFeatures.ligatures} ligature(s), ${autoFeatures.markAttachments + autoFeatures.markToMark} mark rule(s); manual code in the Features tab overrides automatic pairs.</p>
    <div class="field"><label>Variable axis (first axis feeds the compile service)</label><div id="fiAxes"></div></div>
    <div class="field"><label>Masters</label><div id="fiMasters"></div></div>
    <div class="field"><label>Instances</label><div id="fiInstances"></div>
      <div class="field-row"><button id="fiAddInstance" type="button">+ Instance</button></div>
    </div>
    <div class="field"><label>Master compatibility</label><div id="fiCompat"></div></div>
    <p class="hint">Handbook ref: Font Info (p85), Masters (p88), Instances and Exports (p92). Static exports use the active master; variable export uses the axis and master weights above through the compile service. Custom parameters are still deferred.</p>`;
  if (!f.axes.length) f.axes = [{ tag: "wght", name: "Weight", min: 400, defaultValue: 400, max: 700 }];
  const axis = f.axes[0];
  const axesEl = qs<HTMLElement>(page, "#fiAxes");
  axesEl.innerHTML = `
    <div class="field-row">
      <div class="field"><label>Axis name</label><input data-axis="name" type="text" value="${escHtml(axis.name)}" /></div>
      <div class="field"><label>Tag</label><input data-axis="tag" type="text" value="${escHtml(axis.tag)}" /></div>
    </div>
    <div class="field-row-3">
      <div class="field"><label>Min</label><input data-axis="min" type="number" value="${axis.min}" /></div>
      <div class="field"><label>Default</label><input data-axis="defaultValue" type="number" value="${axis.defaultValue}" /></div>
      <div class="field"><label>Max</label><input data-axis="max" type="number" value="${axis.max}" /></div>
    </div>
    <p class="hint">The compile service builds one variable axis from these bounds and the master weights below; keep master weights inside the axis range.</p>`;
  axesEl.querySelectorAll<HTMLInputElement>("[data-axis]").forEach((input) => bindChange(input, (el) => {
    const key = input.dataset.axis as "name" | "tag" | "min" | "defaultValue" | "max";
    if (key === "name" || key === "tag") axis[key] = el.value.trim() || axis[key];
    else axis[key] = Number(el.value) || 0;
  }));
  const mastersEl = qs<HTMLElement>(page, "#fiMasters");
  mastersEl.innerHTML = f.masters.map((m, i) => `
    <div class="field-row">
      <div class="field"><label>Master ${i + 1} name</label><input data-master-name="${m.id}" type="text" value="${escHtml(m.name)}" /></div>
      <div class="field"><label>Weight (axis)</label><input data-master-weight="${m.id}" type="number" value="${m.weightValue}" /></div>
    </div>`).join("");
  mastersEl.querySelectorAll<HTMLInputElement>("[data-master-name]").forEach((input) => bindChange(input, (el) => {
    const m = f.masters.find((x) => x.id === input.dataset.masterName);
    if (m && el.value.trim()) m.name = el.value.trim();
  }));
  mastersEl.querySelectorAll<HTMLInputElement>("[data-master-weight]").forEach((input) => bindChange(input, (el) => {
    const m = f.masters.find((x) => x.id === input.dataset.masterWeight);
    if (m) m.weightValue = Number(el.value) || 0;
  }));
  const instancesEl = qs<HTMLElement>(page, "#fiInstances");
  instancesEl.innerHTML = f.instances.length ? f.instances.map((inst, i) => `
    <div class="compat-row">
      <input data-inst-name="${i}" type="text" value="${escHtml(inst.name)}" aria-label="Instance name" />
      <label class="hint"><input data-inst-active="${i}" type="checkbox" ${inst.active ? "checked" : ""} /> Active</label>
      <input data-inst-weight="${i}" type="number" value="${instanceAxisWeight(f, inst)}" aria-label="Instance weight" title="Axis weight" />
      <input data-inst-link="${i}" type="text" value="${escHtml(inst.styleLink || "")}" placeholder="Style link (e.g. Regular)" aria-label="Style link" />
      <button data-inst-export="${i}" type="button">Export UFO</button>
      <button data-inst-del="${i}" type="button">Delete</button>
    </div>`).join("") : '<span class="hint">No instances yet.</span>';
  instancesEl.querySelectorAll<HTMLInputElement>("[data-inst-name]").forEach((input) => bindChange(input, (el) => {
    const inst = f.instances[Number(input.dataset.instName) || 0];
    if (inst && el.value.trim()) inst.name = el.value.trim();
  }));
  instancesEl.querySelectorAll<HTMLInputElement>("[data-inst-active]").forEach((input) => input.addEventListener("change", () => {
    pushUndo();
    const inst = f.instances[Number(input.dataset.instActive) || 0];
    if (inst) inst.active = input.checked;
    renderAll();
  }));
  instancesEl.querySelectorAll<HTMLInputElement>("[data-inst-weight]").forEach((input) => bindChange(input, (el) => {
    const inst = f.instances[Number(input.dataset.instWeight) || 0];
    if (inst) inst.axisValues = { ...(inst.axisValues || {}), [axis.tag]: Number(el.value) || 0 };
  }));
  instancesEl.querySelectorAll<HTMLInputElement>("[data-inst-link]").forEach((input) => bindChange(input, (el) => {
    const inst = f.instances[Number(input.dataset.instLink) || 0];
    if (inst) inst.styleLink = el.value.trim();
  }));
  instancesEl.querySelectorAll<HTMLButtonElement>("[data-inst-export]").forEach((btn) => btn.addEventListener("click", () => {
    const inst = f.instances[Number(btn.dataset.instExport) || 0];
    if (!inst) return;
    if (!inst.active) setStatus(`Instance ${inst.name} is inactive — exporting anyway as requested.`);
    void exportInstanceUfo(instanceT(f, instanceAxisWeight(f, inst)), inst.name);
  }));
  instancesEl.querySelectorAll<HTMLButtonElement>("[data-inst-del]").forEach((btn) => btn.addEventListener("click", () => {
    pushUndo();
    f.instances.splice(Number(btn.dataset.instDel) || 0, 1);
    renderAll();
  }));
  qs<HTMLButtonElement>(page, "#fiAddInstance").addEventListener("click", () => {
    pushUndo();
    const master = f.masters[f.masters.length - 1];
    f.instances.push({ name: `Instance ${f.instances.length + 1}`, masterId: master?.id || f.currentMasterId, active: true, axisValues: { [axis.tag]: master?.weightValue ?? axis.defaultValue }, styleLink: "" });
    renderAll();
    setStatus("Instance added — set its name, weight, and style link in Font Info.");
  });
  const compatEl = qs<HTMLElement>(page, "#fiCompat");
  const issues = compatibilityReport(f);
  if (f.masters.length < 2) {
    compatEl.innerHTML = '<span class="hint">Add a second master (Glyph menu or Palette) to run the compatibility check.</span>';
  } else if (!issues.length) {
    compatEl.innerHTML = '<span class="hint">All glyphs are interpolation-compatible across masters.</span>';
  } else {
    const shown = issues.slice(0, 30);
    compatEl.innerHTML = `<p class="hint">${issues.length} issue(s)${issues.length > shown.length ? ` (first ${shown.length} shown)` : ""}. Fix copies the base master layer over the broken one; redraw that glyph on the target master afterwards.</p>` +
      shown.map((issue, i) => `<div class="compat-row"><span><strong>${escHtml(issue.glyphName)}</strong> · ${escHtml(issue.masterName)}: ${escHtml(issue.detail)}</span><button data-compat-open="${i}" type="button">Open glyph</button>${!issue.masterId.startsWith("inter@") ? `<button data-compat-fix="${i}" type="button">Fix: copy base layer</button>` : ""}</div>`).join("");
    compatEl.querySelectorAll<HTMLButtonElement>("[data-compat-open]").forEach((btn) => btn.addEventListener("click", () => {
      const issue = shown[Number(btn.dataset.compatOpen) || 0];
      if (!issue) return;
      $<HTMLDialogElement>("#workflowDialog").close();
      setWorkspace("edit");
      if (!issue.masterId.startsWith("inter@")) state.font.currentMasterId = issue.masterId;
      openGlyph(issue.glyphName, true);
      setStatus(`Editing ${issue.glyphName} on ${issue.masterName}: ${issue.detail}`);
    }));
    compatEl.querySelectorAll<HTMLButtonElement>("[data-compat-fix]").forEach((btn) => btn.addEventListener("click", () => {
      const issue = shown[Number(btn.dataset.compatFix) || 0];
      if (!issue) return;
      const base = [...f.masters].sort((a, b) => (a.weightValue || 0) - (b.weightValue || 0))[0];
      pushUndo();
      if (copyLayerBetweenMasters(f, issue.glyphName, base.id, issue.masterId)) {
        renderAll();
        setStatus(`Copied the ${base.name} layer of ${issue.glyphName} to ${issue.masterName} — redraw that glyph on ${issue.masterName}.`);
      } else {
        state.undoStack.pop();
        setStatus("Could not apply the fix (source layer missing).");
      }
    }));
  }
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

function editorToolLabel(tool: Tool): string {
  return tool.charAt(0).toUpperCase() + tool.slice(1);
}

function syncEditModeControls(tool: Tool): void {
  $("#app").classList.toggle("text-mode", state.editMode === "text");
  document.querySelectorAll<HTMLButtonElement>("[data-edit-mode]").forEach((button) => {
    const active = button.dataset.editMode === state.editMode;
    button.classList.toggle("is-on", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
    const active = b.dataset.tool === tool;
    b.classList.toggle("is-on", active);
    b.setAttribute("aria-pressed", String(active));
  });
  $("#canvasModeLabel").textContent = state.editMode === "text" ? "Text proof" : `Edit · ${editorToolLabel(tool)}`;
}

function setEditMode(mode: "edit" | "text", focusPreview = true): void {
  state.editMode = mode;
  const tool: Tool = mode === "text" ? "text" : lastEditTool;
  editor.setTool(tool);
  editorB.setTool(tool);
  syncEditModeControls(tool);
  if (mode === "text" && focusPreview) {
    if (workspacePrefs.previewCollapsed) toggleChromePanel("preview-collapsed", $<HTMLButtonElement>("#togglePreviewBtn"));
    const input = $<HTMLInputElement>("#previewText");
    input.focus();
    input.select();
    setStatus("Text mode: type a proof string; glyph pairs and kerning update in the canvas information bar.");
  } else if (mode === "edit") {
    setStatus(`${editorToolLabel(tool)} tool active in Edit mode.`);
  }
}

function setTool(tool: Tool): void {
  if (tool === "text") { setEditMode("text"); return; }
  lastEditTool = tool;
  state.editMode = "edit";
  editor.setTool(tool);
  editorB.setTool(tool);
  syncEditModeControls(tool);
  updateSelectionReadout();
  setStatus(tool === "pen" ? "Pen: click to place nodes, drag to pull handles, click the first node to close."
    : tool === "pencil" ? "Pencil: drag a freehand stroke — it becomes an editable open contour on release."
    : tool === "measure" ? "Measure: click two points (snaps to nodes); the readout shows distance and angle. Nothing is modified."
    : tool === "hand" ? "Hand: drag to pan, wheel to zoom. Hold Space from another tool for a temporary pan."
    : "Select: drag nodes/handles; Shift-click selects multiple nodes for alignment; arrows nudge the selection.");
}

async function exportInstanceUfo(t: number, label: string): Promise<void> {
  const g = currentGlyph();
  if (g && !mastersCompatible(state.font, g.name) && state.font.masters.length >= 2) {
    const issueCount = compatibilityReport(state.font).length;
    setStatus(`Instance export needs compatible masters — ${issueCount} issue(s) listed in Font Info. Fix outline order first.`);
    return;
  }
  const instanceFont = cloneFont(state.font);
  for (const glyph of instanceFont.glyphs) {
    const ig = interpolateGlyphAt(instanceFont, glyph.name, t);
    if (ig) glyph.layers[instanceFont.currentMasterId] = ig.layers[instanceFont.currentMasterId];
  }
  const base = (state.font.familyName || "Instance").replace(/[^\w\- ]/g, "").trim() || "Instance";
  const safeLabel = label.replace(/[^\w\- ]/g, "").trim() || "Instance";
  if (!await deliverBytes(`${base}-${safeLabel}.ufo.zip`, fontToUfoZip(instanceFont), "application/zip")) { setStatus("Export cancelled."); return; }
  setStatus(`Exported instance ${safeLabel} UFO at t=${t.toFixed(2)} (decomposed, with designspace.json manifest).`);
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
  setCompareMode(state.compareMode === "split" ? "off" : "split", false);
  if (state.compareMode === "split") {
    setStatus(state.font.masters.length < 2
      ? "Side-by-side on, but this font has one master — use + Master (copy) to create the second one."
      : "Side-by-side masters: click a pane to make it active, then draw/edit. Each pane keeps its own master.");
  } else setStatus("Side-by-side off.");
  return;
}
function toggleSplitViewLegacy(): void {
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
  const suggestion = glyphSuggestionFor(trimmed);
  const glyph: Glyph = {
    name: trimmed,
    unicode: suggestion?.unicode ?? null,
    width: 600, lsb: 40, rsb: 40, category: suggestion?.category || "Letter",
    productionName: suggestion?.production || "", glyphCase: suggestion?.glyphCase || "",
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
  state.selectedGlyphNames = new Set(state.currentGlyphName ? [state.currentGlyphName] : []);
  state.selectionAnchorName = state.currentGlyphName;
  state.focusedGlyphName = state.currentGlyphName;
  state.fontViewScroll = { grid: 0, list: 0 };
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

/** Binary font exports are proofed by fontTools readback (Phase 8)
 * before delivery; a failed proof blocks the export. */
async function proofAndDeliver(filename: string, bytes: Uint8Array<ArrayBuffer>, mime: string, success: string): Promise<void> {
  const proof = await proofExportBytes(bytes, compileService());
  const gate = proofGate(proof, isDesktop());
  if (!gate.deliver) { setStatus(`Export blocked: ${gate.note}`); return; }
  if (!await deliverBytes(filename, bytes, mime)) { setStatus("Export cancelled."); return; }
  setStatus(`${success} Proof: ${gate.note}.`);
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
  // The desktop shell starts the bundled fontc sidecar automatically;
  // a packaged sidecar can take a few seconds to unpack and listen, so
  // the desktop probe retries before declaring the service offline.
  const attempts = isDesktop() ? 8 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 900);
      const res = await fetch(`${compileService()}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const info = (await res.json()) as { fontTools?: string; brotli?: boolean };
      statusEl.textContent = `Compile service: online (fontTools ${info.fontTools ?? "?"}, brotli ${info.brotli ? "yes" : "no"}). WOFF2/variable enabled.`;
      return true;
    } catch {
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  statusEl.textContent = isDesktop()
    ? "Compile service: offline. Browser formats (OTF/TTF/WOFF) still work; the bundled service did not answer — restart the app to retry."
    : "Compile service: offline. Browser formats (OTF/TTF/WOFF) still work; start tools/fontc for WOFF2/variable.";
  return false;
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
  qs<HTMLButtonElement>(page, "#exportGo").addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const format = qs<HTMLSelectElement>(page, "#exportFormat").value;
    button.disabled = true;
    button.textContent = "Exporting…";
    button.setAttribute("aria-busy", "true");
    try { await runExport(format); } finally {
      button.disabled = false;
      button.textContent = "Export font";
      button.removeAttribute("aria-busy");
    }
  });
}

async function runExport(format: string): Promise<void> {
  const base = (state.font.familyName || "Untitled").replace(/[^\w\- ]/g, "").trim() || "Untitled";
  try {
    if (format === "otf") {
      await proofAndDeliver(`${base}.otf`, new Uint8Array(fontToOtfArrayBuffer(state.font)), "font/otf", "Exported OTF (CFF, active master).");
      return;
    }
    if (format === "ttf") {
      await proofAndDeliver(`${base}.ttf`, fontToTtfBytes(state.font), "font/ttf", "Exported TTF (glyf). Cubic curves were approximated by quadratics (tolerance 4 units).");
      return;
    }
    if (format === "woff") {
      await proofAndDeliver(`${base}.woff`, await fontToWoffBytes(fontToTtfBytes(state.font)), "font/woff", "Exported WOFF (from the TTF build).");
      return;
    }
    if (format === "woff2") {
      const res = await fetch(`${compileService()}/compile/woff2`, { method: "POST", body: fontToTtfBytes(state.font) as BlobPart });
      if (!res.ok) throw new Error(`service HTTP ${res.status}: ${await res.text()}`);
      await proofAndDeliver(`${base}.woff2`, new Uint8Array(await res.arrayBuffer()), "font/woff2", "Exported WOFF2 via the compile service.");
      return;
    }
    if (format === "variable") {
      if (state.font.masters.length < 2) { setStatus("Variable export needs at least two masters — copy a layer to a new master in the Palette first."); return; }
      const res = await fetch(`${compileService()}/compile/variable`, { method: "POST", body: fontToDesignspaceBundle(state.font) as BlobPart });
      if (!res.ok) throw new Error(`service HTTP ${res.status}: ${await res.text()}`);
      await proofAndDeliver(`${base}-Variable.ttf`, new Uint8Array(await res.arrayBuffer()), "font/ttf", "Exported variable font via the compile service. Check the default instance against the Palette interpolation ghost.");
      return;
    }
  } catch (err) {
    setStatus(`Export failed (${format}): ${(err as Error).message}. Browser formats still work without the service.`);
  }
}

function renderSampleOptions(): void {
  const select = $<HTMLSelectElement>("#sampleSelect");
  const current = $<HTMLInputElement>("#previewText").value;
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Sample…";
  select.appendChild(placeholder);
  for (const sample of allSamples(appSettings)) {
    const option = document.createElement("option");
    option.value = sample.text;
    option.textContent = sample.label;
    if (sample.text === current) option.selected = true;
    select.appendChild(option);
  }
}

function renderSettings(): void {
  $<HTMLInputElement>("#setServiceUrl").value = appSettings.compileServiceUrl;
  $<HTMLInputElement>("#setPreviewSize").value = String(appSettings.defaultPreviewSize);
  $<HTMLInputElement>("#setGuides").checked = appSettings.showGuides;
  $<HTMLInputElement>("#setNodes").checked = appSettings.showNodes;
  const samplesEl = $<HTMLElement>("#setSamples");
  samplesEl.innerHTML = appSettings.customSamples.length
    ? appSettings.customSamples.map((sample) => `<div class="compat-row"><span>${escHtml(sample)}</span><button data-sample-del="${escHtml(sample)}" type="button">Delete</button></div>`).join("")
    : '<span class="hint">No custom samples yet — use Save sample next to the preview text.</span>';
  samplesEl.querySelectorAll<HTMLButtonElement>("[data-sample-del]").forEach((button) => button.addEventListener("click", () => {
    appSettings = removeCustomSample(appSettings, button.dataset.sampleDel || "");
    persistSettings();
    renderSettings();
    renderSampleOptions();
    setStatus("Custom sample deleted.");
  }));
}

function openSettings(): void {
  renderSettings();
  const dialog = $<HTMLDialogElement>("#settingsDialog");
  if (!dialog.open) dialog.showModal();
}

function openShortcuts(): void {
  const dialog = $<HTMLDialogElement>("#shortcutsDialog");
  if (!dialog.open) dialog.showModal();
}

function openWorkflow(name: "fontinfo" | "features" | "export" = "fontinfo"): void {
  const dialog = $<HTMLDialogElement>("#workflowDialog");
  document.querySelectorAll<HTMLButtonElement>("[data-workflow]").forEach((button) => {
    const active = button.dataset.workflow === name;
    button.classList.toggle("is-on", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll<HTMLElement>(".workflow-page").forEach((page) => page.classList.toggle("is-on", page.id === `side-${name}`));
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-workflow="${name}"]`)?.focus());
}

function dispatch(cmd: string): void {
  const g = currentGlyph();
  switch (cmd) {
    case "new":
      if (!confirm("Start a new font? Unsaved changes in this tab will be lost (export first if needed).")) return;
      state.font = createDefaultFont(); state.undoStack = []; state.redoStack = [];
      state.currentGlyphName = "A"; state.openTabs = ["A"];
      state.selectedGlyphNames = new Set(["A"]); state.selectionAnchorName = "A"; state.focusedGlyphName = "A";
      state.fontViewScroll = { grid: 0, list: 0 };
      editor.setGlyph(state.font, currentGlyph()); renderAll(); setStatus("New font — Handbook Sans starter set.");
      break;
    case "open": openFontFlow(); break;
    case "save-glyphs": void saveGlyphs(); break;
    case "save-glyphs-json": void saveGlyphsJson(); break;
    case "export-ufo": void exportUfo(); break;
    case "export-font": openWorkflow("export"); break;
    case "undo": undo(); break;
    case "redo": redo(); break;
    case "delete-sel": activeEd.deleteSelected(); break;
    case "close-path": activeEd.closeActivePath(); break;
    case "cut-path": activeEd.cutSelectedPath(); break;
    case "convert": activeEd.convertSelected(); break;
    case "zoom-in": activeEd.zoomBy(1.25); break;
    case "zoom-out": activeEd.zoomBy(1 / 1.25); break;
    case "zoom-fit": activeEd.zoomFit(); break;
    case "toggle-guides": setStatus(`Guides ${activeEd.toggleGuides() ? "on" : "off"}.`); break;
    case "toggle-nodes": setStatus(`Nodes ${activeEd.toggleNodes() ? "shown" : "hidden"}.`); break;
    case "toggle-navigator":
      if (state.workspace === "font") setStatus("The category navigator is part of Font View and stays visible there.");
      else toggleChromePanel("left-collapsed", $<HTMLButtonElement>("#toggleLeftBtn"));
      break;
    case "toggle-inspector": toggleChromePanel("right-collapsed", $<HTMLButtonElement>("#toggleRightBtn")); break;
    case "toggle-preview": toggleChromePanel("preview-collapsed", $<HTMLButtonElement>("#togglePreviewBtn")); break;
    case "reset-layout": resetWorkspaceLayout(); break;
    case "shortcuts": openShortcuts(); break;
    case "settings": openSettings(); break;
    case "add-glyph": addGlyphFlow(); break;
    case "create-composite": createCompositeFlow(); break;
    case "add-rect": if (g) activeEd.addContour(rectContour(80, 0, 360, 500)); break;
    case "add-ellipse": if (g) activeEd.addContour(ellipseContour(300, 250, 220, 250)); break;
    default: break;
  }
}

type PaneDimension = "leftPanel" | "rightPanel" | "previewHeight" | "previewWidth";

function persistWorkspacePrefs(): void {
  try {
    localStorage.setItem(WORKSPACE_PREFS_KEY, JSON.stringify(workspacePrefs));
  } catch {
    // The workspace remains usable when storage is blocked or unavailable.
  }
}

function dimensionLimits(dimension: PaneDimension): { min: number; max: number } {
  if (dimension === "leftPanel") return { min: 176, max: 340 };
  if (dimension === "rightPanel") return { min: 236, max: 380 };
  if (dimension === "previewWidth") {
    const editWidth = $("#editview").getBoundingClientRect().width;
    return { min: 230, max: Math.max(280, Math.min(520, Math.round(editWidth * .48) || 520)) };
  }
  const editHeight = $("#editview").getBoundingClientRect().height;
  return { min: 82, max: Math.max(120, Math.min(360, Math.round(editHeight * .48) || 360)) };
}

function applyPaneDimension(dimension: PaneDimension, value: number, commit = false): void {
  const { min, max } = dimensionLimits(dimension);
  const next = clampNumber(value, workspacePrefs[dimension], min, max);
  workspacePrefs[dimension] = next;
  const cssName = dimension === "leftPanel" ? "--left-panel-pref"
    : dimension === "rightPanel" ? "--right-panel-pref"
      : dimension === "previewWidth" ? "--preview-width" : "--preview-height";
  ($<HTMLElement>("#app")).style.setProperty(cssName, `${next}px`);
  const separator = dimension === "leftPanel" ? $("#leftResize") : dimension === "rightPanel" ? $("#rightResize") : $("#previewResize");
  separator.setAttribute("aria-valuenow", String(next));
  separator.setAttribute("aria-valuemax", String(max));
  if (commit) {
    persistWorkspacePrefs();
    requestAnimationFrame(() => {
      editor.refresh(state.font, currentGlyph());
      refreshPaneB(false);
    });
  }
}

function updateChromeToggleLabels(): void {
  const controls: Array<[string, string, boolean]> = [
    ["#toggleLeftBtn", "glyph navigator", !workspacePrefs.leftCollapsed],
    ["#toggleRightBtn", "inspector", !workspacePrefs.rightCollapsed],
    ["#togglePreviewBtn", "preview", !workspacePrefs.previewCollapsed],
  ];
  for (const [selector, name, expanded] of controls) {
    const button = $<HTMLButtonElement>(selector);
    const label = selector === "#toggleLeftBtn" && state.workspace === "font"
      ? "Navigator remains visible in Font View"
      : `${expanded ? "Hide" : "Show"} ${name}`;
    button.title = label;
    button.setAttribute("aria-label", label);
  }
  const previewButton = $<HTMLButtonElement>("#collapsePreviewBtn");
  const previewLabel = workspacePrefs.previewCollapsed ? "Expand preview" : "Collapse preview";
  previewButton.title = previewLabel;
  previewButton.setAttribute("aria-label", previewLabel);
  const dockButton = $<HTMLButtonElement>("#dockPreviewBtn");
  const dockLabel = workspacePrefs.previewDock === "bottom" ? "Dock preview on the right" : "Dock preview below the canvas";
  dockButton.title = dockLabel;
  dockButton.setAttribute("aria-label", dockLabel);
  $("#previewDockLabel").textContent = workspacePrefs.previewDock === "bottom" ? "Bottom" : "Right";
}

function syncChromePrefs(): void {
  const app = $<HTMLElement>("#app");
  app.style.setProperty("--left-panel-pref", `${workspacePrefs.leftPanel}px`);
  app.style.setProperty("--right-panel-pref", `${workspacePrefs.rightPanel}px`);
  app.style.setProperty("--preview-height", `${workspacePrefs.previewHeight}px`);
  app.style.setProperty("--preview-width", `${workspacePrefs.previewWidth}px`);
  app.classList.toggle("left-collapsed", workspacePrefs.leftCollapsed);
  app.classList.toggle("right-collapsed", workspacePrefs.rightCollapsed);
  app.classList.toggle("preview-collapsed", workspacePrefs.previewCollapsed);
  app.classList.toggle("preview-dock-right", workspacePrefs.previewDock === "right");
  for (const [selector, expanded] of [
    ["#toggleLeftBtn", !workspacePrefs.leftCollapsed],
    ["#toggleRightBtn", !workspacePrefs.rightCollapsed],
    ["#togglePreviewBtn", !workspacePrefs.previewCollapsed],
  ] as const) {
    const button = $<HTMLButtonElement>(selector);
    button.classList.toggle("is-on", expanded);
    button.setAttribute("aria-pressed", String(expanded));
  }
  updateChromeToggleLabels();
  applyPaneDimension("leftPanel", workspacePrefs.leftPanel);
  applyPaneDimension("rightPanel", workspacePrefs.rightPanel);
  applyPaneDimension("previewHeight", workspacePrefs.previewHeight);
  applyPaneDimension("previewWidth", workspacePrefs.previewWidth);
  const previewResize = $("#previewResize");
  const previewDimension: PaneDimension = workspacePrefs.previewDock === "right" ? "previewWidth" : "previewHeight";
  const previewLimits = dimensionLimits(previewDimension);
  previewResize.setAttribute("aria-orientation", workspacePrefs.previewDock === "right" ? "vertical" : "horizontal");
  previewResize.setAttribute("aria-label", `Resize ${workspacePrefs.previewDock}-docked preview`);
  previewResize.setAttribute("aria-valuemin", String(previewLimits.min));
  previewResize.setAttribute("aria-valuemax", String(previewLimits.max));
  previewResize.setAttribute("aria-valuenow", String(workspacePrefs[previewDimension]));
}

function resetWorkspaceLayout(): void {
  Object.assign(workspacePrefs, DEFAULT_WORKSPACE_PREFS);
  syncChromePrefs();
  persistWorkspacePrefs();
  requestAnimationFrame(() => {
    editor.zoomFit();
    if (state.splitView) editorB.zoomFit();
  });
  setStatus("Workspace layout reset — navigator, inspector, and preview restored to their defaults.");
}

function setupPaneResizer(selector: string, dimension: PaneDimension): void {
  const separator = $<HTMLElement>(selector);
  separator.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const origin = event.clientX;
    const initial = workspacePrefs[dimension];
    separator.setPointerCapture(event.pointerId);
    separator.classList.add("is-dragging");
    document.body.classList.add("is-resizing");
    const move = (nextEvent: PointerEvent) => {
      const pointer = nextEvent.clientX;
      const delta = pointer - origin;
      const signedDelta = dimension === "rightPanel" ? -delta : delta;
      applyPaneDimension(dimension, initial + signedDelta);
    };
    const finish = () => {
      separator.removeEventListener("pointermove", move);
      separator.removeEventListener("pointerup", finish);
      separator.removeEventListener("pointercancel", finish);
      separator.classList.remove("is-dragging");
      document.body.classList.remove("is-resizing");
      applyPaneDimension(dimension, workspacePrefs[dimension], true);
    };
    separator.addEventListener("pointermove", move);
    separator.addEventListener("pointerup", finish);
    separator.addEventListener("pointercancel", finish);
  });
  separator.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 32 : 8;
    let delta = 0;
    if (dimension === "leftPanel") delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    if (dimension === "rightPanel") delta = event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0;
    const { min, max } = dimensionLimits(dimension);
    if (event.key === "Home") delta = min - workspacePrefs[dimension];
    if (event.key === "End") delta = max - workspacePrefs[dimension];
    if (!delta) return;
    event.preventDefault();
    applyPaneDimension(dimension, workspacePrefs[dimension] + delta, true);
  });
  separator.addEventListener("dblclick", () => {
    applyPaneDimension(dimension, DEFAULT_WORKSPACE_PREFS[dimension], true);
  });
}

function setupPreviewResizer(): void {
  const separator = $<HTMLElement>("#previewResize");
  separator.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const right = workspacePrefs.previewDock === "right";
    const dimension: PaneDimension = right ? "previewWidth" : "previewHeight";
    const origin = right ? event.clientX : event.clientY;
    const initial = workspacePrefs[dimension];
    separator.setPointerCapture(event.pointerId);
    separator.classList.add("is-dragging");
    document.body.classList.add("is-resizing", "is-resizing-preview");
    const move = (nextEvent: PointerEvent) => {
      const pointer = right ? nextEvent.clientX : nextEvent.clientY;
      applyPaneDimension(dimension, initial - (pointer - origin));
    };
    const finish = () => {
      separator.removeEventListener("pointermove", move);
      separator.removeEventListener("pointerup", finish);
      separator.removeEventListener("pointercancel", finish);
      separator.classList.remove("is-dragging");
      document.body.classList.remove("is-resizing", "is-resizing-preview");
      applyPaneDimension(dimension, workspacePrefs[dimension], true);
    };
    separator.addEventListener("pointermove", move);
    separator.addEventListener("pointerup", finish);
    separator.addEventListener("pointercancel", finish);
  });
  separator.addEventListener("keydown", (event) => {
    const right = workspacePrefs.previewDock === "right";
    const dimension: PaneDimension = right ? "previewWidth" : "previewHeight";
    const step = event.shiftKey ? 32 : 8;
    let delta = 0;
    if (right) delta = event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0;
    else delta = event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
    const { min, max } = dimensionLimits(dimension);
    if (event.key === "Home") delta = min - workspacePrefs[dimension];
    if (event.key === "End") delta = max - workspacePrefs[dimension];
    if (!delta) return;
    event.preventDefault();
    applyPaneDimension(dimension, workspacePrefs[dimension] + delta, true);
  });
  separator.addEventListener("dblclick", () => {
    const dimension: PaneDimension = workspacePrefs.previewDock === "right" ? "previewWidth" : "previewHeight";
    applyPaneDimension(dimension, DEFAULT_WORKSPACE_PREFS[dimension], true);
  });
}

function togglePreviewDock(): void {
  workspacePrefs.previewDock = workspacePrefs.previewDock === "bottom" ? "right" : "bottom";
  syncChromePrefs();
  persistWorkspacePrefs();
  requestAnimationFrame(() => {
    editor.resizeViewport();
    if (state.splitView) editorB.resizeViewport();
  });
  setStatus(`Preview docked ${workspacePrefs.previewDock === "bottom" ? "below the canvas" : "to the right of the canvas"}.`);
}

function toggleChromePanel(className: "left-collapsed" | "right-collapsed" | "preview-collapsed", button: HTMLButtonElement): void {
  const collapsed = $("#app").classList.toggle(className);
  button.classList.toggle("is-on", !collapsed);
  button.setAttribute("aria-pressed", String(!collapsed));
  if (className === "left-collapsed") workspacePrefs.leftCollapsed = collapsed;
  if (className === "right-collapsed") workspacePrefs.rightCollapsed = collapsed;
  if (className === "preview-collapsed") workspacePrefs.previewCollapsed = collapsed;
  updateChromeToggleLabels();
  persistWorkspacePrefs();
  requestAnimationFrame(() => {
    editor.refresh(state.font, currentGlyph());
    refreshPaneB(false);
  });
}

document.querySelectorAll<HTMLButtonElement>("[data-cmd]").forEach((b) => b.addEventListener("click", () => { const cmd = b.dataset.cmd; if (cmd) dispatch(cmd); }));
document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => b.addEventListener("click", () => setTool((b.dataset.tool || "select") as Tool)));
document.querySelectorAll<HTMLButtonElement>("[data-edit-mode]").forEach((button) => button.addEventListener("click", () => {
  setEditMode(button.dataset.editMode === "text" ? "text" : "edit");
}));
document.querySelectorAll<HTMLButtonElement>("[data-nav-scope]").forEach((button) => button.addEventListener("click", () => {
  state.editNavScope = (button.dataset.navScope || "all") as EditNavigatorScope;
  workspacePrefs.editNavScope = state.editNavScope;
  persistWorkspacePrefs();
  renderFontView();
  setStatus(`Glyph navigator scope: ${button.textContent?.trim() || "All"}.`);
}));
document.querySelectorAll<HTMLButtonElement>("[data-side]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll<HTMLButtonElement>("[data-side]").forEach((x) => x.classList.toggle("is-on", x === b));
  document.querySelectorAll<HTMLElement>(".side-page").forEach((p) => p.classList.toggle("is-on", p.id === `side-${b.dataset.side}`));
}));
$("#workflowLauncher").addEventListener("click", () => openWorkflow("fontinfo"));
$("#closeWorkflowDialog").addEventListener("click", () => $<HTMLDialogElement>("#workflowDialog").close());
document.querySelectorAll<HTMLButtonElement>("[data-workflow]").forEach((button) => button.addEventListener("click", () => {
  openWorkflow((button.dataset.workflow || "fontinfo") as "fontinfo" | "features" | "export");
}));
$<HTMLDialogElement>("#workflowDialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) $<HTMLDialogElement>("#workflowDialog").close();
});
$("#gridModeBtn").addEventListener("click", () => {
  state.fontViewScroll[state.fontViewMode] = $<HTMLElement>("#glyphGrid").scrollTop;
  state.fontViewMode = "grid";
  persistFontViewPrefs();
  renderFontView();
});
$("#listModeBtn").addEventListener("click", () => {
  state.fontViewScroll[state.fontViewMode] = $<HTMLElement>("#glyphGrid").scrollTop;
  state.fontViewMode = "list";
  persistFontViewPrefs();
  renderFontView();
});
{
  const filterSel = $<HTMLSelectElement>("#fvFilter");
  for (const f of GLYPH_FILTERS) {
    const opt = document.createElement("option");
    opt.value = f.id; opt.textContent = f.label;
    filterSel.appendChild(opt);
  }
  filterSel.value = state.glyphFilter;
  filterSel.addEventListener("change", () => {
    state.glyphFilter = filterSel.value as GlyphFilter;
    state.activeSavedFilterId = "";
    state.fontViewScroll[state.fontViewMode] = 0;
    persistFontViewPrefs();
    renderFontView();
  });
  const sortSel = $<HTMLSelectElement>("#fvSort");
  sortSel.value = state.glyphSort;
  sortSel.addEventListener("change", () => {
    state.glyphSort = sortSel.value as GlyphSortMode;
    state.activeSavedFilterId = "";
    state.fontViewScroll[state.fontViewMode] = 0;
    persistFontViewPrefs();
    renderFontView();
  });
}
$<HTMLSelectElement>("#fvSavedFilter").addEventListener("change", (event) => {
  const id = (event.target as HTMLSelectElement).value;
  if (id) applySavedFilter(id);
});
$("#saveFilterBtn").addEventListener("click", () => {
  const proposed = prompt("Name this saved Font View:", "Working set");
  const name = proposed?.trim();
  if (!name) return;
  const existing = fontViewPrefs.savedFilters.find((preset) => preset.name.toLowerCase() === name.toLowerCase());
  const preset: SavedFontFilter = {
    id: existing?.id || `filter-${Date.now().toString(36)}`,
    name,
    ...currentFontViewSettings(),
  };
  if (existing) Object.assign(existing, preset); else fontViewPrefs.savedFilters.push(preset);
  state.activeSavedFilterId = preset.id;
  persistFontViewPrefs();
  renderSavedFilters();
  setStatus(`Saved filter “${name}”.`);
});
$("#deleteFilterBtn").addEventListener("click", () => {
  const active = fontViewPrefs.savedFilters.find((preset) => preset.id === state.activeSavedFilterId);
  if (!active) return;
  fontViewPrefs.savedFilters = fontViewPrefs.savedFilters.filter((preset) => preset.id !== active.id);
  state.activeSavedFilterId = "";
  persistFontViewPrefs();
  renderSavedFilters();
  setStatus(`Deleted saved filter “${active.name}”.`);
});
$("#applyInfoBtn").addEventListener("click", () => {
  if (!state.selectedGlyphNames.size) return;
  pushUndo();
  const changed = applyGlyphInfo(state.font, state.selectedGlyphNames);
  if (!changed) state.undoStack.pop();
  renderAll();
  setStatus(changed ? `Glyph info applied to ${changed} selected glyph(s).` : "Glyph info is already complete for the selected glyphs.");
});
$("#moveGlyphPrevBtn").addEventListener("click", () => {
  pushUndo();
  if (!moveGlyphInOrder(state.font, state.currentGlyphName, -1)) { state.undoStack.pop(); setStatus(`${state.currentGlyphName} is already first in the glyph order.`); return; }
  renderAll();
  setStatus(`${state.currentGlyphName} moved earlier in the glyph order.`);
});
$("#moveGlyphNextBtn").addEventListener("click", () => {
  pushUndo();
  if (!moveGlyphInOrder(state.font, state.currentGlyphName, 1)) { state.undoStack.pop(); setStatus(`${state.currentGlyphName} is already last in the glyph order.`); return; }
  renderAll();
  setStatus(`${state.currentGlyphName} moved later in the glyph order.`);
});
$("#batchCategoryBtn").addEventListener("click", () => {
  const selected = state.font.glyphs.filter((glyph) => state.selectedGlyphNames.has(glyph.name));
  if (!selected.length) { setStatus("Select one or more glyphs first."); return; }
  const value = prompt(`Category for ${selected.length} selected glyph(s). One of: ${GLYPH_CATEGORIES.join(", ")}`, selected[0].category || "Letter");
  if (value == null) return;
  const category = GLYPH_CATEGORIES.find((c) => c.toLowerCase() === value.trim().toLowerCase());
  if (!category) { setStatus(`Unknown category "${value.trim()}" — use one of: ${GLYPH_CATEGORIES.join(", ")}.`); return; }
  pushUndo();
  for (const g of selected) g.category = category;
  renderAll();
  setStatus(`Category ${category} applied to ${selected.length} selected glyph(s).`);
});
$("#clearSelectionBtn").addEventListener("click", () => {
  state.selectedGlyphNames.clear();
  updateFontViewSelectionUI();
  setStatus("Font View selection cleared.");
});
$("#deleteSelectedBtn").addEventListener("click", () => {
  const selected = state.font.glyphs.filter((glyph) => state.selectedGlyphNames.has(glyph.name));
  if (!selected.length) return;
  if (selected.length >= state.font.glyphs.length) { setStatus("Keep at least one glyph in the font."); return; }
  if (!confirm(`Delete ${selected.length} selected glyph${selected.length === 1 ? "" : "s"}? This can be undone.`)) return;
  pushUndo();
  const names = new Set(selected.map((glyph) => glyph.name));
  state.font.glyphs = state.font.glyphs.filter((glyph) => !names.has(glyph.name));
  state.openTabs = state.openTabs.filter((name) => !names.has(name));
  state.currentGlyphName = state.font.glyphs[0].name;
  state.selectedGlyphNames = new Set([state.currentGlyphName]);
  state.selectionAnchorName = state.currentGlyphName;
  state.focusedGlyphName = state.currentGlyphName;
  editor.setGlyph(state.font, currentGlyph());
  renderAll();
  setStatus(`Deleted ${selected.length} glyph${selected.length === 1 ? "" : "s"}.`);
});
$("#wsFontBtn").addEventListener("click", () => setWorkspace("font"));
$("#wsEditBtn").addEventListener("click", () => setWorkspace("edit"));
$("#toggleLeftBtn").addEventListener("click", (ev) => toggleChromePanel("left-collapsed", ev.currentTarget as HTMLButtonElement));
$("#toggleRightBtn").addEventListener("click", (ev) => toggleChromePanel("right-collapsed", ev.currentTarget as HTMLButtonElement));
$("#togglePreviewBtn").addEventListener("click", (ev) => toggleChromePanel("preview-collapsed", ev.currentTarget as HTMLButtonElement));
$("#collapsePreviewBtn").addEventListener("click", () => {
  const button = $<HTMLButtonElement>("#togglePreviewBtn");
  toggleChromePanel("preview-collapsed", button);
});
setupPaneResizer("#leftResize", "leftPanel");
setupPaneResizer("#rightResize", "rightPanel");
setupPreviewResizer();
$("#previousGlyphBtn").addEventListener("click", () => navigateGlyph(-1));
$("#nextGlyphBtn").addEventListener("click", () => navigateGlyph(1));
$("#zoomOutBtn").addEventListener("click", () => activeEd.zoomBy(1 / 1.25));
$("#zoomInBtn").addEventListener("click", () => activeEd.zoomBy(1.25));
$("#zoomFitBtn").addEventListener("click", () => activeEd.zoomFit());
$("#dockPreviewBtn").addEventListener("click", togglePreviewDock);
$<HTMLInputElement>("#cellSize").value = String(state.cellSize);
$<HTMLInputElement>("#cellSize").addEventListener("input", (ev) => {
  state.cellSize = +(ev.target as HTMLInputElement).value || 88;
  persistFontViewPrefs();
  renderFontView();
});
let fontSearchTimer = 0;
$<HTMLInputElement>("#glyphSearch").addEventListener("input", () => {
  state.activeSavedFilterId = "";
  state.fontViewScroll[state.fontViewMode] = 0;
  window.clearTimeout(fontSearchTimer);
  fontSearchTimer = window.setTimeout(renderFontView, 70);
});
$<HTMLElement>("#glyphGrid").addEventListener("keydown", handleFontViewKeydown);
$<HTMLElement>("#glyphGrid").addEventListener("scroll", () => {
  state.fontViewScroll[state.fontViewMode] = $<HTMLElement>("#glyphGrid").scrollTop;
}, { passive: true });
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
$("#moreSplitBtn").addEventListener("click", toggleSplitView);
$("#moreAddMasterBtn").addEventListener("click", addMasterCopy);
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
$("#cutPathBtn").addEventListener("click", () => dispatch("cut-path"));
$("#convertBtn").addEventListener("click", () => dispatch("convert"));
$("#deleteBtn").addEventListener("click", () => dispatch("delete-sel"));
$("#undoBtn").addEventListener("click", () => dispatch("undo"));
$("#redoBtn").addEventListener("click", () => dispatch("redo"));
document.querySelectorAll<HTMLButtonElement>(".tool-popover .tool-menu button").forEach((button) => {
  button.addEventListener("click", () => button.closest("details")?.removeAttribute("open"));
});

let spacePanning = false;
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
  if (mod && ev.altKey && ev.key === "0") { ev.preventDefault(); resetWorkspaceLayout(); return; }
  if (mod && ev.key === ",") { ev.preventDefault(); openSettings(); return; }
  if (!typing && ev.key === "?") { ev.preventDefault(); openShortcuts(); return; }
  if (typing) return;
  if (ev.key === "[") { ev.preventDefault(); navigateMaster(-1); return; }
  if (ev.key === "]") { ev.preventDefault(); navigateMaster(1); return; }
  if (ev.key === ",") { ev.preventDefault(); setAxisT(state.axisT - (ev.shiftKey ? 0.1 : 0.02), true); return; }
  if (ev.key === ".") { ev.preventDefault(); setAxisT(state.axisT + (ev.shiftKey ? 0.1 : 0.02), true); return; }
  if (ev.altKey && ev.key === "ArrowLeft") { ev.preventDefault(); navigateGlyph(-1); return; }
  if (ev.altKey && ev.key === "ArrowRight") { ev.preventDefault(); navigateGlyph(1); return; }
  if (ev.code === "Space" && state.editMode === "edit" && !spacePanning) {
    ev.preventDefault();
    spacePanning = true;
    editor.setTool("hand"); editorB.setTool("hand");
    document.body.classList.add("is-space-panning");
    $("#canvasModeLabel").textContent = "Edit · Temporary pan";
    return;
  }
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
  if (k === "t") setEditMode("text");
});
document.addEventListener("keyup", (ev) => {
  if (ev.code !== "Space" || !spacePanning) return;
  spacePanning = false;
  document.body.classList.remove("is-space-panning");
  const tool: Tool = state.editMode === "text" ? "text" : lastEditTool;
  editor.setTool(tool); editorB.setTool(tool);
  syncEditModeControls(tool);
});

// Menus: click toggles (touch/keyboard); moving the mouse across the
// menubar switches only while a menu is already open. Escape and outside
// clicks close; aria-expanded tracks the open state.
function closeMenus(except?: HTMLElement): void {
  document.querySelectorAll<HTMLElement>(".menu").forEach((menu) => {
    if (menu === except) return;
    menu.classList.remove("is-open");
    menu.querySelector<HTMLButtonElement>(".menu-btn")?.setAttribute("aria-expanded", "false");
  });
}
document.querySelectorAll<HTMLElement>(".menu").forEach((menu) => {
  const btn = menu.querySelector<HTMLButtonElement>(".menu-btn");
  if (!btn) return;
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const willOpen = !menu.classList.contains("is-open");
    closeMenus();
    menu.classList.toggle("is-open", willOpen);
    btn.setAttribute("aria-expanded", String(willOpen));
  });
  menu.querySelectorAll<HTMLButtonElement>(".menu-drop button").forEach((item) => {
    item.addEventListener("click", () => closeMenus());
  });
  menu.addEventListener("pointerenter", (ev) => {
    if (ev.pointerType !== "mouse") return;
    const open = document.querySelector<HTMLElement>(".menu.is-open");
    if (!open || open === menu) return;
    closeMenus();
    menu.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
  });
});
document.addEventListener("click", () => closeMenus());
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  const open = document.querySelector<HTMLElement>(".menu.is-open");
  closeMenus();
  open?.querySelector<HTMLButtonElement>(".menu-btn")?.focus();
});

// R6: lightweight context menus (glyph items + canvas). Keyboard: focus
// lands on the first item, Escape/outside click closes, arrows move.
interface ContextItem { label: string; run: () => void; disabled?: boolean }
function closeContextMenu(): void {
  const menu = $<HTMLElement>("#contextMenu");
  menu.hidden = true;
  menu.innerHTML = "";
}
function openContextMenu(x: number, y: number, items: ContextItem[]): void {
  const menu = $<HTMLElement>("#contextMenu");
  menu.innerHTML = "";
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = item.label;
    button.disabled = Boolean(item.disabled);
    button.addEventListener("click", () => { closeContextMenu(); item.run(); });
    menu.appendChild(button);
  }
  menu.hidden = false;
  const width = 220, height = Math.max(36, items.length * 30 + 8);
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 8))}px`;
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}
$<HTMLElement>("#glyphGrid").addEventListener("contextmenu", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-glyph-name]");
  if (!target?.dataset.glyphName) return;
  event.preventDefault();
  const name = target.dataset.glyphName;
  const glyph = findGlyph(state.font, name);
  if (!glyph) return;
  if (!state.selectedGlyphNames.has(name)) {
    state.selectedGlyphNames = new Set([name]);
    state.focusedGlyphName = name;
    updateFontViewSelectionUI();
  }
  openContextMenu(event.clientX, event.clientY, [
    { label: `Open ${name} in Edit View`, run: () => { setWorkspace("edit"); openGlyph(name, true); } },
    { label: "Apply glyph info to selection", run: () => $<HTMLButtonElement>("#applyInfoBtn").click(), disabled: !state.selectedGlyphNames.size },
    { label: state.font.masters.length >= 2 ? `Check ${name} compatibility` : "Add a second master to check compatibility", run: () => { setWorkspace("edit"); openGlyph(name, false); openWorkflow("fontinfo"); }, disabled: state.font.masters.length < 2 },
    { label: "Delete selected glyph(s)", run: () => $<HTMLButtonElement>("#deleteSelectedBtn").click(), disabled: !state.selectedGlyphNames.size },
  ]);
});
$<SVGSVGElement>("#editorSvg").addEventListener("contextmenu", (event) => {
  event.preventDefault();
  openContextMenu(event.clientX, event.clientY, [
    { label: "Select tool (V)", run: () => setTool("select") },
    { label: "Pen tool (P)", run: () => setTool("pen") },
    { label: "Overlay compare", run: () => setCompareMode("overlay"), disabled: state.font.masters.length < 2 },
    { label: "Split masters", run: () => setCompareMode("split"), disabled: state.font.masters.length < 2 },
    { label: "Keyboard shortcuts (?)", run: () => openShortcuts() },
  ]);
});
document.addEventListener("pointerdown", (event) => {
  const menu = $<HTMLElement>("#contextMenu");
  if (!menu.hidden && !(event.target as HTMLElement).closest("#contextMenu")) closeContextMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeContextMenu();
});
$<HTMLDialogElement>("#shortcutsDialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) $<HTMLDialogElement>("#shortcutsDialog").close();
});
$("#closeShortcutsDialog").addEventListener("click", () => $<HTMLDialogElement>("#shortcutsDialog").close());
$<HTMLSelectElement>("#sampleSelect").addEventListener("change", (event) => {
  const text = (event.target as HTMLSelectElement).value;
  if (!text) return;
  $<HTMLInputElement>("#previewText").value = text;
  renderPreview();
  setStatus("Sample string applied to the preview.");
});
$("#saveSampleBtn").addEventListener("click", () => {
  const text = $<HTMLInputElement>("#previewText").value;
  const before = appSettings.customSamples.length;
  appSettings = addCustomSample(appSettings, text);
  persistSettings();
  renderSampleOptions();
  setStatus(appSettings.customSamples.length > before ? "Custom sample saved — find it under Sample… or in Settings." : "That sample is already saved (or empty).");
});
$<HTMLInputElement>("#setServiceUrl").addEventListener("change", (event) => {
  appSettings = normalizeSettings({ ...appSettings, compileServiceUrl: (event.target as HTMLInputElement).value });
  persistSettings();
  renderSettings();
  setStatus(`Compile service: ${compileService()} — checked again on the next export.`);
});
$<HTMLInputElement>("#setPreviewSize").addEventListener("change", (event) => {
  appSettings = normalizeSettings({ ...appSettings, defaultPreviewSize: +(event.target as HTMLInputElement).value || 48 });
  persistSettings();
  $<HTMLInputElement>("#previewSize").value = String(appSettings.defaultPreviewSize);
  renderPreview();
  setStatus(`Default preview size: ${appSettings.defaultPreviewSize}.`);
});
$<HTMLInputElement>("#setGuides").addEventListener("change", (event) => {
  appSettings = { ...appSettings, showGuides: (event.target as HTMLInputElement).checked };
  persistSettings();
  setStatus("Guide preference saved — applies to editors opened from now on and at next launch.");
});
$<HTMLInputElement>("#setNodes").addEventListener("change", (event) => {
  appSettings = { ...appSettings, showNodes: (event.target as HTMLInputElement).checked };
  persistSettings();
  setStatus("Node preference saved — applies to editors opened from now on and at next launch.");
});
$("#setResetLayout").addEventListener("click", () => { resetWorkspaceLayout(); });
$("#setResetAll").addEventListener("click", () => {
  appSettings = parseSettings(null);
  persistSettings();
  renderSettings();
  renderSampleOptions();
  $<HTMLInputElement>("#previewSize").value = String(appSettings.defaultPreviewSize);
  renderPreview();
  setStatus("All settings reset to defaults.");
});
$<HTMLDialogElement>("#settingsDialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) $<HTMLDialogElement>("#settingsDialog").close();
});
$("#closeSettingsDialog").addEventListener("click", () => $<HTMLDialogElement>("#settingsDialog").close());

// Boot settings: stored preferences override the compiled defaults.
try { appSettings = parseSettings(localStorage.getItem(SETTINGS_KEY)); } catch { appSettings = parseSettings(null); }
$<HTMLInputElement>("#previewSize").value = String(appSettings.defaultPreviewSize);

// Boot. In the Electron shell the native menu drives the same commands.
$("#app").classList.toggle("is-desktop", isDesktop());
syncChromePrefs();
$<HTMLButtonElement>("#toggleLeftBtn").disabled = state.workspace === "font";
onDesktopMenuCommand((command) => dispatch(command));
editor.setGlyph(state.font, currentGlyph());
if (!appSettings.showGuides) { editor.toggleGuides(); editorB.toggleGuides(); }
if (!appSettings.showNodes) { editor.toggleNodes(); editorB.toggleNodes(); }
renderSampleOptions();
renderAll();
if (state.splitView) {
  editorB.setMasterOverride(state.paneBMasterId || null);
  editorB.setGlyph(state.font, currentGlyph());
  updateComparisonGhosts();
}
setTool("select");
