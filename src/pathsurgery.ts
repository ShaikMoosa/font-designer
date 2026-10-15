// Path surgery: direction fixing and boolean union (remove overlaps).
// Union flattens curves to polylines, so results are line contours — the UI
// says so before applying. Uses polygon-clipping (Martinez) via its
// default export; rings are [x, y] pairs in font units, Y-up.
import polygonClipping from "polygon-clipping";
import { contourArea, lineNode } from "./model.ts";
import type { Contour, FontNode } from "./model.ts";

type Ring = Array<[number, number]>;

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

// Flatten a contour to a closed ring (start point not repeated at the end
// here; callers add closure for the clipping library as needed).
export function flattenContour(contour: Contour, stepsPerCurve = 10): Ring {
  const pts = contour.nodes;
  if (!pts.length) return [];
  const startIdx = pts.findIndex((p) => p.type !== "offcurve");
  if (startIdx < 0) return [];
  const seq = pts.slice(startIdx).concat(pts.slice(0, startIdx));
  const ring: Ring = [[seq[0].x, seq[0].y]];
  const n = seq.length;
  let i = 1;
  let guard = 0;
  const limit = contour.closed ? n : n - 1;
  while (i <= limit && guard++ < 1000) {
    const a = seq[i % n];
    if (a.type !== "offcurve") { ring.push([a.x, a.y]); i++; continue; }
    const b = seq[(i + 1) % n];
    const c = seq[(i + 2) % n];
    const p0 = seq[(i - 1 + n) % n];
    if (b && c && b.type === "offcurve" && c.type !== "offcurve") {
      for (let s = 1; s <= stepsPerCurve; s++) {
        const t = s / stepsPerCurve;
        ring.push([Math.round(cubicAt(p0.x, a.x, b.x, c.x, t)), Math.round(cubicAt(p0.y, a.y, b.y, c.y, t))]);
      }
      i += 3;
      continue;
    }
    if (b) { ring.push([b.x, b.y]); i += 2; continue; }
    break;
  }
  // Drop a duplicated closing point; the union step re-closes rings.
  if (ring.length > 1) {
    const first = ring[0], last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) ring.pop();
  }
  return ring;
}

function ringToContour(ring: Ring): Contour {
  const pts = ring.length > 1
    && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : ring;
  return { closed: true, nodes: pts.map(([x, y]) => lineNode(x, y)) };
}

// Boolean-union all closed contours; open contours pass through untouched.
export function unionContours(contours: Contour[]): Contour[] {
  const closed = contours.filter((c) => c.closed && c.nodes.length >= 3);
  const open = contours.filter((c) => !c.closed);
  if (closed.length < 2) return contours;
  const polys = closed.map((c) => {
    const ring = flattenContour(c);
    if (ring.length) ring.push([...ring[0]]);
    return [ring];
  }).filter((p) => p[0].length >= 4);
  if (polys.length < 2) return contours;
  // polygon-clipping expects Polygon/MultiPolygon geometries.
  const merged = polygonClipping.union(polys[0] as never, ...polys.slice(1) as never[]) as unknown as Array<Array<Ring>>;
  const out: Contour[] = [];
  for (const poly of merged) for (const ring of poly) if (ring.length >= 3) out.push(ringToContour(ring));
  return [...out, ...open];
}

// Boolean-subtract the 2nd..nth closed contours from the 1st; open
// contours pass through untouched. Curves are flattened like union.
export function differenceContours(contours: Contour[]): Contour[] {
  const closed = contours.filter((c) => c.closed && c.nodes.length >= 3);
  const open = contours.filter((c) => !c.closed);
  if (closed.length < 2) return contours;
  const toPoly = (c: Contour) => {
    const ring = flattenContour(c);
    if (ring.length) ring.push([...ring[0]]);
    return [ring];
  };
  const polys = closed.map(toPoly).filter((p) => p[0].length >= 4);
  if (polys.length < 2) return contours;
  const result = polygonClipping.difference(polys[0] as never, ...polys.slice(1) as never[]) as unknown as Array<Array<Ring>>;
  const out: Contour[] = [];
  for (const poly of result) for (const ring of poly) if (ring.length >= 3) out.push(ringToContour(ring));
  return [...out, ...open];
}

// --- Phase 9 drawing depth: extremes, round corners, offset, resegment,
// duplicate-node cleanup, fit curve, and path cutting. All functions
// return new contours and never mutate their inputs.

interface Pt { x: number; y: number }
type Seg =
  | { kind: "line"; from: FontNode; to: FontNode }
  | { kind: "cubic"; from: FontNode; c1: Pt; c2: Pt; to: FontNode };

