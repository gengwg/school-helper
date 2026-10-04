import { inflateRawSync } from 'node:zlib';

/** Minimal zip reader: returns the text entries (WhatsApp exports hold one .txt plus media). */
export function textEntries(zip: Buffer): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  let eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return out;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) break;
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOff = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.toLowerCase().endsWith('.txt')) continue;
    const lNameLen = zip.readUInt16LE(localOff + 26);
    const lExtraLen = zip.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = zip.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(raw) : method === 0 ? raw : null;
    if (data) out.push({ name, text: data.toString('utf8') });
  }
  return out;
}

export const isZip = (mimeType: string, filename = '') =>
  mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed' || filename.toLowerCase().endsWith('.zip');
