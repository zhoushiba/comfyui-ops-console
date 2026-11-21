/** 图片路由：图库、原图/缩略图/派生图读取、单张与批量格式转换、桌面批量下载 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseId, parseIds, parsePagination, parseWith, ok } from '../http/respond.js';
import { toImageDto } from '../http/dto.js';
import type { AppServices } from '../app.js';

const batchConvertSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(50),
  format: z.enum(['png', 'jpeg', 'webp']),
  quality: z.coerce.number().int().min(1).max(100).optional(),
});

const convertSchema = z.object({
  format: z.enum(['png', 'jpeg', 'webp']),
  quality: z.coerce.number().int().min(1).max(100).optional(),
});

function attachmentName(filename: string): string {
  return filename.replace(/["\\\r\n]/g, '_');
}

export async function imageRoutes(app: FastifyInstance, services: AppServices): Promise<void> {
  app.get('/images', async (request) => {
    const { page, pageSize } = parsePagination(request.query);
    const query = (request.query ?? {}) as Record<string, unknown>;
    const filters = {
      taskId: query.taskId ? Number(query.taskId) : undefined,
      format: typeof query.format === 'string' ? query.format : undefined,
    };
    const result = await services.imageService.list(filters, page, pageSize);
    return ok({
      ...result,
      items: (result.items as Parameters<typeof toImageDto>[0][]).map(toImageDto),
    });
  });

  app.post('/images/batch-convert', async (request) => {
    const body = parseWith(batchConvertSchema, request.body, '批量转换参数');
    const result = await services.imageService.batchConvert(body.ids, body.format, body.quality ?? 82);
    return ok(result);
  });

  app.post('/images/bundle', async (request) => {
    const body = parseWith(
      z.object({ ids: z.array(z.coerce.number().int().positive()).min(1).max(100) }),
      request.body,
      '批量下载参数',
    );
    const files = await services.imageService.bundle(body.ids);
    return ok({ files, count: files.length });
  });

  app.get('/images/:id', async (request) => {
    const id = parseId((request.params as { id?: string }).id, '图片 ID');
    const image = await services.imageService.getOrThrow(id);
    return ok(toImageDto(image));
  });

  app.get('/images/:id/file', async (request, reply) => {
    const id = parseId((request.params as { id?: string }).id, '图片 ID');
    const { image, buffer } = await services.imageService.readOriginal(id);
    reply.header('Content-Type', image.mime_type);
    reply.header('Content-Length', buffer.length);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(buffer);
  });

  app.get('/images/:id/thumbnail', async (request, reply) => {
    const id = parseId((request.params as { id?: string }).id, '图片 ID');
    const { buffer } = await services.imageService.readThumbnail(id);
    reply.header('Content-Type', 'image/png');
    reply.header('Content-Length', buffer.length);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(buffer);
  });

  app.get('/images/:id/download', async (request, reply) => {
    const id = parseId((request.params as { id?: string }).id, '图片 ID');
    const { image, buffer } = await services.imageService.readOriginal(id);
    reply.header('Content-Type', image.mime_type);
    reply.header('Content-Length', buffer.length);
    reply.header('Content-Disposition', `attachment; filename="${attachmentName(image.filename)}"`);
    return reply.send(buffer);
  });

  app.post('/images/:id/convert', async (request, reply) => {
    const id = parseId((request.params as { id?: string }).id, '图片 ID');
    const body = parseWith(convertSchema, request.body, '转换参数');
    const result = await services.imageService.convert(id, body.format, body.quality ?? 82);
    reply.code(201);
    return ok(result);
  });
}
