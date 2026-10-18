// UFO 3 export/import as a .zip (stored entries) so Windows users get a
// real interchange file without a native packager. GLIF points map:
// line/curve/smooth keep their type; offcurve points omit `type`.
import { DEFAULT_FEATURE_CODE, resolveGlyphContours } from "./model.ts";
import { effectiveFeatureCode } from "./shaping.ts";
import type { Anchor, Contour, Font, FontNode, Glyph } from "./model.ts";

export interface ZipFile { name: string; data: string | Uint8Array }
export interface ParsedGlif {
  name: string; unicode: number | null; width: number; paths: Contour[]; anchors: Anchor[];
  productionName?: string; tags?: string[]; colorLabel?: number; note?: string;
  glyphCase?: "" | "upper" | "lower"; scriptOverride?: string;
}
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function zipStore(files: ZipFile[]): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, 0, true); local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true); cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  for (const c of central) { out.set(c, p); p += c.length; }
  out.set(new Uint8Array(end.buffer), p);
  return out;
}

export async function unzipToMap(arrayBuffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  // Find End of Central Directory.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP file.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const map = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = bytes.subarray(dataStart, dataStart + compSize);
    if (method === 0) map.set(name, comp.slice());
    else if (method === 8 && typeof DecompressionStream !== "undefined") {
      const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      map.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}.`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return map;
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

export function glyphNameToFile(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, "_");
  return `${safe}.glif`;
}

export function glyphToGlif(glyph: Glyph, masterId: string, contoursOverride?: Contour[]): string {
  const layer = glyph.layers[masterId] || { paths: [] };
  const contours = contoursOverride ?? layer.paths;
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<glyph name="${esc(glyph.name)}" format="2">`);
  lines.push(`  <advance width="${glyph.width}"/>`);
  if (glyph.unicode != null) lines.push(`  <unicode hex="${glyph.unicode.toString(16).toUpperCase().padStart(4, "0")}"/>`);
  lines.push("  <outline>");
  for (const c of contours) {
    lines.push("    <contour>");
    c.nodes.forEach((nd, idx) => {
      const typeAttr = nd.type === "offcurve" ? "" : ` type="${nd.type === "curve" || nd.type === "smooth" ? nd.type : "line"}"`;
      const moveAttr = !c.closed && idx === 0 ? ' type="move"' : typeAttr;
      lines.push(`      <point x="${nd.x}" y="${nd.y}"${moveAttr}/>`);
    });
    lines.push("    </contour>");
  }
  lines.push("  </outline>");
  for (const a of glyph.anchors || []) lines.push(`  <anchor name="${esc(a.name)}" x="${a.x}" y="${a.y}"/>`);
  if (glyph.note) lines.push(`  <note>${esc(glyph.note)}</note>`);
  const lib: string[] = [];
  if (glyph.productionName) lib.push(`    <key>com.glyphswindows.productionName</key>\n    <string>${esc(glyph.productionName)}</string>`);
  if (glyph.tags?.length) {
    lib.push(`    <key>com.glyphswindows.tags</key>\n    <array>\n${glyph.tags.map((t) => `      <string>${esc(t)}</string>`).join("\n")}\n    </array>`);
  }
  if (glyph.colorLabel != null && glyph.colorLabel >= 0) lib.push(`    <key>com.glyphswindows.colorLabel</key>\n    <integer>${glyph.colorLabel}</integer>`);
  if (glyph.glyphCase) lib.push(`    <key>com.glyphswindows.case</key>\n    <string>${esc(glyph.glyphCase)}</string>`);
  if (glyph.scriptOverride) lib.push(`    <key>com.glyphswindows.script</key>\n    <string>${esc(glyph.scriptOverride)}</string>`);
  if (lib.length) lines.push(`  <lib>\n    <dict>\n${lib.join("\n")}\n    </dict>\n  </lib>`);
  lines.push("</glyph>");
  return lines.join("\n");
}

