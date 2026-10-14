// .glyphs JSON-subset import/export for this MVP.
// Real .glyphs files may be OpenStep plist; those are reported clearly
// instead of being silently misread. Export here is JSON so it round-trips.
export function fontToGlyphsJson(font) {
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
      layers: Object.entries(g.layers).map(([layerId, layer]) => ({
        layerId,
        width: g.width,
        paths: layer.paths.map((c) => ({
          closed: c.closed ? 1 : 0,
          nodes: c.nodes.map((n) => `${n.x} ${n.y} ${n.type.toUpperCase()}`),
        })),
        anchors: (g.anchors || []).map((a) => ({ name: a.name, position: `${a.x} ${a.y}` })),
      })),
    })),
    kerning: Object.entries(font.kerning).reduce((acc, [k, v]) => {
      const [l, r] = k.split("|");
      const lk = `@${l}`, rk = `@${r}`;
      if (!acc[lk]) acc[lk] = {};
      acc[lk][rk] = v;
      return acc;
    }, {}),
    instances: font.instances,
  };
  return JSON.stringify(doc, null, 2);
}

function parseNodeToken(tok) {
  // Accepts "x y TYPE" strings or {x,y,type} objects.
  if (tok && typeof tok === "object") {
    return { x: +tok.x || 0, y: +tok.y || 0, type: String(tok.type || "line").toLowerCase() };
  }
  const parts = String(tok).trim().split(/\s+/);
  return { x: +parts[0] || 0, y: +parts[1] || 0, type: (parts[2] || "LINE").toLowerCase() };
}

export function glyphsJsonToFont(text, fileName) {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    throw new Error("This looks like an OpenStep-plist .glyphs file. Re-export as JSON or import the font as UFO (.zip) instead.");
  }
  const doc = JSON.parse(text);
  const mastersRaw = doc.fontMaster || doc.masters || [{ id: "masterRegular", name: "Regular" }];
  const masters = mastersRaw.map((m, i) => ({
    id: m.id || m.layerId || (i === 0 ? "masterRegular" : `master${i}`),
    name: m.name || m.styleName || `Master ${i + 1}`,
    weightValue: m.weightValue ?? 400,
  }));
  const masterIds = new Set(masters.map((m) => m.id));
  const glyphs = (doc.glyphs || []).map((g) => {
    const layers = {};
    for (const layer of g.layers || []) {
      const lid = layer.layerId || layer.id || masters[0].id;
      if (!masterIds.has(lid) && (g.layers || []).length) {
        // Keep unknown layer ids so no outline data is dropped.
      }
      layers[lid] = {
        paths: (layer.paths || []).map((c) => ({
          closed: c.closed === 1 || c.closed === true,
          nodes: (c.nodes || []).map(parseNodeToken),
        })),
      };
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
      anchors: [],
      layers,
    };
  });
  const kerning = {};
  for (const [lk, rv] of Object.entries(doc.kerning || {})) {
    if (rv && typeof rv === "object") {
      for (const [rk, v] of Object.entries(rv)) {
        kerning[`${lk.replace(/^@/, "")}|${rk.replace(/^@/, "")}`] = +v || 0;
      }
    }
  }
  const firstMaster = mastersRaw[0] || {};
  return {
    familyName: doc.familyName || "Imported Font",
    version: doc.versionString || "1.000",
    unitsPerEm: doc.unitsPerEm || 1000,
    ascender: firstMaster.ascender ?? 800, descender: firstMaster.descender ?? -200,
    capHeight: firstMaster.capHeight ?? 700, xHeight: firstMaster.xHeight ?? 500,
    masters,
    instances: doc.instances?.length ? doc.instances : [{ name: masters[0].name, masterId: masters[0].id, active: true }],
    glyphs: glyphs.length ? glyphs : [],
    kerning,
    currentMasterId: masters[0].id,
    fileName: fileName || "Imported.glyphs",
  };
}

export function downloadText(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadBytes(filename, bytes, mime = "application/octet-stream") {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
