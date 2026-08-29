import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SIZE = 1024;
const SAMPLES = 4;

const NIGHT = [10, 14, 17];
const ICE = [47, 224, 245];
const INNER = NIGHT.map((channel, index) => Math.round(channel + (ICE[index] - channel) * 0.11));

const CORNER = 0.176;
const HEX_RADIUS = 0.4;
const RING = 0.032;

const LETTER = 0.9;
const shrink = (value) => 0.5 + (value - 0.5) * LETTER;

const STEM_LEFT = shrink(0.328);
const STEM_RIGHT = shrink(0.408);
const TOP = shrink(0.31);
const BOTTOM = shrink(0.69);
const ARM_TIP_X = shrink(0.676);
const ARM_WIDTH = 0.08 * LETTER;
const JUNCTION = [shrink(0.372), 0.5];

function hexVertices(scale) {
  const radius = HEX_RADIUS * scale;
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 180) * (index * 60 - 90);
    return [0.5 + radius * Math.cos(angle), 0.5 + radius * Math.sin(angle)];
  });
}

const OUTER_HEX = hexVertices(1);
const INNER_HEX = hexVertices(1 - RING / (HEX_RADIUS * Math.cos(Math.PI / 6)));

function insideConvex(polygon, x, y) {
  for (let index = 0; index < polygon.length; index += 1) {
    const [ax, ay] = polygon[index];
    const [bx, by] = polygon[(index + 1) % polygon.length];
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) return false;
  }
  return true;
}

function insideRounded(x, y) {
  const dx = Math.max(CORNER - x, 0, x - (1 - CORNER));
  const dy = Math.max(CORNER - y, 0, y - (1 - CORNER));
  if (dx === 0 || dy === 0) return true;
  return dx * dx + dy * dy <= CORNER * CORNER;
}

function insideSegment(x, y, ax, ay, bx, by, width) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const px = x - ax;
  const py = y - ay;
  const along = px * ux + py * uy;
  if (along < 0 || along > length) return false;
  return Math.abs(px * -uy + py * ux) <= width / 2;
}

function insideLetter(x, y) {
  if (x >= STEM_LEFT && x <= STEM_RIGHT && y >= TOP && y <= BOTTOM) return true;
  if (insideSegment(x, y, JUNCTION[0], JUNCTION[1], ARM_TIP_X, TOP + ARM_WIDTH / 2 - 0.004, ARM_WIDTH)) return true;
  if (insideSegment(x, y, JUNCTION[0], JUNCTION[1], ARM_TIP_X, BOTTOM - ARM_WIDTH / 2 + 0.004, ARM_WIDTH)) return true;
  return false;
}

function sampleColor(x, y) {
  if (!insideRounded(x, y)) return null;
  if (insideLetter(x, y)) return ICE;
  if (insideConvex(OUTER_HEX, x, y)) {
    return insideConvex(INNER_HEX, x, y) ? INNER : ICE;
  }
  return NIGHT;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SAMPLES);
  const offset = step / 2;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;

      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px * SAMPLES + sx) * step + offset;
          const y = (py * SAMPLES + sy) * step + offset;
          const color = sampleColor(x, y);
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          hits += 1;
        }
      }

      const index = (py * size + px) * 4;
      if (hits === 0) continue;

      pixels[index] = Math.round(r / hits);
      pixels[index + 1] = Math.round(g / hits);
      pixels[index + 2] = Math.round(b / hits);
      pixels[index + 3] = Math.round((hits / (SAMPLES * SAMPLES)) * 255);
    }
  }

  return pixels;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let row = 0; row < size; row += 1) {
    raw[row * (size * 4 + 1)] = 0;
    pixels.copy(raw, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const buildDir = join(root, "build");
mkdirSync(buildDir, { recursive: true });

const png = encodePng(render(SIZE), SIZE);
writeFileSync(join(buildDir, "icon.png"), png);

console.log(`build/icon.png — ${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(1)} KB`);
