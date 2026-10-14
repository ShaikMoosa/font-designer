// Path surgery: direction fixing and boolean union (remove overlaps).
// Union flattens curves to polylines, so results are line contours — the UI
// says so before applying. Uses polygon-clipping (Martinez) via its
// default export; rings are [x, y] pairs in font units, Y-up.
import polygonClipping from "polygon-clipping";
import { contourArea, lineNode } from "./model.ts";
import type { Contour } from "./model.ts";

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