export function parseGlif(xmlText: string, fallbackName?: string): ParsedGlif {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const gEl = doc.querySelector("glyph");
  if (!gEl) throw new Error("GLIF missing <glyph>.");
  const name = gEl.getAttribute("name") || fallbackName || "unnamed";
  const adv = doc.querySelector("advance");
  const width = adv ? Number(adv.getAttribute("width")) || 500 : 500;
  const uniEl = doc.querySelector("unicode");
  const unicode = uniEl ? parseInt(uniEl.getAttribute("hex") ?? "", 16) : null;
  const paths: Contour[] = [];
  doc.querySelectorAll("contour").forEach((cEl) => {
    const nodes: FontNode[] = [];
    let closed = true;
    cEl.querySelectorAll("point").forEach((pEl, idx) => {
      const t = pEl.getAttribute("type");
      if (idx === 0 && t === "move") closed = false;
      nodes.push({
        x: Number(pEl.getAttribute("x")) || 0, y: Number(pEl.getAttribute("y")) || 0,
        type: t === "curve" || t === "smooth" ? t : t === "move" || t === "line" ? "line" : "offcurve",
      });
    });
    if (nodes.length) paths.push({ closed, nodes });
  });
  const anchors: Anchor[] = [];
  doc.querySelectorAll("anchor").forEach((aEl) => {
    anchors.push({ name: aEl.getAttribute("name") || "top", x: Number(aEl.getAttribute("x")) || 0, y: Number(aEl.getAttribute("y")) || 0 });
  });
  const note = doc.querySelector("note")?.textContent || undefined;
  // Lib values are read with targeted regexes over the serialized lib dict
  // to keep this parser free of plist plumbing.
  const libMatch = xmlText.match(/<lib>[\s\S]*?<\/lib>/)?.[0] ?? "";
  const libString = (key: string): string | undefined =>
    libMatch.match(new RegExp(`<key>${key.replace(/\./g, "\\.")}</key>\\s*<string>([^<]*)</string>`))?.[1];
  const tagsBlock = libMatch.match(/<key>com\.glyphswindows\.tags<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1];
  const tags = tagsBlock ? [...tagsBlock.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]) : undefined;
  const colorRaw = libMatch.match(/<key>com\.glyphswindows\.colorLabel<\/key>\s*<integer>(-?\d+)<\/integer>/)?.[1];
  const caseRaw = libString("com.glyphswindows.case");
  return {
    name, unicode, width, paths, anchors, note,
    productionName: libString("com.glyphswindows.productionName"),
    tags,
    colorLabel: colorRaw != null ? Number(colorRaw) : undefined,
    glyphCase: caseRaw === "upper" || caseRaw === "lower" ? caseRaw : "",
    scriptOverride: libString("com.glyphswindows.script") || "",
  };
}

