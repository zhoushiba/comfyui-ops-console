/**
 * 零依赖 PNG 编码器。
 *
 * 真实 ComfyUI 的 /view 返回的是图片字节，mock 如果返回空文件，
 * 编排层的图片校验就失去意义，因此这里用 node:zlib 手写 PNG：
 *   PNG 签名 + IHDR + IDAT(zlib deflate) + IEND，每块自带 CRC32。
 * 图片内容是按种子生成的渐变 + 网格线，便于肉眼确认"确实是出图了"。
 */
import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE: number[] = (() => {
  const table: number[] = new Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** 把字符串散列成稳定的 32 位种子，保证同一 filename 每次返回同一张图 */
export function seedFromString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface GradientOptions {
  width?: number;
  height?: number;
  seed?: number;
}

/**
 * 生成渐变 + 噪点的 RGB 像素缓冲（PNG 使用 filter byte 0 的原始扫描线）。
 */
export function renderGradient(options: GradientOptions = {}): {
  width: number;
  height: number;
  rgb: Buffer;
} {
  const width = options.width ?? 512;
  const height = options.height ?? 512;
  const seed = options.seed ?? 1;
  const rgb = Buffer.alloc(width * height * 3);
  const hueShift = (seed % 360) / 360;

  let state = (seed || 1) >>> 0;
  const nextRandom = (): number => {
    // xorshift32，保证可复现
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1000) / 1000;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = x / (width - 1);
      const ny = y / (height - 1);
      // 两段式色相渐变：左上偏橙，右下偏蓝紫
      const hue = (hueShift + nx * 0.45 + (1 - ny) * 0.25) % 1;
      const [r, g, b] = hueToRgb(hue);
      const vignette = 0.55 + 0.45 * Math.sin(Math.PI * nx) * Math.sin(Math.PI * ny);
      const noise = (nextRandom() - 0.5) * 14;
      const grid = x % 64 === 0 || y % 64 === 0 ? -18 : 0;
      const offset = (y * width + x) * 3;
      rgb[offset] = clamp(r * vignette + noise + grid);
      rgb[offset + 1] = clamp(g * vignette + noise + grid);
      rgb[offset + 2] = clamp(b * vignette + noise + grid);
    }
  }
  return { width, height, rgb };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hueToRgb(hue: number): [number, number, number] {
  const h = hue * 6;
  const sector = Math.floor(h) % 6;
  const f = h - Math.floor(h);
  const q = 255 * (1 - f);
  const t = 255 * f;
  switch (sector) {
    case 0:
      return [255, t, 0];
    case 1:
      return [q, 255, 0];
    case 2:
      return [0, 255, t];
    case 3:
      return [0, q, 255];
    case 4:
      return [t, 0, 255];
    default:
      return [255, 0, q];
  }
}

/** 把 RGB 原始像素编码成合法 PNG（8bit truecolor） */
export function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 生成一张 512x512 的真实 PNG，filename 决定图像内容 */
export function generatePng(filename: string, size = 512): Buffer {
  const { width, height, rgb } = renderGradient({
    width: size,
    height: size,
    seed: seedFromString(filename),
  });
  return encodePng(width, height, rgb);
}
