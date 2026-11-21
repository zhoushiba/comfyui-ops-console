/**
 * 图片格式转换与缩略图（sharp）。
 * 转换失败不允许影响原图：调用方捕获异常后只记录 warning。
 */
import sharp from 'sharp';
import type { ImageFormat } from '../lib/image.js';

export interface ConverterOptions {
  thumbnailSize: number;
}

export interface ConvertedImage {
  buffer: Buffer;
  format: ImageFormat;
  width: number;
  height: number;
  quality: number;
}

export class ImageConverter {
  private readonly thumbnailSize: number;

  constructor(options: ConverterOptions) {
    this.thumbnailSize = options.thumbnailSize;
  }

  /** PNG ⇄ JPEG ⇄ WebP，quality 仅对 jpeg/webp 生效 */
  async convert(buffer: Buffer, format: ImageFormat, quality = 82): Promise<ConvertedImage> {
    const clampQuality = Math.max(1, Math.min(100, Math.round(quality)));
    let pipeline = sharp(buffer, { failOn: 'error', animated: false });
    switch (format) {
      case 'jpeg':
        pipeline = pipeline.jpeg({ quality: clampQuality, mozjpeg: true });
        break;
      case 'webp':
        pipeline = pipeline.webp({ quality: clampQuality });
        break;
      case 'png':
        pipeline = pipeline.png({ compressionLevel: 9 });
        break;
    }
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      buffer: data,
      format,
      width: info.width,
      height: info.height,
      quality: clampQuality,
    };
  }

  /** 生成保持比例的缩略图（默认 256px，输出 PNG） */
  async thumbnail(buffer: Buffer, size = this.thumbnailSize): Promise<Buffer> {
    return sharp(buffer, { failOn: 'error' })
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
}
