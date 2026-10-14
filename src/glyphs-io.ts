// .glyphs JSON-subset import/export for this MVP.
// Real .glyphs files may be OpenStep plist; those are reported clearly
// instead of being silently misread. Export here is JSON so it round-trips.
import { DEFAULT_FEATURE_CODE } from "./model.ts";
import type { Font, FontMaster, FontNode, Glyph, GlyphLayer, NodeType } from "./model.ts";

// Imported JSON is untrusted external data; it is normalized into Font below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

// Minimal OpenStep (old-style) plist parser — the format real Glyphs files
// use. Returns plain objects/arrays/strings; numbers stay strings and are
// normalized by glyphsJsonToFont below.
export function parseOpenStep(text: string): unknown {
  let i = 0;
  const n = text.length;
  function skipWs(): void {
    while (i < n) {
      const ch = text[i];
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") { i++; continue; }
      if (ch === "/" && text[i + 1] === "/") { while (i < n && text[i] !== "\n") i++; continue; }
      if (ch === "/" && text[i + 1] === "*") { i += 2; while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i++; i += 2; continue; }
      break;
    }
  }
  function parseString(): string {
    if (text[i] === '"') {
      i++;
      let out = "";
      while (i < n && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < n) {
          const e = text[i + 1];
          out += e === "n" ? "\n" : e === "t" ? "\t" : e;
          i += 2;
        } else { out += text[i]; i++; }
      }
      i++;
      return out;
    }
    const start = i;
    while (i < n && !" \t\r\n{}()=;,\"".includes(text[i])) i++;
    return text.slice(start, i);
  }
  function parseValue(): unknown {
    skipWs();
    if (text[i] === "{") {
      i++;
      const obj: Record<string, unknown> = {};
      for (;;) {
        skipWs();
        if (text[i] === "}") { i++; break; }
        const key = parseString();
        skipWs();
        if (text[i] === "=") i++;
        obj[key] = parseValue();
        skipWs();
        if (text[i] === ";") i++;
      }
      return obj;
    }
    if (text[i] === "(") {
      i++;
      const arr: unknown[] = [];
      for (;;) {
        skipWs();
        if (text[i] === ")") { i++; break; }
        arr.push(parseValue());
        skipWs();
        if (text[i] === ",") i++;
      }
      return arr;
    }
    return parseString();
  }
  const value = parseValue();
  return value;
}

export function parsePoint(text: unknown): { x: number; y: number } {
  const parts = String(text ?? "").replace(/[{}]/g, "").split(",").map((s) => Number(s.trim()) || 0);
  return { x: parts[0] || 0, y: parts[1] || 0 };
}

export function parseTransform(text: unknown): { scaleX: number; scaleY: number; x: number; y: number } {
  const p = String(text ?? "").replace(/[{}]/g, "").split(",").map((s) => Number(s.trim()) || 0);
  // Glyphs transform is {a, b, c, d, tx, ty}; only scale + translation are kept.
  return { scaleX: p[0] || 1, scaleY: p[3] || 1, x: p[4] || 0, y: p[5] || 0 };
}

export function fontToGlyphsJson(font: Font): string {
  const doc = {
    app: "Glyphs for Windows MVP",
    formatNote: "JSON subset inspired by Glyphs 3; not a full .glyphs clone",
    familyName: font.familyName,
    versionString: font.version,
    unitsPerEm: font.unitsPerEm,
    fontMaster: font.masters.map((m) => ({
      id: m.id, name: m.name, weightValue: m.weightValue,
      ascender: font.ascender, descender: font.descender,
      capHeight: font.capHeight, xHeight: font.xHeight,
    })),
    glyphs: font.glyphs.map((g) => ({
      glyphname: g.name,
      unicode: g.unicode != null ? g.unicode.toString(16).toUpperCase().padStart(4, "0") : null,
      category: g.category,
      leftKerningGroup: g.kerningGroupLeft || undefined,
      rightKerningGroup: g.kerningGroupRight || undefined,
      leftMetricsKey: g.metricsKeyLeft || undefined,
      rightMetricsKey: g.metricsKeyRight || undefined,
      layers: Object.entries(g.layers).map(([layerId, layer]) => ({
        layerId,
        width: g.width,
        paths: layer.paths.map((c) => ({
          closed: c.closed ? 1 : 0,
          nodes: c.nodes.map((n) => `${n.x} ${n.y} ${n.type.toUpperCase()}`),
        })),
        components: (g.components || []).map((c) => ({
          name: c.glyph,
          transform: `{${c.scaleX}, 0, 0, ${c.scaleY}, ${c.x}, ${c.y}}`,
        })),
        anchors: (g.anchors || []).map((a) => ({ name: a.name, position: `${a.x} ${a.y}` })),
      })),
    })),
    kerning: Object.entries(font.kerning).reduce<Record<string, Record<string, number>>>((acc, [k, v]) => {
      const [l, r] = k.split("|");
      const lk = `@${l}`, rk = `@${r}`;
      if (!acc[lk]) acc[lk] = {};
      acc[lk][rk] = v;
      return acc;
    }, {}),
    kerningGroups: font.kerningGroups,
    axes: font.axes,
    featureCode: font.featureCode,
    instances: font.instances,
  };
  return JSON.stringify(doc, null, 2);
}

