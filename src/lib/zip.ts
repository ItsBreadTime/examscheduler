/** Minimal deterministic ZIP writer (stored, no compression) — plan §58/§59 portable backup format. */
export interface ZipEntry { path: string; bytes: Uint8Array }
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
const crc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
export function createZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const directory: { nameBytes: Uint8Array; crc: number; size: number; offset: number }[] = [];
  let offset = 0;
  const u16 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
  const u32 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  const concat = (chunks: Uint8Array[]) => { const total = chunks.reduce((n, c) => n + c.length, 0); const out = new Uint8Array(total); let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; } return out; };
  for (const entry of [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const nameBytes = encoder.encode(entry.path);
    const crc = crc32(entry.bytes);
    const local = concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0x21), u16(0x5821), u32(crc), u32(entry.bytes.length), u32(entry.bytes.length), u16(nameBytes.length), u16(0), nameBytes, entry.bytes]);
    parts.push(local);
    directory.push({ nameBytes, crc, size: entry.bytes.length, offset });
    offset += local.length;
  }
  let centralSize = 0;
  const central: Uint8Array[] = directory.map(({ nameBytes, crc, size, offset: entryOffset }) => {
    const record = concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0x21), u16(0x5821), u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(entryOffset), nameBytes]);
    centralSize += record.length;
    return record;
  });
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(directory.length), u16(directory.length), u32(centralSize), u32(offset), u16(0)]);
  return concat([...parts, ...central, end]);
}
