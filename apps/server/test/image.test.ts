/** 图片校验、魔数识别、格式转换与缩略图 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  detectImageFormat,
  extensionForFormat,
  mimeForFormat,
  probeImage,
} from '../src/lib/image.js';
import { ImageConverter } from '../src/services/imageConverter.js';

async function gradientPng(width = 120, height = 90): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
}

describe('图片魔数识别', () => {
  it('识别 PNG / JPEG / WebP，并拒绝未知格式', async () => {
    const png = await gradientPng();
    const jpeg = await sharp(png).jpeg().toBuffer();
    const webp = await sharp(png).webp().toBuffer();
    expect(detectImageFormat(png)).toBe('png');
    expect(detectImageFormat(jpeg)).toBe('jpeg');
    expect(detectImageFormat(webp)).toBe('webp');
    expect(detectImageFormat(Buffer.from('GIF89a'))).toBeNull();
    expect(detectImageFormat(Buffer.alloc(0))).toBeNull();
    expect(mimeForFormat('jpeg')).toBe('image/jpeg');
    expect(extensionForFormat('jpeg')).toBe('jpg');
    expect(extensionForFormat('webp')).toBe('webp');
  });
});

describe('probeImage', () => {
  it('返回尺寸、字节数与 sha256', async () => {
    const png = await gradientPng(120, 90);
    const probe = await probeImage(png, '测试图');
    expect(probe.format).toBe('png');
    expect(probe.width).toBe(120);
    expect(probe.height).toBe(90);
    expect(probe.byteSize).toBe(png.length);
    expect(probe.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('空字节抛 IMAGE_EMPTY', async () => {
    const error = await probeImage(Buffer.alloc(0), '空图').catch((err: unknown) => err as { code?: string });
    expect(error.code).toBe('IMAGE_EMPTY');
  });

  it('截断的 PNG（魔数正确但数据不完整）抛 IMAGE_DECODE_FAILED', async () => {
    const png = await gradientPng(200, 200);
    const truncated = png.subarray(0, Math.floor(png.length * 0.6));
    const error = await probeImage(truncated, '截断图').catch(
      (err: unknown) => err as { code?: string; statusCode?: number },
    );
    expect(error.code).toBe('IMAGE_DECODE_FAILED');
    expect(error.statusCode).toBe(422);
  });
});

describe('ImageConverter', () => {
  const converter = new ImageConverter({ thumbnailSize: 256 });

  it('PNG 转 JPEG 与 WebP，质量被限制在 1~100', async () => {
    const png = await gradientPng(320, 240);
    const jpeg = await converter.convert(png, 'jpeg', 60);
    expect(detectImageFormat(jpeg.buffer)).toBe('jpeg');
    expect(jpeg.quality).toBe(60);
    expect(jpeg.width).toBe(320);

    const webp = await converter.convert(png, 'webp', 999);
    expect(detectImageFormat(webp.buffer)).toBe('webp');
    expect(webp.quality).toBe(100);
  });

  it('缩略图保持比例且最长边不超过 256', async () => {
    const png = await sharp({
      create: { width: 1000, height: 400, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .png()
      .toBuffer();
    const thumb = await converter.thumbnail(png);
    const meta = await sharp(thumb).metadata();
    expect(detectImageFormat(thumb)).toBe('png');
    expect(meta.width).toBe(256);
    expect(meta.height).toBeLessThanOrEqual(256);
  });

  it('转换非法字节时抛错，调用方可以只记录 warn 而不影响原图', async () => {
    await expect(converter.convert(Buffer.from('not-an-image'), 'webp')).rejects.toThrow();
  });
});