function segmentsOf(contour: Contour): Seg[] {
  const pts = contour.nodes;
  if (pts.length < 2) return [];
  const startIdx = pts.findIndex((p) => p.type !== "offcurve");
  if (startIdx < 0) return [];
  const seq = pts.slice(startIdx).concat(pts.slice(0, startIdx));
  const segs: Seg[] = [];
  let current = seq[0];
  let i = 1;
  let budget = contour.closed ? seq.length : seq.length - 1;
  while (budget > 0) {
    const a = seq[i % seq.length];
    if (!a) break;
    if (a.type !== "offcurve") {
      segs.push({ kind: "line", from: current, to: a });
      current = a; i += 1; budget -= 1; continue;
    }
    const b = seq[(i + 1) % seq.length];
    const c = seq[(i + 2) % seq.length];
    if (b && c && b.type === "offcurve" && c.type !== "offcurve") {
      segs.push({ kind: "cubic", from: current, c1: a, c2: b, to: c });
      current = c; i += 3; budget -= 3; continue;
    }
    if (b && b.type !== "offcurve") {
      // Single handle: quadratic promoted to cubic (as in contourToPathD).
      segs.push({
        kind: "cubic", from: current,
        c1: { x: current.x + (2 / 3) * (a.x - current.x), y: current.y + (2 / 3) * (a.y - current.y) },
        c2: { x: b.x + (2 / 3) * (a.x - b.x), y: b.y + (2 / 3) * (a.y - b.y) },
        to: b,
      });
      current = b; i += 2; budget -= 2; continue;
    }
    break;
  }
  return segs;
}

function contourFromSegments(segs: Seg[], closed: boolean): Contour {
  if (!segs.length) return { closed, nodes: [] };
  const nodes: FontNode[] = [{ ...segs[0].from }];
  for (const s of segs) {
    if (s.kind === "line") {
      nodes.push({ ...s.to });
    } else {
      nodes.push({ x: Math.round(s.c1.x), y: Math.round(s.c1.y), type: "offcurve" });
      nodes.push({ x: Math.round(s.c2.x), y: Math.round(s.c2.y), type: "offcurve" });
      nodes.push({ ...s.to });
    }
  }
  if (closed && nodes.length > 1) {
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (first.x === last.x && first.y === last.y) nodes.pop();
  }
  return { closed, nodes };
}

function splitCubic(seg: Extract<Seg, { kind: "cubic" }>, t: number): Array<Extract<Seg, { kind: "cubic" }>> {
  const lerp = (a: Pt, b: Pt): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const p01 = lerp(seg.from, seg.c1), p12 = lerp(seg.c1, seg.c2), p23 = lerp(seg.c2, seg.to);
  const p012 = lerp(p01, p12), p123 = lerp(p12, p23);
  const mid = lerp(p012, p123);
  const midNode: FontNode = { x: Math.round(mid.x), y: Math.round(mid.y), type: "curve" };
  return [
    { kind: "cubic", from: seg.from, c1: p01, c2: p012, to: midNode },
    { kind: "cubic", from: midNode, c1: p123, c2: p23, to: seg.to },
  ];
}

