/**
 * Minimal deterministic ZIP writer for retention archives.
 *
 * Entry order, fixed DOS timestamps and zlib settings are controlled here so
 * rebuilding the same source produces the same bytes. ZIP timestamps are
 * deliberately 1980-01-01; real source timestamps belong in the manifest.
 */

import zlib from 'node:zlib';

const UTF8_FLAG = 0x0800;
const DOS_TIME = 0;
const DOS_DATE = 0x0021; // 1980-01-01
const VERSION = 20;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function safeName(name) {
  const normalized = String(name).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) throw new Error(`unsafe ZIP path: ${name}`);
  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) throw new Error(`unsafe ZIP path: ${name}`);
  return normalized;
}

function asBuffer(data) {
  return Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
}

/**
 * @param {{path:string,data:Buffer|string}[]} entries
 * @returns {Buffer}
 */
export function createZip(entries) {
  const sorted = [...entries].map((entry) => ({ path: safeName(entry.path), data: asBuffer(entry.data) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const seen = new Set();
  for (const entry of sorted) {
    if (seen.has(entry.path)) throw new Error(`duplicate ZIP path: ${entry.path}`);
    seen.add(entry.path);
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of sorted) {
    const name = Buffer.from(entry.path, 'utf8');
    const crc = crc32(entry.data);
    const compressed = zlib.deflateRawSync(entry.data, { level: 9 });
    const useDeflate = compressed.length < entry.data.length;
    const payload = useDeflate ? compressed : entry.data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}
