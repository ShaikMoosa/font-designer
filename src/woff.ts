// WOFF 1.0 wrapper for the SFNT bytes produced here (TTF). Each table is
// zlib-compressed with CompressionStream("deflate") when that shrinks it.
import { sfntChecksum } from "./ttf.ts";

interface SfntTable { tag: string; data: Uint8Array; offset: number }

export function parseSfntTables(bytes: Uint8Array): SfntTable[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const num = view.getUint16(4, false);
  const tables: SfntTable[] = [];
  for (let i = 0; i < num; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(bytes[rec], bytes[rec + 1], bytes[rec + 2], bytes[rec + 3]);
    const offset = view.getUint32(rec + 8, false);
    const length = view.getUint32(rec + 12, false);
    tables.push({ tag, data: bytes.slice(offset, offset + length), offset });
  }
  return tables;
}

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function flavorOf(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, false);
}

export async function fontToWoffBytes(sfnt: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const tables = parseSfntTables(sfnt).sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const compressed: Array<{ tag: string; orig: Uint8Array; stored: Uint8Array }> = [];
  for (const t of tables) {
    const z = await zlib(t.data);
    compressed.push({ tag: t.tag, orig: t.data, stored: z.length < t.data.length ? z : t.data });
  }
  const dirLen = 44 + compressed.length * 20;
  let offset = dirLen;
  const placed = compressed.map((c) => {
    const entry = { ...c, offset };
    offset += c.stored.length + ((4 - (c.stored.length % 4)) % 4);
    return entry;
  });
  const out = new Uint8Array(offset);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x774f4646, false); // 'wOFF'
  view.setUint32(4, flavorOf(sfnt), false);
  view.setUint32(8, out.length, false);
  view.setUint16(12, compressed.length, false);
  view.setUint16(14, 0, false);
  view.setUint32(16, sfnt.length, false);
  view.setUint16(20, 1, false); view.setUint16(22, 0, false);
  // meta/priv offsets+lengths (28..43) stay zero: no metadata blocks.
  placed.forEach((c, i) => {
    const rec = 44 + i * 20;
    out.set(new TextEncoder().encode(c.tag), rec);
    view.setUint32(rec + 4, c.offset, false);
    view.setUint32(rec + 8, c.stored.length, false);
    view.setUint32(rec + 12, c.orig.length, false);
    view.setUint32(rec + 16, sfntChecksum(c.orig), false);
    out.set(c.stored, c.offset);
  });
  return out as Uint8Array<ArrayBuffer>;
}
