// Generates PWA app icons as raw PNGs with zero external dependencies (no canvas/sharp/ImageMagick
// available in this environment) — a minimal from-scratch PNG encoder (IHDR/IDAT/IEND chunks, zlib
// for DEFLATE, manual CRC32) rasterizing a simple 4-point sparkle over the calculator's own theme
// colors (--bg: #15131f, --accent: #d9a441), 4x supersampled then box-downsampled for anti-aliasing.
const fs = require('fs');
const zlib = require('zlib');

const BG = [0x15, 0x13, 0x1f]; // --bg
const ACCENT = [0xd9, 0xa4, 0x41]; // --accent

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// Signed area of point relative to an edge, for point-in-polygon (4-point sparkle/star).
function pointInStar(px, py, cx, cy, outerR, innerR) {
  // 8-vertex star (4 outer + 4 inner points), sampled via angle-based radius function.
  const dx = px - cx, dy = py - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return true;
  let ang = Math.atan2(dy, dx) + Math.PI / 2; // rotate so a point aims up
  if (ang < 0) ang += Math.PI * 2;
  const seg = (ang % (Math.PI / 2)) / (Math.PI / 2); // 0..1 within each quadrant (4-fold symmetry)
  const t = seg <= 0.5 ? seg * 2 : (1 - seg) * 2; // 0 at point tip, 1 at inner valley... invert below
  const r = outerR - (outerR - innerR) * t;
  return dist <= r;
}

function renderIcon(size, { maskableSafe = false } = {}) {
  const SS = 4; // supersample factor for anti-aliasing
  const W = size * SS, H = size * SS;
  const buf = Buffer.alloc(W * H * 4);
  const cx = W / 2, cy = H / 2;
  // Maskable icons need content within the safe zone (inner ~80% diameter); non-maskable can use
  // more of the canvas. Star sized accordingly either way.
  const maxR = maskableSafe ? W * 0.30 : W * 0.38;
  const innerR = maxR * 0.42;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inStar = pointInStar(x + 0.5, y + 0.5, cx, cy, maxR, innerR);
      const color = inStar ? ACCENT : BG;
      buf[i] = color[0]; buf[i + 1] = color[1]; buf[i + 2] = color[2]; buf[i + 3] = 255;
    }
  }
  // Box downsample W×H -> size×size for anti-aliasing.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const si = ((y * SS + sy) * W + (x * SS + sx)) * 4;
          r += buf[si]; g += buf[si + 1]; b += buf[si + 2]; a += buf[si + 3];
        }
      }
      const n = SS * SS;
      const oi = (y * size + x) * 4;
      out[oi] = Math.round(r / n); out[oi + 1] = Math.round(g / n);
      out[oi + 2] = Math.round(b / n); out[oi + 3] = Math.round(a / n);
    }
  }
  return out;
}

const dir = __dirname + '/icons';
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
for (const size of [192, 512]) {
  fs.writeFileSync(`${dir}/icon-${size}.png`, encodePNG(size, size, renderIcon(size)));
  fs.writeFileSync(`${dir}/icon-${size}-maskable.png`, encodePNG(size, size, renderIcon(size, { maskableSafe: true })));
}
console.log('Icons written to', dir);