function extremeParams(seg: Extract<Seg, { kind: "cubic" }>): number[] {
  const ts: number[] = [];
  for (const dim of ["x", "y"] as const) {
    const p0 = seg.from[dim], p1 = seg.c1[dim], p2 = seg.c2[dim], p3 = seg.to[dim];
    const A = p3 - p0 + 3 * p1 - 3 * p2;
    const B = 2 * p0 - 4 * p1 + 2 * p2;
    const C = p1 - p0;
    const roots: number[] = [];
    if (Math.abs(A) < 1e-9) {
      if (Math.abs(B) > 1e-9) roots.push(-C / B);
    } else {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const sq = Math.sqrt(disc);
        roots.push((-B + sq) / (2 * A), (-B - sq) / (2 * A));
      }
    }
    for (const t of roots) if (t > 0.02 && t < 0.98) ts.push(t);
  }
  return [...new Set(ts.map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
}

function splitAtParams(seg: Extract<Seg, { kind: "cubic" }>, ts: number[]): Array<Extract<Seg, { kind: "cubic" }>> {
  if (!ts.length) return [seg];
  const [first, second] = splitCubic(seg, ts[0]);
  const remapped = ts.slice(1).map((t) => (t - ts[0]) / (1 - ts[0])).filter((t) => t > 0.01 && t < 0.99);
  return [first, ...splitAtParams(second, remapped)];
}

export interface ContourOpResult { contours: Contour[]; changed: number }

export function addExtremes(contours: Contour[]): ContourOpResult {
  let changed = 0;
  const out = contours.map((c) => {
    const segs = segmentsOf(c);
    if (!segs.length) return c;
    const next: Seg[] = [];
    let local = 0;
    for (const s of segs) {
      if (s.kind !== "cubic") { next.push(s); continue; }
      const ts = extremeParams(s);
      if (!ts.length) { next.push(s); continue; }
      local += ts.length;
      next.push(...splitAtParams(s, ts));
    }
    changed += local;
    return local ? contourFromSegments(next, c.closed) : c;
  });
  return { contours: out, changed };
}

export function resegmentContours(contours: Contour[]): ContourOpResult {
  let changed = 0;
  const out = contours.map((c) => {
    const segs = segmentsOf(c);
    if (!segs.length) return c;
    const next: Seg[] = [];
    for (const s of segs) {
      changed++;
      if (s.kind === "line") {
        const mid: FontNode = {
          x: Math.round((s.from.x + s.to.x) / 2), y: Math.round((s.from.y + s.to.y) / 2), type: "line",
        };
        next.push({ kind: "line", from: s.from, to: mid }, { kind: "line", from: mid, to: s.to });
      } else {
        next.push(...splitCubic(s, 0.5));
      }
    }
    return contourFromSegments(next, c.closed);
  });
  return { contours: out, changed };
}

export function fitCurveContours(contours: Contour[]): ContourOpResult {
  let changed = 0;
  const out = contours.map((c) => {
    if (c.nodes.length < 3 || c.nodes.some((n) => n.type === "offcurve")) return c;
    changed++;
    const pts = c.nodes;
    const at = (idx: number): FontNode => {
      if (c.closed) return pts[(idx + pts.length) % pts.length];
      return pts[Math.max(0, Math.min(pts.length - 1, idx))];
    };
    const segs: Seg[] = [];
    const segCount = c.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      segs.push({
        kind: "cubic",
        from: { ...p1, type: "smooth" },
        c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
        c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
        to: { ...p2, type: "smooth" },
      });
    }
    return contourFromSegments(segs, c.closed);
  });
  return { contours: out, changed };
}

export function roundCorners(contours: Contour[], radius: number): ContourOpResult {
  let changed = 0;
  const KAPPA_LOCAL = 0.5522847498307936;
  const out = contours.map((c) => {
    if (radius <= 0 || c.nodes.length < 3 || c.nodes.some((n) => n.type === "offcurve")) return c;
    const pts = c.nodes;
    const nodes: FontNode[] = [];
    const count = c.closed ? pts.length : pts.length;
    for (let i = 0; i < count; i++) {
      const v = pts[i];
      const isEndpoint = !c.closed && (i === 0 || i === pts.length - 1);
      if (isEndpoint) { nodes.push({ ...v }); continue; }
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      const dPrev = Math.hypot(v.x - prev.x, v.y - prev.y);
      const dNext = Math.hypot(next.x - v.x, next.y - v.y);
      const cut = Math.min(radius, 0.45 * Math.min(dPrev, dNext));
      if (cut <= 0.5 || dPrev === 0 || dNext === 0) { nodes.push({ ...v }); continue; }
      changed++;
      const a: Pt = { x: v.x + ((prev.x - v.x) / dPrev) * cut, y: v.y + ((prev.y - v.y) / dPrev) * cut };
      const b: Pt = { x: v.x + ((next.x - v.x) / dNext) * cut, y: v.y + ((next.y - v.y) / dNext) * cut };
      nodes.push({ x: Math.round(a.x), y: Math.round(a.y), type: "line" });
      nodes.push({ x: Math.round(a.x + (v.x - a.x) * KAPPA_LOCAL), y: Math.round(a.y + (v.y - a.y) * KAPPA_LOCAL), type: "offcurve" });
      nodes.push({ x: Math.round(b.x + (v.x - b.x) * KAPPA_LOCAL), y: Math.round(b.y + (v.y - b.y) * KAPPA_LOCAL), type: "offcurve" });
      nodes.push({ x: Math.round(b.x), y: Math.round(b.y), type: "curve" });
    }
    return { closed: c.closed, nodes };
  });
  return { contours: out, changed };
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function offsetContours(contours: Contour[], distance: number): ContourOpResult {
  let changed = 0;
  const out = contours.map((c) => {
    if (!c.closed || distance === 0) return c;
    const ring = flattenContour(c, 8);
    if (ring.length < 3) return c;
    const area = ringArea(ring);
    if (!area) return c;
    const outward = area > 0 ? 1 : -1;
    const n = ring.length;
    const normals: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      // Right-hand normal, flipped for clockwise (hole) rings.
      normals.push({ x: ((y2 - y1) / len) * outward, y: (-(x2 - x1) / len) * outward });
    }
    const offsetRing: Ring = [];
    for (let i = 0; i < n; i++) {
      const prevEdge = (i - 1 + n) % n;
      const p = ring[i];
      const d1 = { x: ring[(prevEdge + 1) % n][0] - ring[prevEdge][0], y: ring[(prevEdge + 1) % n][1] - ring[prevEdge][1] };
      const d2 = { x: ring[(i + 1) % n][0] - ring[i][0], y: ring[(i + 1) % n][1] - ring[i][1] };
      const a: Pt = { x: p[0] + normals[prevEdge].x * distance, y: p[1] + normals[prevEdge].y * distance };
      const b: Pt = { x: p[0] + normals[i].x * distance, y: p[1] + normals[i].y * distance };
      const cross = d1.x * d2.y - d1.y * d2.x;
      if (Math.abs(cross) < 1e-9) {
        offsetRing.push([Math.round(b.x), Math.round(b.y)]);
      } else {
        const t = ((b.x - a.x) * d2.y - (b.y - a.y) * d2.x) / cross;
        offsetRing.push([Math.round(a.x + d1.x * t), Math.round(a.y + d1.y * t)]);
      }
    }
    const newArea = ringArea(offsetRing);
    if (!newArea || Math.sign(newArea) !== Math.sign(area)) return c;
    // Collapse: an offset edge that runs against its source edge means
    // opposing edges have crossed (the offset consumed the shape).
    for (let i = 0; i < n; i++) {
      const ox = offsetRing[(i + 1) % n][0] - offsetRing[i][0];
      const oy = offsetRing[(i + 1) % n][1] - offsetRing[i][1];
      const sx = ring[(i + 1) % n][0] - ring[i][0];
      const sy = ring[(i + 1) % n][1] - ring[i][1];
      if (ox * sx + oy * sy <= 0) return c;
    }
    changed++;
    return ringToContour(offsetRing);
  });
  return { contours: out, changed };
}

