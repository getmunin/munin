#!/usr/bin/env node
// Regenerates packages/backend-core/src/modules/teams/teams-icons.generated.ts:
// the two icons a Microsoft Teams app package requires. The color icon is the
// web app's 192×192 icon; the outline icon must be 32×32, white on transparent,
// so it is drawn here as a speech bubble.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const COLOR_SOURCE = fileURLToPath(new URL('../apps/web/public/icon-192.png', import.meta.url));
const OUT = fileURLToPath(
  new URL('../packages/backend-core/src/modules/teams/teams-icons.generated.ts', import.meta.url),
);

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng(size, alphaAt) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const alpha = alphaAt(x + 0.5, y + 0.5);
      row.writeUInt32BE((0xffffff00 | alpha) >>> 0, 1 + x * 4);
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function insideTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = sign(x, y, ax, ay, bx, by);
  const d2 = sign(x, y, bx, by, cx, cy);
  const d3 = sign(x, y, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function bubble(x, y) {
  const outer =
    insideRoundedRect(x, y, 3, 5, 29, 23, 5) ||
    insideTriangle(x, y, [8, 21], [15, 21], [8, 28]);
  const hole = insideRoundedRect(x, y, 5.5, 7.5, 26.5, 20.5, 3);
  return outer && !hole;
}

function outlineAlpha(x, y) {
  let hits = 0;
  for (const dx of [-0.25, 0.25]) {
    for (const dy of [-0.25, 0.25]) if (bubble(x + dx, y + dy)) hits += 1;
  }
  return Math.round((hits / 4) * 255);
}

const color = readFileSync(COLOR_SOURCE).toString('base64');
const outline = encodePng(32, outlineAlpha).toString('base64');

writeFileSync(
  OUT,
  `export const TEAMS_COLOR_ICON_PNG_BASE64 =\n  '${color}';\n\nexport const TEAMS_OUTLINE_ICON_PNG_BASE64 =\n  '${outline}';\n`,
);
console.log(`wrote ${OUT}`);