function parseNodeToken(tok: unknown): FontNode {
  // Accepts "x y TYPE" strings or {x,y,type} objects.
  if (tok && typeof tok === "object") {
    const o = tok as Record<string, unknown>;
    return { x: Number(o.x) || 0, y: Number(o.y) || 0, type: String(o.type || "line").toLowerCase() as NodeType };
  }
  const parts = String(tok).trim().split(/\s+/);
  return { x: +parts[0] || 0, y: +parts[1] || 0, type: (parts[2] || "LINE").toLowerCase() as NodeType };
}

export function glyphsJsonToFont(text: string, fileName?: string): Font {
  let doc: Loose;
  try {
    doc = JSON.parse(text) as Loose;
  } catch {
    try {
      doc = parseOpenStep(text) as Loose;
    } catch {
      throw new Error("Could not parse .glyphs (tried JSON and OpenStep plist). The file may be corrupt or a .glyphspackage folder — open the package's font file instead.");
    }
  }
  const mastersRaw = (doc.fontMaster || doc.masters || [{ id: "masterRegular", name: "Regular" }]) as Loose[];
  const masters: FontMaster[] = mastersRaw.map((m, i) => ({
    id: m.id || m.layerId || (i === 0 ? "masterRegular" : `master${i}`),
    name: m.name || m.styleName || `Master ${i + 1}`,
    weightValue: Number(m.weightValue ?? 400) || 400,
  }));
  const glyphs: Glyph[] = ((doc.glyphs || []) as Loose[]).map((g) => {
    const layers: Record<string, GlyphLayer> = {};
    let components: Glyph["components"] = [];
    let anchors: Glyph["anchors"] = [];
    for (const layer of (g.layers || []) as Loose[]) {
      const lid = layer.layerId || layer.id || masters[0].id;
      layers[lid] = {
        paths: ((layer.paths || []) as Loose[]).map((c) => ({
          closed: c.closed === 1 || c.closed === true || String(c.closed) === "1",
          nodes: ((c.nodes || []) as unknown[]).map(parseNodeToken),
        })),
      };
      // Components/anchors are per-layer in Glyphs; this MVP keeps one set
      // per glyph (first layer wins) and documents the simplification.
      if (!components.length && Array.isArray(layer.components)) {
        components = (layer.components as Loose[]).map((c) => {
          const t = parseTransform(c.transform);
          return { glyph: String(c.name || ""), x: t.x, y: t.y, scaleX: t.scaleX, scaleY: t.scaleY };
        }).filter((c) => c.glyph);
      }
      if (!anchors.length && Array.isArray(layer.anchors)) {
        anchors = (layer.anchors as Loose[]).map((a) => {
          const p = parsePoint(a.position);
          return { name: String(a.name || "top"), x: p.x, y: p.y };
        });
      }
    }
    if (!Object.keys(layers).length) layers[masters[0].id] = { paths: [] };
    const width = +(g.width ?? g.layers?.[0]?.width ?? 500);
    return {
      name: g.glyphname || g.name || "unnamed",
      unicode: g.unicode ? parseInt(String(g.unicode), 16) : null,
      width, lsb: 40, rsb: 40,
      category: g.category || "Letter",
      kerningGroupLeft: g.leftKerningGroup || "",
      kerningGroupRight: g.rightKerningGroup || "",
      metricsKeyLeft: g.leftMetricsKey || "",
      metricsKeyRight: g.rightMetricsKey || "",
      anchors,
      components,
      layers,
    };
  });
  const kerning: Record<string, number> = {};
  for (const [lk, rv] of Object.entries((doc.kerning || {}) as Record<string, unknown>)) {
    if (rv && typeof rv === "object") {
      for (const [rk, v] of Object.entries(rv as Record<string, unknown>)) {
        kerning[`${lk.replace(/^@/, "")}|${rk.replace(/^@/, "")}`] = Number(v) || 0;
      }
    }
  }
  const kerningGroups: Record<string, number> = {};
  for (const [k, v] of Object.entries((doc.kerningGroups || {}) as Record<string, unknown>)) {
    kerningGroups[k] = Number(v) || 0;
  }
  const firstMaster: Loose = mastersRaw[0] || {};
  return {
    familyName: doc.familyName || "Imported Font",
    version: doc.versionString || "1.000",
    unitsPerEm: Number(doc.unitsPerEm) || 1000,
    ascender: Number(firstMaster.ascender ?? 800), descender: Number(firstMaster.descender ?? -200),
    capHeight: Number(firstMaster.capHeight ?? 700), xHeight: Number(firstMaster.xHeight ?? 500),
    masters,
    instances: doc.instances?.length ? doc.instances : [{ name: masters[0].name, masterId: masters[0].id, active: true }],
    glyphs: glyphs.length ? glyphs : [],
    kerning,
    kerningGroups,
    axes: Array.isArray(doc.axes) && doc.axes.length ? doc.axes : [{ tag: "wght", name: "Weight", min: 400, defaultValue: 400, max: 700 }],
    featureCode: typeof doc.featureCode === "string" ? doc.featureCode : DEFAULT_FEATURE_CODE,
    currentMasterId: masters[0].id,
    fileName: fileName || "Imported.glyphs",
  };
}

export function downloadText(filename: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadBytes(filename: string, bytes: Uint8Array<ArrayBuffer>, mime = "application/octet-stream"): void {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