export interface DuplicateNode { pathIdx: number; nodeIdx: number; x: number; y: number }

export function findDuplicateNodes(contours: Contour[], tolerance = 0): DuplicateNode[] {
  const out: DuplicateNode[] = [];
  contours.forEach((c, pathIdx) => {
    const pts = c.nodes;
    for (let i = 1; i < pts.length; i++) {
      if (Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) <= tolerance) {
        out.push({ pathIdx, nodeIdx: i, x: pts[i].x, y: pts[i].y });
      }
    }
    if (c.closed && pts.length > 1) {
      const first = pts[0], last = pts[pts.length - 1];
      if (Math.hypot(last.x - first.x, last.y - first.y) <= tolerance) {
        out.push({ pathIdx, nodeIdx: pts.length - 1, x: last.x, y: last.y });
      }
    }
  });
  return out;
}

export function removeDuplicateNodes(contours: Contour[], tolerance = 0): ContourOpResult {
  let changed = 0;
  const out = contours.map((c) => {
    const kept: FontNode[] = [];
    for (const node of c.nodes) {
      const last = kept[kept.length - 1];
      if (last && Math.hypot(node.x - last.x, node.y - last.y) <= tolerance) { changed++; continue; }
      kept.push({ ...node });
    }
    if (c.closed && kept.length > 1) {
      const first = kept[0], last = kept[kept.length - 1];
      if (Math.hypot(last.x - first.x, last.y - first.y) <= tolerance) { kept.pop(); changed++; }
    }
    if (kept.length < (c.closed ? 3 : 2)) return c;
    return { closed: c.closed, nodes: kept };
  });
  return { contours: changed ? out : contours, changed };
}

/** Cut a contour at an on-curve node: a closed contour opens there; an
 * open contour splits in two. Handles and endpoints do not cut. */
export function cutContourAt(contour: Contour, nodeIdx: number): Contour[] {
  const pts = contour.nodes;
  const node = pts[nodeIdx];
  if (!node || node.type === "offcurve") return [contour];
  if (contour.closed) {
    if (pts.length < 3) return [contour];
    const rotated = pts.slice(nodeIdx).concat(pts.slice(0, nodeIdx)).map((n) => ({ ...n }));
    return [{ closed: false, nodes: rotated }];
  }
  if (nodeIdx <= 0 || nodeIdx >= pts.length - 1) return [contour];
  return [
    { closed: false, nodes: pts.slice(0, nodeIdx + 1).map((n) => ({ ...n })) },
    { closed: false, nodes: pts.slice(nodeIdx).map((n) => ({ ...n })) },
  ];
}

// Ensure closed contours run counter-clockwise (positive area, Y-up).
// Returns how many contours were reversed.
export function fixContourDirections(contours: Contour[]): number {
  let changed = 0;
  for (const c of contours) {
    if (!c.closed || c.nodes.length < 3) continue;
    if (contourArea(c) < 0) { c.nodes.reverse(); changed++; }
  }
  return changed;
}
