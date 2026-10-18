// SVG Edit View: pan/zoom, pen + select + hand tools, nodes/handles,
// metrics and guides. Font coords are Y-up; screen coords are Y-down.
import { contourToPathD, glyphBounds, resolveGlyphContours, pencilContour, measureBetween, alignPoints } from "./model.ts";
import { cutContourAt } from "./pathsurgery.ts";
import type { AlignMode, Bounds, Contour, Font, FontNode, Glyph, GlyphLayer, Measurement } from "./model.ts";

const SVGNS = "http://www.w3.org/2000/svg";
function el(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const n = document.createElementNS(SVGNS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

export type Tool = "select" | "pen" | "pencil" | "measure" | "hand" | "text";
export interface GhostLayer { d: string; kind: "master" | "interp" }
export interface Selection { pathIdx: number; nodeIdx: number }
export interface FontPoint { x: number; y: number }
export interface MeasureInfo extends Measurement { ax: number; ay: number; bx: number; by: number }
type Drag =
  | { kind: "pan"; px: number; py: number; tx: number; ty: number }
  | { kind: "pen"; pathIdx: number; nodeIdx: number; anchor: FontPoint; pulled: boolean }
  | { kind: "pencil" }
  | { kind: "node"; last: FontPoint; began: boolean };

export interface EditorHooks {
  onBeginChange?: (label: string) => void;
  onMutate?: () => void;
  onEndChange?: () => void;
  onCoord?: (fp: FontPoint & { px: number; py: number }) => void;
  onStatus?: (msg: string) => void;
  onTextFocus?: () => void;
  onRender?: (info: { bounds: Bounds | null; scale: number }) => void;
  onMeasure?: (info: MeasureInfo | null) => void;
  onActivate?: () => void;
}

export interface Editor {
  setGlyph: (font: Font | null, glyph: Glyph | null) => void;
  render: () => void;
  zoomFit: () => void;
  refresh: (font: Font | null, glyph: Glyph | null) => void;
  setTool: (tool: Tool) => void;
  zoomBy: (f: number) => void;
  resizeViewport: () => void;
  toggleGuides: () => boolean;
  toggleNodes: () => boolean;
  deleteSelected: () => void;
  cutSelectedPath: () => void;
  closeActivePath: () => void;
  convertSelected: () => void;
  addContour: (contour: Contour) => void;
  nudgeSelected: (dx: number, dy: number) => void;
  getSelected: () => Selection | null;
  setGhostD: (d: string | null) => void;
  setGhostLayers: (layers: GhostLayer[], opacity?: number) => void;
  setMasterOverride: (masterId: string | null) => void;
  alignSelection: (mode: AlignMode) => void;
  getSelectionCount: () => number;
}

interface EditorState {
  font: Font | null; glyph: Glyph | null; tool: Tool;
  scale: number; tx: number; ty: number;
  showGuides: boolean; showNodes: boolean;
  selected: Selection | null; selectionSet: Selection[]; activePathIdx: number;
  pendingHandle: FontPoint | null; drag: Drag | null;
  ghostD: string | null;
  ghostLayers: GhostLayer[];
  ghostOpacity: number;
  masterOverride: string | null;
  pencilPts: FontPoint[] | null;
  measureA: FontPoint | null; measureB: FontPoint | null; measureFixed: boolean;
  viewportWidth: number; viewportHeight: number;
}

export function createEditor(svg: SVGSVGElement, hooks: EditorHooks): Editor {
  const state: EditorState = {
    font: null, glyph: null, tool: "select",
    scale: 0.45, tx: 120, ty: 420,
    showGuides: true, showNodes: true,
    selected: null, selectionSet: [],
    activePathIdx: -1,
    pendingHandle: null,
    drag: null,
    ghostD: null,
    ghostLayers: [],
    ghostOpacity: 0.55,
    masterOverride: null,
    pencilPts: null,
    measureA: null, measureB: null, measureFixed: false,
    viewportWidth: 0, viewportHeight: 0,
  };

  function fontToScreen(x: number, y: number): FontPoint {
    return { x: x * state.scale + state.tx, y: -y * state.scale + state.ty };
  }
  function screenToFont(sx: number, sy: number): FontPoint & { px: number; py: number } {
    const rect = svg.getBoundingClientRect();
    const px = sx - rect.left, py = sy - rect.top;
    return { x: (px - state.tx) / state.scale, y: -(py - state.ty) / state.scale, px, py };
  }
  function effectiveMasterId(): string {
    if (!state.font) return "";
    return state.masterOverride && state.font.masters.some((m) => m.id === state.masterOverride)
      ? state.masterOverride
      : state.font.currentMasterId;
  }
  function layer(): GlyphLayer | null {
    if (!state.font || !state.glyph) return null;
    const id = effectiveMasterId();
    if (!state.glyph.layers[id]) state.glyph.layers[id] = { paths: [] };
    return state.glyph.layers[id];
  }
  function selectedNodes(): Array<{ sel: Selection; node: FontNode }> {
    const lay = layer();
    if (!lay) return [];
    const seen = new Set<string>();
    const out: Array<{ sel: Selection; node: FontNode }> = [];
    for (const sel of state.selectionSet) {
      const key = `${sel.pathIdx}:${sel.nodeIdx}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const node = lay.paths[sel.pathIdx]?.nodes[sel.nodeIdx];
      if (node) out.push({ sel, node });
    }
    return out;
  }
  function setSelection(sel: Selection | null, additive: boolean): void {
    if (!sel) { state.selected = null; state.selectionSet = []; return; }
    const has = state.selectionSet.some((s) => s.pathIdx === sel.pathIdx && s.nodeIdx === sel.nodeIdx);
    if (additive) {
      state.selectionSet = has
        ? state.selectionSet.filter((s) => !(s.pathIdx === sel.pathIdx && s.nodeIdx === sel.nodeIdx))
        : [...state.selectionSet, sel];
      state.selected = state.selectionSet[state.selectionSet.length - 1] ?? null;
    } else {
      state.selected = sel;
      state.selectionSet = [sel];
    }
  }

  function zoomFit() {
    if (!state.font || !state.glyph) return;
    const rect = svg.getBoundingClientRect();
    const w = Math.max(rect.width, 300), h = Math.max(rect.height, 300);
    const upm = state.font.unitsPerEm || 1000;
    const width = Math.max(state.glyph.width || 600, 200);
    state.scale = Math.min(h / (upm * 1.35), w / (width * 1.6));
    state.scale = Math.max(0.08, Math.min(state.scale, 2.5));
    state.tx = w / 2 - (width / 2) * state.scale;
    state.ty = h * 0.72;
    state.viewportWidth = rect.width;
    state.viewportHeight = rect.height;
    render();
  }

  function resizeViewport(): void {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (state.viewportWidth && state.viewportHeight) {
      state.tx += (rect.width - state.viewportWidth) / 2;
      state.ty += (rect.height - state.viewportHeight) / 2;
    }
    state.viewportWidth = rect.width;
    state.viewportHeight = rect.height;
    render();
  }

  function setGlyph(font: Font | null, glyph: Glyph | null): void {
    state.font = font; state.glyph = glyph;
    state.selected = null; state.selectionSet = [];
    state.measureA = null; state.measureB = null; state.measureFixed = false; state.pencilPts = null;
    hooks.onMeasure?.(null);
    const pathCount = layer()?.paths.length ?? 0;
    state.activePathIdx = glyph ? (pathCount ? pathCount - 1 : -1) : -1;
    state.pendingHandle = null;
    zoomFit();
  }

  function render() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    // Preserve host-level state classes (for example Palette layer visibility)
    // while updating the cursor/tool class owned by the editor.
    svg.classList.toggle("tool-hand", state.tool === "hand");
    svg.classList.toggle("tool-measure", state.tool === "measure");
    svg.classList.toggle("tool-pencil", state.tool === "pencil");
    if (!state.font || !state.glyph) {
      const t = el("text", { x: 24, y: 40, fill: "#9aa6b3", "font-size": 14 });
      t.textContent = "Open a glyph from Font View to start editing.";
      svg.appendChild(t);
      hooks.onStatus?.("No glyph open — pick one in Font View.");
      return;
    }
    const font = state.font, glyph = state.glyph;
    const gWorld = el("g", { transform: `translate(${state.tx} ${state.ty}) scale(${state.scale} ${-state.scale})` });
    const lineW = 1 / state.scale;
    // Em guides: baseline, x-height, cap, ascender, descender + bearings.
    const guides: Array<[number, string]> = [
      [0, "baseline"], [font.xHeight, "x-height"], [font.capHeight, "cap"],
      [font.ascender, "ascender"], [font.descender, "descender"],
    ];
    const x0 = -300, x1 = (glyph.width || 600) + 300;
    for (const [y, label] of guides) {
      gWorld.appendChild(el("line", { x1: x0, y1: y, x2: x1, y2: y, class: `metric-line${label === "baseline" ? " metric-baseline" : ""}`, "stroke-width": lineW }));
      const t = el("text", { x: x0 + 4 / state.scale * 10, y, class: "metric-label", transform: `scale(1 -1) translate(0 ${-2 * y})`, "font-size": 11 / state.scale });
      t.textContent = label;
      // Simpler readable label: drawn in screen group below instead.
      t.remove();
    }
    gWorld.appendChild(el("line", { x1: 0, y1: font.descender - 120, x2: 0, y2: font.ascender + 120, class: "bearing-line", "stroke-width": lineW * 1.2 }));
    gWorld.appendChild(el("line", { x1: glyph.width, y1: font.descender - 120, x2: glyph.width, y2: font.ascender + 120, class: "bearing-line", "stroke-width": lineW * 1.2 }));
    if (state.showGuides) {
      const mid = glyph.width / 2;
      const gl = el("line", { x1: mid, y1: font.descender - 80, x2: mid, y2: font.ascender + 80, class: "guide-line", "stroke-width": lineW });
      gWorld.appendChild(gl);
    }
    const lay = layer();
    if (!lay) return;
    for (const ghostLayer of state.ghostLayers) {
      if (!ghostLayer.d) continue;
      const ghostEl = el("path", { d: ghostLayer.d, class: `ghost-path ghost-${ghostLayer.kind}`, "stroke-dasharray": `${5 / state.scale} ${5 / state.scale}`, "stroke-width": 1.2 / state.scale, "vector-effect": "non-scaling-stroke" });
      ghostEl.style.opacity = String(ghostLayer.kind === "interp" ? state.ghostOpacity : state.ghostOpacity * 0.8);
      gWorld.appendChild(ghostEl);
    }
    if (state.ghostD) {
      const ghost = el("path", { d: state.ghostD, class: "ghost-path", "stroke-dasharray": `${5 / state.scale} ${5 / state.scale}`, "stroke-width": 1.2 / state.scale, "vector-effect": "non-scaling-stroke" });
      gWorld.appendChild(ghost);
    }
    // Closed contours (own + components, resolved) share one path with
    // evenodd fill so counters punch out; own open contours stay strokes.
    const closedDs: string[] = [];
    for (const contour of resolveGlyphContours(font, glyph, effectiveMasterId())) {
      if (!contour.closed) continue;
      const d = contourToPathD(contour);
      if (d) closedDs.push(d);
    }
    lay.paths.forEach((contour, pi) => {
      if (contour.closed) return;
      const d = contourToPathD(contour);
      if (!d) return;
      const p = el("path", { d, class: "outline-path open-path", "stroke-width": 1.4 / state.scale, "vector-effect": "non-scaling-stroke" });
      p.dataset.pathIdx = String(pi);
      gWorld.appendChild(p);
    });
    if (closedDs.length) {
      const p = el("path", { d: closedDs.join(" "), class: "outline-path", "fill-rule": "evenodd", "stroke-width": 1.4 / state.scale, "vector-effect": "non-scaling-stroke" });
      gWorld.appendChild(p);
    }
    // Anchors.
    for (const a of glyph.anchors || []) {
      gWorld.appendChild(el("circle", { cx: a.x, cy: a.y, r: 6 / state.scale, class: "anchor-mark", "stroke-width": lineW * 1.2 }));
    }
    svg.appendChild(gWorld);
    // Screen-space labels + nodes (constant size).
    const labelG = el("g", {});
    for (const [y, label] of guides) {
      const s = fontToScreen(x0, y);
      const t = el("text", { x: s.x + 6, y: s.y - 4, class: "metric-label" });
      t.textContent = `${label} ${y}`;
      labelG.appendChild(t);
    }
    svg.appendChild(labelG);
    if (state.showNodes) {
      const nodeG = el("g", {});
      lay.paths.forEach((contour, pi) => {
        // Handle lines first.
        contour.nodes.forEach((nd, ni) => {
          if (nd.type !== "offcurve") return;
          const prevIndex = (ni - 1 + contour.nodes.length) % contour.nodes.length;
          const nextIndex = (ni + 1) % contour.nodes.length;
          const prev = contour.nodes[prevIndex];
          const next = contour.nodes[nextIndex];
          const anchorIndex = prev.type !== "offcurve" ? prevIndex : nextIndex;
          const anchor = contour.nodes[anchorIndex];
          if (!anchor || anchor.type === "offcurve") return;
          const a = fontToScreen(anchor.x, anchor.y), b = fontToScreen(nd.x, nd.y);
          const active = state.selectionSet.some((selection) => selection.pathIdx === pi && (selection.nodeIdx === ni || selection.nodeIdx === anchorIndex));
          nodeG.appendChild(el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `handle-line${active ? " is-active" : ""}` }));
        });
        contour.nodes.forEach((nd, ni) => {
          const s = fontToScreen(nd.x, nd.y);
          const isSel = state.selectionSet.some((s) => s.pathIdx === pi && s.nodeIdx === ni);
          let nodeEl: SVGElement;
          if (nd.type === "offcurve") {
            nodeEl = el("circle", { cx: s.x, cy: s.y, r: 3.5, class: `node-off${isSel ? " node-sel" : ""}` });
          } else {
            nodeEl = el("rect", { x: s.x - 4, y: s.y - 4, width: 8, height: 8, class: `node-on${isSel ? " node-sel" : ""}` });
          }
          nodeEl.dataset.pathIdx = String(pi); nodeEl.dataset.nodeIdx = String(ni);
          nodeEl.style.cursor = "move";
          nodeG.appendChild(nodeEl);
        });
      });
      svg.appendChild(nodeG);
    }
    // Pencil stroke in progress + measurement overlay (screen space).
    const overlay = el("g", {});
    if (state.pencilPts && state.pencilPts.length > 1) {
      const pts = state.pencilPts.map((p) => { const s = fontToScreen(p.x, p.y); return `${s.x},${s.y}`; }).join(" ");
      overlay.appendChild(el("polyline", { points: pts, class: "pencil-trail" }));
    }
    if (state.measureA) {
      const a = fontToScreen(state.measureA.x, state.measureA.y);
      overlay.appendChild(el("circle", { cx: a.x, cy: a.y, r: 4, class: "measure-dot" }));
      if (state.measureB) {
        const b = fontToScreen(state.measureB.x, state.measureB.y);
        overlay.appendChild(el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "measure-line" }));
        overlay.appendChild(el("circle", { cx: b.x, cy: b.y, r: 4, class: "measure-dot" }));
        const m = measureBetween(state.measureA, state.measureB);
        const label = el("text", { x: (a.x + b.x) / 2 + 8, y: (a.y + b.y) / 2 - 8, class: "measure-label" });
        label.textContent = `${m.distance} @ ${m.angleDeg}°`;
        overlay.appendChild(label);
      }
    }
    svg.appendChild(overlay);
    const b = glyphBounds(glyph, effectiveMasterId());
    hooks.onRender?.({ bounds: b, scale: state.scale });
  }

  function safeCapture(id: number): void {
    try { svg.setPointerCapture(id); } catch { /* synthetic or inactive pointers still drag via bubbling */ }
  }

  function activeContour(): Contour | null {
    const lay = layer();
    if (!lay) return null;
    if (state.activePathIdx < 0 || state.activePathIdx >= lay.paths.length) return null;
    return lay.paths[state.activePathIdx];
  }

  function penDown(fp: FontPoint): void {
    const lay = layer();
    if (!lay) return;
    let contour = activeContour();
    if (!contour || contour.closed) {
      contour = { closed: false, nodes: [] };
      lay.paths.push(contour);
      state.activePathIdx = lay.paths.length - 1;
    }
    hooks.onBeginChange?.("Draw");
    if (state.pendingHandle) {
      contour.nodes.push({ x: Math.round(state.pendingHandle.x), y: Math.round(state.pendingHandle.y), type: "offcurve" });
      state.pendingHandle = null;
    }
    const node: FontNode = { x: Math.round(fp.x), y: Math.round(fp.y), type: "line" };
    contour.nodes.push(node);
    const nodeIdx = contour.nodes.length - 1;
    setSelection({ pathIdx: state.activePathIdx, nodeIdx }, false);
    state.drag = { kind: "pen", pathIdx: state.activePathIdx, nodeIdx, anchor: { x: node.x, y: node.y }, pulled: false };
    hooks.onMutate?.();
    render();
  }

  function penMove(fp: FontPoint): void {
    const d = state.drag;
    if (!d || d.kind !== "pen") return;
    const lay = layer(); if (!lay) return;
    const contour = lay.paths[d.pathIdx]; if (!contour) return;
    const anchor = contour.nodes[d.nodeIdx]; if (!anchor) return;
    const dx = fp.x - d.anchor.x, dy = fp.y - d.anchor.y;
    if (Math.hypot(dx, dy) < 4 && !d.pulled) return;
    anchor.type = "curve";
    // Ensure a mirrored handle before the anchor.
    const before = contour.nodes[d.nodeIdx - 1];
    const mirror: FontNode = { x: Math.round(d.anchor.x - dx), y: Math.round(d.anchor.y - dy), type: "offcurve" };
    if (before && before.type === "offcurve") { before.x = mirror.x; before.y = mirror.y; }
    else { contour.nodes.splice(d.nodeIdx, 0, mirror); d.nodeIdx += 1; setSelection({ pathIdx: d.pathIdx, nodeIdx: d.nodeIdx }, false); }
    state.pendingHandle = { x: Math.round(fp.x), y: Math.round(fp.y) };
    d.pulled = true;
    hooks.onMutate?.();
    render();
  }

  function snapPoint(fp: FontPoint): FontPoint {
    const lay = layer();
    if (!lay) return { x: Math.round(fp.x), y: Math.round(fp.y) };
    const tol = 14 / state.scale;
    let best: FontPoint | null = null, bestD = tol;
    for (const c of lay.paths) for (const n of c.nodes) {
      const d = Math.hypot(n.x - fp.x, n.y - fp.y);
      if (d < bestD) { bestD = d; best = { x: n.x, y: n.y }; }
    }
    return best ?? { x: Math.round(fp.x), y: Math.round(fp.y) };
  }
  function reportMeasure(): void {
    if (state.measureA && state.measureB) {
      const m = measureBetween(state.measureA, state.measureB);
      hooks.onMeasure?.({ ax: state.measureA.x, ay: state.measureA.y, bx: state.measureB.x, by: state.measureB.y, ...m });
    }
  }

  svg.addEventListener("pointerdown", (ev) => {
    svg.focus();
    hooks.onActivate?.();
    if (!state.font || !state.glyph) return;
    const fp = screenToFont(ev.clientX, ev.clientY);
    const target = ev.target as SVGElement | null;
    const pIdx = target?.dataset?.pathIdx;
    const nIdx = target?.dataset?.nodeIdx;
    if (state.tool === "text") { hooks.onTextFocus?.(); return; }
    if (state.tool === "hand") {
      state.drag = { kind: "pan", px: fp.px, py: fp.py, tx: state.tx, ty: state.ty };
      safeCapture(ev.pointerId);
      return;
    }
    if (state.tool === "pen") {
      // Clicking the first node of the active open path closes it.
      const contour = activeContour();
      if (contour && !contour.closed && contour.nodes.length > 2 && pIdx !== undefined && nIdx !== undefined && +pIdx === state.activePathIdx && +nIdx === 0) {
        hooks.onBeginChange?.("Close path");
        contour.closed = true; state.pendingHandle = null;
        hooks.onMutate?.(); hooks.onEndChange?.(); render();
        hooks.onStatus?.("Path closed. Start clicking to draw the next contour.");
        return;
      }
      safeCapture(ev.pointerId);
      penDown(fp);
      return;
    }
    if (state.tool === "pencil") {
      state.pencilPts = [{ x: fp.x, y: fp.y }];
      state.drag = { kind: "pencil" };
      hooks.onBeginChange?.("Pencil draw");
      safeCapture(ev.pointerId);
      render();
      return;
    }
    if (state.tool === "measure") {
      const p = snapPoint(fp);
      if (!state.measureA || state.measureFixed) {
        state.measureA = p; state.measureB = null; state.measureFixed = false;
        hooks.onMeasure?.(null);
        hooks.onStatus?.("Measure: first point set — move to preview, click again to fix the second point.");
      } else {
        state.measureB = p; state.measureFixed = true;
        reportMeasure();
      }
      render();
      return;
    }
    // select tool
    if (pIdx !== undefined && nIdx !== undefined) {
      const sel = { pathIdx: +pIdx, nodeIdx: +nIdx };
      if (ev.shiftKey) {
        setSelection(sel, true);
      } else if (!state.selectionSet.some((s) => s.pathIdx === sel.pathIdx && s.nodeIdx === sel.nodeIdx)) {
        setSelection(sel, false);
      } else {
        state.selected = sel;
      }
      state.activePathIdx = +pIdx;
      state.drag = { kind: "node", last: { x: fp.x, y: fp.y }, began: false };
      safeCapture(ev.pointerId);
      render();
    } else {
      setSelection(null, false);
      render();
    }
  });

  svg.addEventListener("pointermove", (ev) => {
    const fp = screenToFont(ev.clientX, ev.clientY);
    hooks.onCoord?.(fp);
    if (state.tool === "measure" && state.measureA && !state.drag) {
      state.measureB = snapPoint(fp);
      reportMeasure();
      render();
    }
    const drag = state.drag;
    if (!drag) return;
    if (drag.kind === "pencil") {
      const pts = state.pencilPts;
      if (pts) {
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(fp.x - last.x, fp.y - last.y) > 3) { pts.push({ x: fp.x, y: fp.y }); render(); }
      }
      return;
    }
    if (drag.kind === "pan") {
      state.tx = drag.tx + (fp.px - drag.px);
      state.ty = drag.ty + (fp.py - drag.py);
      render(); return;
    }
    if (drag.kind === "pen") { penMove(fp); return; }
    if (drag.kind === "node" && state.selected) {
      const nodes = selectedNodes();
      if (!nodes.length) return;
      if (!drag.began) { hooks.onBeginChange?.("Move node"); drag.began = true; }
      const dx = Math.round(fp.x - drag.last.x), dy = Math.round(fp.y - drag.last.y);
      if (dx || dy) {
        for (const { node } of nodes) { node.x += dx; node.y += dy; }
        drag.last = { x: fp.x, y: fp.y }; hooks.onMutate?.(); render();
      }
    }
  });

  function endDrag(): void {
    const drag = state.drag;
    if (drag?.kind === "node" && drag.began) hooks.onEndChange?.();
    if (drag?.kind === "pen") hooks.onEndChange?.();
    if (drag?.kind === "pencil") {
      const contour = state.pencilPts ? pencilContour(state.pencilPts, 6) : null;
      state.pencilPts = null;
      if (contour) {
        const lay = layer();
        if (lay) {
          lay.paths.push(contour);
          state.activePathIdx = lay.paths.length - 1;
          setSelection({ pathIdx: state.activePathIdx, nodeIdx: 0 }, false);
          hooks.onMutate?.();
          hooks.onStatus?.(`Pencil stroke added as an open contour with ${contour.nodes.length} nodes — drag nodes to refine, Close path to close it.`);
        }
      } else {
        hooks.onStatus?.("Pencil stroke too short — drag a longer stroke.");
      }
      hooks.onEndChange?.();
      render();
    }
    state.drag = null;
  }
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  svg.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const fp = screenToFont(ev.clientX, ev.clientY);
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    const next = Math.max(0.05, Math.min(4, state.scale * factor));
    // Keep the font point under the cursor fixed.
    state.tx = fp.px - fp.x * next;
    state.ty = fp.py + fp.y * next;
    state.scale = next;
    render();
  }, { passive: false });

  function deleteSelected(): void {
    const nodes = selectedNodes();
    if (!nodes.length) { hooks.onStatus?.("Select a node first, then Delete."); return; }
    const lay = layer(); if (!lay) return;
    hooks.onBeginChange?.("Delete node");
    // Delete highest indices first so earlier splices do not shift targets.
    const sorted = [...nodes].sort((a, b) => b.sel.pathIdx - a.sel.pathIdx || b.sel.nodeIdx - a.sel.nodeIdx);
    for (const { sel } of sorted) lay.paths[sel.pathIdx]?.nodes.splice(sel.nodeIdx, 1);
    for (let i = lay.paths.length - 1; i >= 0; i--) if (!lay.paths[i].nodes.length) lay.paths.splice(i, 1);
    setSelection(null, false);
    hooks.onMutate?.(); hooks.onEndChange?.(); render();
    hooks.onStatus?.(nodes.length > 1 ? `${nodes.length} nodes deleted.` : "Node deleted.");
  }

  function alignSelection(mode: AlignMode): void {
    const nodes = selectedNodes();
    if (nodes.length < 2) { hooks.onStatus?.("Shift-click at least two nodes, then align them."); return; }
    if ((mode === "distX" || mode === "distY") && nodes.length < 3) { hooks.onStatus?.("Distribute needs at least three nodes."); return; }
    hooks.onBeginChange?.("Align nodes");
    const next = alignPoints(nodes.map(({ node }) => ({ x: node.x, y: node.y })), mode);
    nodes.forEach(({ node }, i) => { node.x = next[i].x; node.y = next[i].y; });
    hooks.onMutate?.(); hooks.onEndChange?.(); render();
    hooks.onStatus?.(`Aligned ${nodes.length} nodes (${mode}).`);
  }

  function cutSelectedPath(): void {
    if (!state.selected) { hooks.onStatus?.("Select an on-curve node, then Cut path."); return; }
    const lay = layer(); if (!lay) return;
    const contour = lay.paths[state.selected.pathIdx];
    if (!contour) return;
    const node = contour.nodes[state.selected.nodeIdx];
    if (!node || node.type === "offcurve") { hooks.onStatus?.("Handles cannot be cut — pick a white node."); return; }
    const parts = cutContourAt(contour, state.selected.nodeIdx);
    if (parts.length === 1 && parts[0] === contour) {
      hooks.onStatus?.(contour.closed ? "Path could not be cut there." : "Endpoints do not cut — pick an interior node.");
      return;
    }
    hooks.onBeginChange?.("Cut path");
    lay.paths.splice(state.selected.pathIdx, 1, ...parts);
    state.activePathIdx = state.selected.pathIdx;
    setSelection({ pathIdx: state.selected.pathIdx, nodeIdx: 0 }, false);
    hooks.onMutate?.(); hooks.onEndChange?.(); render();
    hooks.onStatus?.(contour.closed ? "Path opened at the selected node." : `Path split into ${parts.length} paths at the selected node.`);
  }

  function closeActivePath(): void {
    const contour = activeContour();
    if (!contour) { hooks.onStatus?.("No active path to close."); return; }
    hooks.onBeginChange?.("Close path");
    contour.closed = true; state.pendingHandle = null;
    hooks.onMutate?.(); hooks.onEndChange?.(); render();
  }

  function convertSelected(): void {
    if (!state.selected) { hooks.onStatus?.("Select an on-curve node to convert it."); return; }
    const lay = layer(); if (!lay) return;
    const contour = lay.paths[state.selected.pathIdx];
    const node = contour?.nodes[state.selected.nodeIdx];
    if (!node || node.type === "offcurve") { hooks.onStatus?.("Handles cannot be converted — pick a white node."); return; }
    hooks.onBeginChange?.("Convert node");
    if (node.type === "line") {
      node.type = "curve";
      // Add symmetric handles toward neighbours so the curve is grabbable.
      const prev = contour.nodes[(state.selected.nodeIdx - 1 + contour.nodes.length) % contour.nodes.length];
      const next = contour.nodes[(state.selected.nodeIdx + 1) % contour.nodes.length];
      const h1: FontNode = { x: Math.round(node.x + (prev.x - node.x) * 0.3), y: Math.round(node.y + (prev.y - node.y) * 0.3), type: "offcurve" };
      const h2: FontNode = { x: Math.round(node.x + (next.x - node.x) * 0.3), y: Math.round(node.y + (next.y - node.y) * 0.3), type: "offcurve" };
      contour.nodes.splice(state.selected.nodeIdx, 0, h1);
      contour.nodes.splice(state.selected.nodeIdx + 2, 0, h2);
      setSelection({ pathIdx: state.selected.pathIdx, nodeIdx: state.selected.nodeIdx + 1 }, false);
    } else {
      // Remove adjacent handles and straighten.
      let idx = state.selected.nodeIdx;
      const next = contour.nodes[(idx + 1) % contour.nodes.length];
      if (next && next.type === "offcurve") contour.nodes.splice((idx + 1) % contour.nodes.length, 1);
      if (idx > contour.nodes.length - 1) idx = contour.nodes.length - 1;
      const prevIdx = (idx - 1 + contour.nodes.length) % contour.nodes.length;
      if (contour.nodes[prevIdx]?.type === "offcurve") { contour.nodes.splice(prevIdx, 1); idx -= 1; }
      if (contour.nodes[idx]) contour.nodes[idx].type = "line";
      setSelection({ pathIdx: state.selected.pathIdx, nodeIdx: idx }, false);
    }
    hooks.onMutate?.(); hooks.onEndChange?.(); render();
  }

  function addContour(contour: Contour): void {
    const lay = layer(); if (!lay) return;
    hooks.onBeginChange?.("Add shape");
    lay.paths.push(contour);
    state.activePathIdx = lay.paths.length - 1;
    hooks.onMutate?.(); hooks.onEndChange?.(); render();
  }

  function nudgeSelected(dx: number, dy: number): void {
    const nodes = selectedNodes();
    if (!nodes.length) return;
    hooks.onBeginChange?.("Nudge");
    for (const { node } of nodes) { node.x += dx; node.y += dy; }
    hooks.onMutate?.(); hooks.onEndChange?.(); render();
  }

  return {
    setGlyph, render, zoomFit, resizeViewport,
    refresh(font: Font | null, glyph: Glyph | null) { state.font = font; state.glyph = glyph; render(); },
    setTool(tool: Tool) {
      state.tool = tool;
      if (tool !== "measure" && (state.measureA || state.measureB)) { state.measureA = null; state.measureB = null; state.measureFixed = false; hooks.onMeasure?.(null); }
      render();
    },
    zoomBy(f: number) {
      const rect = svg.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      const fx = (cx - state.tx) / state.scale, fy = -(cy - state.ty) / state.scale;
      const next = Math.max(0.05, Math.min(4, state.scale * f));
      state.tx = cx - fx * next; state.ty = cy + fy * next; state.scale = next; render();
    },
    toggleGuides() { state.showGuides = !state.showGuides; render(); return state.showGuides; },
    toggleNodes() { state.showNodes = !state.showNodes; render(); return state.showNodes; },
    deleteSelected, cutSelectedPath, closeActivePath, convertSelected, addContour, nudgeSelected,
    getSelected: () => state.selected,
    setGhostD(d: string | null) { state.ghostD = d; render(); },
    setGhostLayers(layers: GhostLayer[], opacity = 0.55) { state.ghostLayers = layers.filter((l) => Boolean(l.d)); state.ghostOpacity = Math.max(0.05, Math.min(1, opacity)); render(); },
    setMasterOverride(masterId: string | null) { state.masterOverride = masterId; state.selected = null; state.selectionSet = []; render(); },
    alignSelection,
    getSelectionCount: () => selectedNodes().length,
  };
}
