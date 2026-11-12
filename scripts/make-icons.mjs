// Draws the Relay mark (two opposing arrows) into the PNG assets Expo needs. No dependencies.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x0b, 0x0d, 0x10];
const ACCENT = [0x2d, 0xe1, 0xc2];
const WHITE = [0xff, 0xff, 0xff];

const SEGMENTS = [
  [0.3, 0.36, 0.7, 0.36], [0.61, 0.27, 0.7, 0.36], [0.61, 0.45, 0.7, 0.36],
  [0.3, 0.64, 0.7, 0.64], [0.39, 0.55, 0.3, 0.64], [0.39, 0.73, 0.3, 0.64],
];
const HALF_STROKE = 0.034;

function distance(px, py, [ax, ay, bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** scale shrinks the mark around the centre; background null = transparent. */
function render(size, { scale, mark, background, rounded }) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const aa = 1.5 / size / scale;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size - 0.5) / scale + 0.5;
      const v = ((y + 0.5) / size - 0.5) / scale + 0.5;
      let d = Infinity;
      for (const s of SEGMENTS) d = Math.min(d, distance(u, v, s));
      const ink = Math.max(0, Math.min(1, (HALF_STROKE - d) / aa + 0.5));
      let bgAlpha = background ? 1 : 0;
      if (background && rounded) {
        // Rounded-square mask for the legacy launcher icon.
        const r = 0.22, qx = Math.abs((x + 0.5) / size - 0.5) - (0.5 - r), qy = Math.abs((y + 0.5) / size - 0.5) - (0.5 - r);
        const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
        bgAlpha = Math.max(0, Math.min(1, 0.5 - outside * size));
      }
      const o = row + 1 + x * 4;
      const base = background ?? mark;
      raw[o] = Math.round(base[0] + (mark[0] - base[0]) * ink);
      raw[o + 1] = Math.round(base[1] + (mark[1] - base[1]) * ink);
      raw[o + 2] = Math.round(base[2] + (mark[2] - base[2]) * ink);
      raw[o + 3] = Math.round(255 * (background ? bgAlpha : ink));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../assets/', import.meta.url);
writeFileSync(new URL('icon.png', out), render(1024, { scale: 1, mark: ACCENT, background: BG, rounded: true }));
writeFileSync(new URL('android-icon-foreground.png', out), render(1024, { scale: 0.62, mark: ACCENT, background: null }));
writeFileSync(new URL('android-icon-monochrome.png', out), render(1024, { scale: 0.62, mark: WHITE, background: null }));
writeFileSync(new URL('splash-icon.png', out), render(512, { scale: 1, mark: ACCENT, background: null }));
console.log('icons written');