function plistDict(entries: Array<[string, string | number]>): string {
  const body = entries.map(([k, v]) => {
    const val = typeof v === "number" ? `<integer>${v}</integer>` : `<string>${esc(v)}</string>`;
    return `    <key>${esc(k)}</key>\n    ${val}`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n  <dict>\n${body}\n  </dict>\n</plist>\n`;
}

export function buildUfoFiles(font: Font, masterId: string): ZipFile[] {
  const files: ZipFile[] = [];
  files.push({ name: "metainfo.plist", data: plistDict([["creator", "Glyphs for Windows MVP"], ["formatVersion", 3]]) });
  files.push({
    name: "layercontents.plist",
    data: `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n  <array>\n    <array>\n      <string>public.default</string>\n      <string>glyphs</string>\n    </array>\n  </array>\n</plist>\n`,
  });
  files.push({
    name: "fontinfo.plist",
    data: plistDict([
      ["familyName", font.familyName], ["styleName", "Regular"], ["versionMajor", 1], ["versionMinor", 0],
      ["unitsPerEm", font.unitsPerEm], ["ascender", font.ascender], ["descender", font.descender],
      ["capHeight", font.capHeight], ["xHeight", font.xHeight],
    ]),
  });
  const contents = font.glyphs.map((g) => `    <key>${esc(g.name)}</key>\n    <string>${esc(glyphNameToFile(g.name))}</string>`).join("\n");
  files.push({
    name: "glyphs/contents.plist",
    data: `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n  <dict>\n${contents}\n  </dict>\n</plist>\n`,
  });
  // Components are decomposed to plain contours on UFO export.
  for (const g of font.glyphs) files.push({ name: `glyphs/${glyphNameToFile(g.name)}`, data: glyphToGlif(g, masterId, resolveGlyphContours(font, g, masterId)) });
  const kernLines = Object.entries(font.kerning).map(([k, v]) => {
    const [l, r] = k.split("|");
    return `    <key>${esc(l)}</key>\n    <dict><key>${esc(r)}</key><integer>${v}</integer></dict>`;
  }).join("\n");
  files.push({
    name: "kerning.plist",
    data: `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n  <dict>\n${kernLines}\n  </dict>\n</plist>\n`,
  });
  const groupLines = Object.entries(font.kerningGroups || {}).map(([k, v]) => `    <key>${esc(k)}</key>\n    <integer>${v}</integer>`).join("\n");
  files.push({
    name: "kerning-groups.plist",
    data: `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n  <dict>\n${groupLines}\n  </dict>\n</plist>\n`,
  });
  files.push({
    name: "features.fea",
    data: effectiveFeatureCode(font),
  });
  files.push({
    name: "designspace.json",
    data: JSON.stringify({
      format: "glyphs-windows-designspace-manifest",
      axes: font.axes, masters: font.masters, instances: font.instances, autohintTT: font.autohintTT === true,
      note: "Manifest for masters/axes/instances; outlines in this UFO are the active (or instance) master, decomposed.",
    }, null, 2),
  });
  return files;
}

export function fontToUfoZip(font: Font, masterIdOverride?: string): Uint8Array<ArrayBuffer> {
  return zipStore(buildUfoFiles(font, masterIdOverride ?? font.currentMasterId));
}

// Bundle for the compile service: one UFO folder per master plus the
// manifest the service turns into a real designspace for variable builds.
export function fontToDesignspaceBundle(font: Font): Uint8Array<ArrayBuffer> {
  const files: ZipFile[] = [];
  for (const master of font.masters) {
    for (const f of buildUfoFiles(font, master.id)) {
      files.push({ name: `masters/${master.id}/${f.name}`, data: f.data });
    }
  }
  files.push({
    name: "designspace.json",
    data: JSON.stringify({
      format: "glyphs-windows-designspace-bundle",
      familyName: font.familyName, unitsPerEm: font.unitsPerEm,
      axes: font.axes, masters: font.masters, instances: font.instances, autohintTT: font.autohintTT === true,
    }, null, 2),
  });
  return zipStore(files);
}

export function ufoMapToFont(map: Map<string, Uint8Array>, fileName?: string): Font {
  const glyphs: Glyph[] = [];
  let familyName = "Imported UFO";
  const infoBytes = map.get("fontinfo.plist");
  let unitsPerEm = 1000, ascender = 800, descender = -200, capHeight = 700, xHeight = 500;
  if (infoBytes) {
    const txt = dec.decode(infoBytes);
    const grab = (key: string): string | null => {
      const m = txt.match(new RegExp(`<key>${key}<\\/key>\\s*<(?:string|integer)>([^<]+)`));
      return m ? m[1] : null;
    };
    familyName = grab("familyName") || familyName;
    unitsPerEm = +(grab("unitsPerEm") || unitsPerEm);
    ascender = +(grab("ascender") || ascender); descender = +(grab("descender") || descender);
    capHeight = +(grab("capHeight") || capHeight); xHeight = +(grab("xHeight") || xHeight);
  }
  for (const [path, bytes] of map.entries()) {
    if (!path.startsWith("glyphs/") || !path.endsWith(".glif")) continue;
    const base = (path.split("/").pop() ?? path).replace(/\.glif$/i, "");
    try {
      const parsed = parseGlif(dec.decode(bytes), base);
      glyphs.push({
        name: parsed.name, unicode: parsed.unicode, width: parsed.width, lsb: 40, rsb: 40,
        category: "Letter", kerningGroupLeft: "", kerningGroupRight: "",
        metricsKeyLeft: "", metricsKeyRight: "", components: [],
        productionName: parsed.productionName || "", tags: parsed.tags || [],
        colorLabel: parsed.colorLabel, note: parsed.note || "",
        glyphCase: parsed.glyphCase || "", scriptOverride: parsed.scriptOverride || "",
        anchors: parsed.anchors, layers: { masterRegular: { paths: parsed.paths } },
      });
    } catch { /* skip unreadable glyph, keep importing the rest */ }
  }
  glyphs.sort((a, b) => (a.unicode ?? 0x10000) - (b.unicode ?? 0x10000) || a.name.localeCompare(b.name));
  const kerning: Record<string, number> = {};
  const kernBytes = map.get("kerning.plist");
  if (kernBytes) {
    const txt = dec.decode(kernBytes);
    const pairRe = /<key>([^<]+)<\/key>\s*<dict><key>([^<]+)<\/key><integer>(-?\d+)<\/integer>/g;
    let m;
    while ((m = pairRe.exec(txt))) kerning[`${m[1]}|${m[2]}`] = +m[3];
  }
  const kerningGroups: Record<string, number> = {};
  const groupBytes = map.get("kerning-groups.plist");
  if (groupBytes) {
    const txt = dec.decode(groupBytes);
    const groupRe = /<key>([^<]+)<\/key>\s*<integer>(-?\d+)<\/integer>/g;
    let gm: RegExpExecArray | null;
    while ((gm = groupRe.exec(txt))) kerningGroups[gm[1]] = +gm[2];
  }
  let axes: Font["axes"] = [{ tag: "wght", name: "Weight", min: 400, defaultValue: 400, max: 700 }];
  let masters: Font["masters"] = [{ id: "masterRegular", name: "Regular", weightValue: 400 }];
  let instances: Font["instances"] = [{ name: "Regular", masterId: "masterRegular", active: true }];
  let autohintTT = false;
  const dsBytes = map.get("designspace.json");
  if (dsBytes) {
    try {
      const ds = JSON.parse(dec.decode(dsBytes)) as { axes?: Font["axes"]; masters?: Font["masters"]; instances?: Font["instances"]; autohintTT?: boolean };
      if (ds.axes?.length) axes = ds.axes;
      if (ds.masters?.length) masters = ds.masters;
      if (ds.instances?.length) instances = ds.instances;
      autohintTT = ds.autohintTT === true;
    } catch { /* manifest is best-effort; outlines already imported */ }
  }
  // Imported layers live under masterRegular; remap to the first manifest master.
  if (masters[0].id !== "masterRegular") {
    for (const g of glyphs) {
      if (g.layers.masterRegular) { g.layers[masters[0].id] = g.layers.masterRegular; delete g.layers.masterRegular; }
    }
  }
  const feaBytes = map.get("features.fea");
  return {
    familyName, version: "1.000", unitsPerEm, ascender, descender, capHeight, xHeight,
    masters, instances, glyphs, kerning, kerningGroups, axes,
    featureCode: feaBytes ? dec.decode(feaBytes) : DEFAULT_FEATURE_CODE,
    autohintTT,
    currentMasterId: masters[0].id, fileName: fileName || "Imported.ufo",
  };
}
