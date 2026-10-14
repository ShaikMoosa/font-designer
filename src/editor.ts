// SVG Edit View: pan/zoom, pen + select + hand tools, nodes/handles,
// metrics and guides. Font coords are Y-up; screen coords are Y-down.
import { contourToPathD, glyphBounds } from "./model.ts";
import type { Bounds, Contour, Font, FontNode, Glyph, GlyphLayer } from "./model.ts";

const SVGNS = "http://www.w3.org/2000/svg";
function el(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const n = document.createElementNS(SVGNS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

export type Tool = "select" | "pen" | "hand" | "text";
export interface Selection { pathIdx: number; nodeIdx: number }
export interface FontPoint { x: number; y: number }
type Drag =
  | { kind: "pan"; px: number; py: number; tx: number; ty: number }
  | { kind: "pen"; pathIdx: number; nodeIdx: number; anchor: FontPoint; pulled: boolean }
  | { kind: "node"; last: FontPoint; began: boolean };

export interface EditorHooks {
  onBeginChange?: (label: string) => void;
  onMutate?: () => void;
  onEndChange?: () => void;
  onCoord?: (fp: FontPoint & { px: number; py: number }) => void;
  onStatus?: (msg: string) => void;
  onTextFocus?: () => void;
  onRender?: (info: { bounds: Bounds | null; scale: number }) => void;
}

export interface Editor {
  setGlyph: (font: Font | null, glyph: Glyph | null) => void;
  render: () => void;
  zoomFit: () => void;
  refresh: (font: Font | null, glyph: Glyph | null) => void;
  setTool: (tool: Tool) => void;
  zoomBy: (f: number) => void;
  toggleGuides: () => boolean;
  toggleNodes: () => boolean;
  deleteSelected: () => void;
  closeActivePath: () => void;
  convertSelected: () => void;
  addContour: (contour: Contour) => void;
  nudgeSelected: (dx: number, dy: number) => void;
  getSelected: () => Selection | null;
}

interface EditorState {
  font: Font | null; glyph: Glyph | null; tool: Tool;
  scale: number; tx: number; ty: number;
  showGuides: boolean; showNodes: boolean;
  selected: Selection | null; activePathIdx: number;
  pendingHandle: FontPoint | null; drag: Drag | null;
}

export function createEditor(svg: SVGSVGElement, hooks: EditorHooks): Editor {
  const state: EditorState = {
    font: null, glyph: null, tool: "select",
    scale: 0.45, tx: 120, ty: 420,
    showGuides: true, showNodes: true,
    selected: null,
    activePathIdx: -1,
    pendingHandle: null,
    drag: null,
  };

  function fontToScreen(x: number, y: number): FontPoint {
    return { x: x * state.scale + state.tx, y: -y * state.scale + state.ty };
  }
  function screenToFont(sx: number, sy: number): FontPoint & { px: number; py: number } {
    const rect = svg.getBoundingClientRect();
    const px = sx - rect.left, py = sy - rect.top;
    return { x: (px - state.tx) / state.scale, y: -(py - state.ty) / state.scale, px, py };
  }
  function layer(): GlyphLayer | null {
    if (!state.font || !state.glyph) return null;
    const id = state.font.currentMasterId;
    if (!state.glyph.layers[id]) state.glyph.layers[id] = { paths: [] };
    return state.glyph.layers[id];
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
    render();
  }

  function setGlyph(font: Font | null, glyph: Glyph | null): void {
    state.font = font; state.glyph = glyph;
    state.selected = null;
    const pathCount = layer()?.paths.length ?? 0;
    state.activePathIdx = glyph ? (pathCount ? pathCount - 1 : -1) : -1;
    state.pendingHandle = null;
    zoomFit();
  }

  function render() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("class", state.tool === "hand" ? "tool-hand" : "");
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
      gWorld.appendChild(el("line", { x1: x0, y1: y, x2: x1, y2: y, class: "metric-line", "stroke-width": lineW }));
      const t = el("text", { x: x0 + 4 / state.scale * 10, y, class: "metric-label", transform: `scale(1 -1) translate(0 ${-2 * y})`, "font-size": 11 / state.scale });
      t.textContent = label;
      // Simpler readable label: drawn in screen group below instead.
      t.remove();
    }
    gWorld.appendChild(el("line", { x1: 0, y1: font.descender - 120, x2: 0, y2: font.ascender + 120, stroke: "#e8a33d", "stroke-width": lineW * 1.4 }));
    gWorld.appendChild(el("line", { x1: glyph.width, y1: font.descender - 120, x2: glyph.width, y2: font.ascender + 120, stroke: "#e8a33d", "stroke-width": lineW * 1.4 }));
    if (state.showGuides) {
      const mid = glyph.width / 2;
      const gl = el("line", { x1: mid, y1: font.descender - 80, x2: mid, y2: font.ascender + 80, class: "guide-line", "stroke-width": lineW });
      gWorld.appendChild(gl);
    }
    const lay = layer();
    if (!lay) return;
    // Closed contours share one path with evenodd fill so counters punch out;
    // open contours stay unfilled strokes.
    const closedDs: string[] = [];
    lay.paths.forEach((contour, pi) => {
      const d = contourToPathD(contour);
      if (!d) return;
      if (contour.closed) { closedDs.push(d); return; }
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
      gWorld.appendChild(el("circle", { cx: a.x, cy: a.y, r: 7 / state.scale, fill: "none", stroke: "#6fca97", "stroke-width": lineW * 1.4 }));
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
          const prev = contour.nodes[(ni - 1 + contour.nodes.length) % contour.nodes.length];
          const next = contour.nodes[(ni + 1) % contour.nodes.length];
          const anchor = prev.type !== "offcurve" ? prev : next;
          if (!anchor || anchor.type === "offcurve") return;
          const a = fontToScreen(anchor.x, anchor.y), b = fontToScreen(nd.x, nd.y);
          nodeG.appendChild(el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "handle-line" }));
        });
        contour.nodes.forEach((nd, ni) => {
          const s = fontToScreen(nd.x, nd.y);
          const isSel = state.selected && state.selected.pathIdx === pi && state.selected.nodeIdx === ni;
          let nodeEl: SVGElement;
          if (nd.type === "offcurve") {
            nodeEl = el("circle", { cx: s.x, cy: s.y, r: 4.5, class: `node-off${isSel ? " node-sel" : ""}` });
          } else {
            nodeEl = el("rect", { x: s.x - 4.5, y: s.y - 4.5, width: 9, height: 9, class: `node-on${isSel ? " node-sel" : ""}` });
          }
          nodeEl.dataset.pathIdx = String(pi); nodeEl.dataset.nodeIdx = String(ni);
          nodeEl.style.cursor = "move";
          nodeG.appendChild(nodeEl);
        });
      });
      svg.appendChild(nodeG);
    }
    const b = glyphBounds(glyph, font.currentMasterId);
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
    state.selected = { pathIdx: state.activePathIdx, nodeIdx };
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
    else { contour.nodes.splice(d.nodeIdx, 0, mirror); d.nodeIdx += 1; state.selected = { pathIdx: d.pathIdx, nodeIdx: d.nodeIdx }; }
    state.pendingHandle = { x: Math.round(fp.x), y: Math.round(fp.y) };
    d.pulled = true;
    hooks.onMutate?.();
    render();
  }

  svg.addEventListener("pointerdown", (ev) => {
    svg.focus();
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
    // select tool
    if (pIdx !== undefined && nIdx !== undefined) {
      state.selected = { pathIdx: +pIdx, nodeIdx: +nIdx };
      state.activePathIdx = +pIdx;
      state.drag = { kind: "node", last: { x: fp.x, y: fp.y }, began: false };
      safeCapture(ev.pointerId);
      render();
    } else {
      state.selected = null;
      render();
    }
  });

  svg.addEventListener("pointermove", (ev) => {
    const fp = screenToFont(ev.clientX, ev.clientY);
    hooks.onCoord?.(fp);
    const drag = state.drag;
    if (!drag) return;
    if (drag.kind === "pan") {
      state.tx = drag.tx + (fp.px - drag.px);
      state.ty = drag.ty + (fp.py - drag.py);
      render(); return;
    }
    if (drag.kind === "pen") { penMove(fp); return; }
    if (drag.kind === "node" && state.selected) {
      const lay = layer(); if (!lay) return;
      const node = lay.paths[state.selected.pathIdx]?.nodes[state.selected.nodeIdx];
      if (!node) return;
      if (!drag.began) { hooks.onBeginChange?.("Move node"); drag.began = true; }
      const dx = Math.round(fp.x - drag.last.x), dy = Math.round(fp.y - drag.last.y);
      if (dx || dy) { node.x += dx; node.y += dy; drag.last = { x: fp.x, y: fp.y }; hooks.onMutate?.(); render(); }
    }
  });

  function endDrag(): void {
    const drag = state.drag;
    if (drag?.kind === "node" && drag.began) hooks.onEndChange?.();
    if (drag?.kind === "pen") hooks.onEndChange?.();
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
    if (!state.selected) { hooks.onStatus?.("Select a node first, then Delete."); return; }
    const lay = layer(); if (!lay) return;
    const contour = lay.paths[state.selected.pathIdx]; if (!contour) return;
    hooks.onBeginChange?.("Delete node");
    contour.nodes.splice(state.selected.nodeIdx, 1);
    if (!contour.nodes.length) lay.paths.splice(state.selected.pathIdx, 1);
    state.selected = null;
    hooks.onMutate?.(); hooks.onEndChange?.(); render();
    hooks.onStatus?.("Node deleted.");
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
      state.selected = { pathIdx: state.selected.pathIdx, nodeIdx: state.selected.nodeIdx + 1 };
    } else {
      // Remove adjacent handles and straighten.
      let idx = state.selected.nodeIdx;
      const next = contour.nodes[(idx + 1) % contour.nodes.length];
      if (next && next.type === "offcurve") contour.nodes.splice((idx + 1) % contour.nodes.length, 1);
      if (idx > contour.nodes.length - 1) idx = contour.nodes.length - 1;
      const prevIdx = (idx - 1 + contour.nodes.length) % contour.nodes.length;
      if (contour.nodes[prevIdx]?.type === "offcurve") { contour.nodes.splice(prevIdx, 1); idx -= 1; }
      if (contour.nodes[idx]) contour.nodes[idx].type = "line";
      state.selected = { pathIdx: state.selected.pathIdx, nodeIdx: idx };
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
    if (!state.selected) return;
    const lay = layer(); if (!lay) return;
    const node = lay.paths[state.selected.pathIdx]?.nodes[state.selected.nodeIdx];
    if (!node) return;
    hooks.onBeginChange?.("Nudge");
    node.x += dx; node.y += dy;
    hooks.onMutate?.(); hooks.onEndChange?.(); render();
  }

  return {
    setGlyph, render, zoomFit,
    refresh(font: Font | null, glyph: Glyph | null) { state.font = font; state.glyph = glyph; render(); },
    setTool(tool: Tool) { state.tool = tool; render(); },
    zoomBy(f: number) {
      const rect = svg.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      const fx = (cx - state.tx) / state.scale, fy = -(cy - state.ty) / state.scale;
      const next = Math.max(0.05, Math.min(4, state.scale * f));
      state.tx = cx - fx * next; state.ty = cy + fy * next; state.scale = next; render();
    },
    toggleGuides() { state.showGuides = !state.showGuides; render(); return state.showGuides; },
    toggleNodes() { state.showNodes = !state.showNodes; render(); return state.showNodes; },
    deleteSelected, closeActivePath, convertSelected, addContour, nudgeSelected,
    getSelected: () => state.selected,
  };
}
