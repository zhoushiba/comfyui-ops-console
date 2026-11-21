/**
 * 图片服务：图库列表、原图/缩略图读取、格式转换（含批量）。
 * 转换生成的是"派生图"（source_image_id 指向原图），不改动原始文件。
 */
import { NotFoundError, UnprocessableError } from '../lib/errors.js';
import { nowIso } from '../db/knex.js';
import { extensionForFormat, mimeForFormat, sha256, type ImageFormat } from '../lib/image.js';
import type { ImageConverter } from './imageConverter.js';
import type { StorageService } from './storage.js';
import type { ImageFilters, ImageRepository, ImageRow } from '../repositories/imageRepo.js';
import type { TaskRepository } from '../repositories/taskRepo.js';

export interface ConvertResult {
  id: number;
  sourceImageId: number;
  format: ImageFormat;
  quality: number;
  byteSize: number;
  path: string;
}

export interface BatchConvertResult {
  converted: ConvertResult[];
  failed: Array<{ id: number; message: string }>;
}

export class ImageService {
  private readonly images: ImageRepository;
  private readonly tasks: TaskRepository;
  private readonly storage: StorageService;
  private readonly converter: ImageConverter;

  constructor(
    images: ImageRepository,
    tasks: TaskRepository,
    storage: StorageService,
    converter: ImageConverter,
  ) {
    this.images = images;
    this.tasks = tasks;
    this.storage = storage;
    this.converter = converter;
  }

  async list(
    filters: ImageFilters,
    page: number,
    pageSize: number,
  ): Promise<{ items: unknown[]; total: number; page: number; pageSize: number }> {
    const { items, total } = await this.images.list(filters, page, pageSize);
    return { items, total, page, pageSize };
  }

  async getOrThrow(id: number): Promise<ImageRow> {
    const image = await this.images.findById(id);
    if (!image) throw new NotFoundError(`图片 #${id} 不存在`);
    return image;
  }

  /** 读取原图字节（缩略图缺失时由调用方回退到原图） */
  async readOriginal(id: number): Promise<{ image: ImageRow; buffer: Buffer }> {
    const image = await this.getOrThrow(id);
    return { image, buffer: await this.storage.read(image.storage_path) };
  }

  async readThumbnail(id: number): Promise<{ image: ImageRow; buffer: Buffer }> {
    const image = await this.getOrThrow(id);
    if (!image.thumbnail_path) {
      return { image, buffer: await this.storage.read(image.storage_path) };
    }
    try {
      return { image, buffer: await this.storage.read(image.thumbnail_path) };
    } catch {
      // 缩略图文件丢失不致命，回退原图
      return { image, buffer: await this.storage.read(image.storage_path) };
    }
  }

  /** 单张转换，返回派生图记录 */
  async convert(id: number, format: ImageFormat, quality = 82): Promise<ConvertResult> {
    const image = await this.getOrThrow(id);
    const source = await this.storage.read(image.storage_path);
    const converted = await this.converter.convert(source, format, quality);
    if (converted.buffer.length === 0) {
      throw new UnprocessableError('转换结果为空字节', 'CONVERT_EMPTY');
    }

    const task = await this.tasks.findById(image.task_id);
    const taskNoValue = task?.task_no ?? `task${image.task_id}`;
    const baseName = image.filename.replace(/\.[^.]+$/, '');
    const filename = `${baseName}-${format}-q${converted.quality}.${extensionForFormat(format)}`;
    const relPath = this.storage.convertedRelPath(taskNoValue, filename, format);
    await this.storage.write(relPath, converted.buffer);

    const createdId = await this.images.create({
      task_id: image.task_id,
      user_id: image.user_id,
      agent_id: image.agent_id,
      filename,
      storage_path: relPath,
      mime_type: mimeForFormat(format),
      format,
      width: converted.width,
      height: converted.height,
      byte_size: converted.buffer.length,
      sha256: sha256(converted.buffer),
      thumbnail_path: null,
      converted_path: null,
      source_image_id: image.id,
      created_at: nowIso(),
    });

    return {
      id: createdId,
      sourceImageId: image.id,
      format,
      quality: converted.quality,
      byteSize: converted.buffer.length,
      path: relPath,
    };
  }

  /** 批量转换：单张失败不影响其他张 */
  async batchConvert(ids: number[], format: ImageFormat, quality = 82): Promise<BatchConvertResult> {
    const converted: ConvertResult[] = [];
    const failed: Array<{ id: number; message: string }> = [];
    for (const id of ids) {
      try {
        converted.push(await this.convert(id, format, quality));
      } catch (error) {
        failed.push({ id, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { converted, failed };
  }

  /** 桌面端批量下载用：一次返回多张原图的路径与大小 */
  async bundle(ids: number[]): Promise<Array<{ id: number; filename: string; path: string; byteSize: number }>> {
    const result: Array<{ id: number; filename: string; path: string; byteSize: number }> = [];
    for (const id of ids) {
      const image = await this.getOrThrow(id);
      result.push({
        id: image.id,
        filename: image.filename,
        path: this.storage.abs(image.storage_path),
        byteSize: image.byte_size,
      });
    }
    return result;
  }
}
