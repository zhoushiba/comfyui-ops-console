/**
 * 图片字节校验与元数据探测。
 *
 * 安全边界：不信任上游的 Content-Type，先校验魔数，再交给 sharp 完整解码。
 * "完整解码"很关键：mock 的 partial 模式返回被截断的 PNG（魔数正确），
 * 只读头部会误判为合法图片，全量解码才能发现数据不完整。
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { UnprocessableError } from './errors.js';

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export const SUPPORTED_FORMATS: ImageFormat[] = ['png', 'jpeg', 'webp'];

export interface ImageProbe {
  format: ImageFormat;
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** 魔数识别：PNG 8 字节、JPEG 3 字节、WebP 12 字节（RIFF....WEBP） */
export function detectImageFormat(buffer: Buffer): ImageFormat | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export function mimeForFormat(format: ImageFormat): string {
  switch (format) {
    case 'png':
      return 'image/png';
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
  }
}

export function extensionForFormat(format: ImageFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

/**
 * 校验图片并提取元数据。失败抛出 422 IMAGE_INVALID，
 * 调用方据此把任务置为 failed 且保留错误详情（不写入半截文件）。
 */
export async function probeImage(buffer: Buffer, sourceLabel = 'image'): Promise<ImageProbe> {
  if (buffer.length === 0) {
    throw new UnprocessableError(`${sourceLabel} 字节为空`, 'IMAGE_EMPTY');
  }
  const format = detectImageFormat(buffer);
  if (!format) {
    throw new UnprocessableError(
      `${sourceLabel} 不是受支持的图片格式（仅 PNG/JPEG/WebP）`,
      'IMAGE_FORMAT_UNSUPPORTED',
      { headHex: buffer.subarray(0, 12).toString('hex') },
    );
  }

  try {
    // 完整解码一次，能发现截断/损坏的文件
    const { info } = await sharp(buffer, { failOn: 'error' }).raw().toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height) {
      throw new Error('图片尺寸为 0');
    }
    return {
      format,
      width: info.width,
      height: info.height,
      byteSize: buffer.length,
      sha256: sha256(buffer),
    };
  } catch (error) {
    throw new UnprocessableError(
      `${sourceLabel} 解码失败：${(error as Error).message}`,
      'IMAGE_DECODE_FAILED',
      { format, byteSize: buffer.length },
    );
  }
}
