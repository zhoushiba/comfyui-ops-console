/** 本地图片存储：相对路径入库，便于迁移到对象存储适配层 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function safeSegment(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_');
  return cleaned.length > 0 ? cleaned : 'file';
}

export class StorageService {
  readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  async ensure(): Promise<void> {
    await mkdir(path.join(this.rootDir, 'originals'), { recursive: true });
    await mkdir(path.join(this.rootDir, 'thumbs'), { recursive: true });
    await mkdir(path.join(this.rootDir, 'converted'), { recursive: true });
  }

  abs(relPath: string): string {
    const resolved = path.resolve(this.rootDir, relPath);
    if (!resolved.startsWith(this.rootDir)) {
      throw new Error(`非法存储路径: ${relPath}`);
    }
    return resolved;
  }

  /** 原始图： originals/<taskNo>/<filename> */
  originalRelPath(taskNo: string, filename: string): string {
    return path.posix.join('originals', safeSegment(taskNo), safeSegment(filename));
  }

  thumbnailRelPath(taskNo: string, filename: string): string {
    return path.posix.join('thumbs', safeSegment(taskNo), `${safeSegment(filename)}.thumb.png`);
  }

  convertedRelPath(taskNo: string, filename: string, format: string): string {
    return path.posix.join('converted', safeSegment(taskNo), `${safeSegment(filename)}.${safeSegment(format)}`);
  }

  async write(relPath: string, buffer: Buffer): Promise<string> {
    const target = this.abs(relPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);
    return target;
  }

  async read(relPath: string): Promise<Buffer> {
    return readFile(this.abs(relPath));
  }

  /** 内容哈希，用于去重与审计 */
  static sha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }
}
