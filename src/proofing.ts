// Export proofing (Phase 8): every binary font export is read back by
// fontTools through the compile service's /validate endpoint before it
// is delivered. A failed readback blocks the export; an unavailable
// service blocks it on desktop (where the bundled sidecar should be
// running) and only warns in the browser.

export interface ExportProof {
  available: boolean;
  ok: boolean;
  glyphCount?: number;
  cmapMappings?: number;
  tables?: string[];
  flavor?: string | null;
  familyName?: string | null;
  error?: string;
}

type FetchFn = (url: string, init: { method: string; body: Uint8Array<ArrayBuffer> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export async function proofExportBytes(
  bytes: Uint8Array<ArrayBuffer>,
  serviceUrl: string,
  fetchFn: FetchFn = fetch as unknown as FetchFn,
): Promise<ExportProof> {
  let res: Awaited<ReturnType<FetchFn>>;
  try {
    res = await fetchFn(`${serviceUrl}/validate`, { method: "POST", body: bytes });
  } catch {
    return { available: false, ok: false, error: "compile service unreachable" };
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch { /* keep the HTTP status as the detail */ }
    return { available: true, ok: false, error: detail };
  }
  const report = (await res.json()) as ExportProof;
  return { ...report, available: true, ok: report.ok === true };
}

/** Delivery decision: proof failure always blocks; an unavailable
 * service blocks on desktop and warns in the browser. */
export function proofGate(proof: ExportProof, desktop: boolean): { deliver: boolean; note: string } {
  if (proof.available && proof.ok) {
    return {
      deliver: true,
      note: `fontTools readback OK (${proof.glyphCount ?? "?"} glyphs, ${proof.cmapMappings ?? "?"} cmap mappings, tables: ${(proof.tables ?? []).join(" ")})`,
    };
  }
  if (proof.available) {
    return { deliver: false, note: `fontTools readback FAILED: ${proof.error || "unknown error"}` };
  }
  if (desktop) {
    return { deliver: false, note: "fontTools proof unavailable — the bundled compile service did not answer, so the export was blocked." };
  }
  return { deliver: true, note: "exported without fontTools proof (compile service offline)" };
}
