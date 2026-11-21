/** 图库：网格浏览、多选批量转格式、单图下载与预览 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fileUrl } from '../lib/api';
import { formatBytes, formatDateTime } from '../lib/format';
import { toast } from '../store/toast';
import { EmptyState, ErrorState, Modal, PageHeader, Pagination, SkeletonCard, Spinner } from '../components/ui';
import type { TaskImage } from '../types';

const FORMATS = ['png', 'jpeg', 'webp'] as const;
type ImageFormat = (typeof FORMATS)[number];

export default function GalleryPage() {
  const queryClient = useQueryClient();
  const [format, setFormat] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [targetFormat, setTargetFormat] = useState<ImageFormat>('webp');
  const [quality, setQuality] = useState(82);
  const [preview, setPreview] = useState<TaskImage | null>(null);

  const images = useQuery({
    queryKey: ['images', { format, page }],
    queryFn: () => api.images.list({ page, pageSize: 24, format: format || undefined }),
  });

  const batch = useMutation({
    mutationFn: () => api.images.batchConvert([...selected], targetFormat, quality),
    onSuccess: (result) => {
      if (result.converted.length > 0) {
        toast.success(`已转换 ${result.converted.length} 张`, `目标格式 ${targetFormat.toUpperCase()}`);
      }
      if (result.failed.length > 0) {
        toast.error(`${result.failed.length} 张转换失败`, result.failed.map((item) => `#${item.id}: ${item.message}`).join('；'));
      }
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['images'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (error) => toast.error('批量转换失败', errorMessage(error)),
  });

  const single = useMutation({
    mutationFn: ({ id }: { id: number }) => api.images.convert(id, targetFormat, quality),
    onSuccess: (image) => {
      toast.success('转换完成', image.filename);
      setPreview(image);
      queryClient.invalidateQueries({ queryKey: ['images'] });
    },
    onError: (error) => toast.error('转换失败', errorMessage(error)),
  });

  const items = images.data?.items ?? [];
  const pageIds = useMemo(() => items.map((image) => image.id), [items]);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;

  const toggle = (id: number): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (images.isLoading) {
    return (
      <>
        <PageHeader title="图库" />
        <div className="grid grid--4">
          {Array.from({ length: 8 }).map((_, index) => (
            <SkeletonCard key={index} rows={2} />
          ))}
        </div>
      </>
    );
  }

  if (images.isError) {
    return (
      <>
        <PageHeader title="图库" />
        <ErrorState message={errorMessage(images.error)} onRetry={() => images.refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="图库"
        description="ComfyUI 产出会下载到 storage/originals，并自动生成缩略图与 WebP 预览"
        actions={
          <span className="muted">共 {images.data?.total ?? 0} 张</span>
        }
      />

      <section className="card card--tight">
        <div className="filters">
          <label className="field field--inline">
            <span className="field__label">格式</span>
            <select
              className="input input--sm"
              value={format}
              onChange={(event) => {
                setFormat(event.target.value);
                setPage(1);
                setSelected(new Set());
              }}
            >
              <option value="">全部</option>
              {FORMATS.map((item) => (
                <option key={item} value={item}>
                  {item.toUpperCase()}
                </option>
              ))}
            </select>
          </label>

          <span className="filters__spacer" />

          <label className="field field--inline">
            <span className="field__label">目标格式</span>
            <select
              className="input input--sm"
              value={targetFormat}
              onChange={(event) => setTargetFormat(event.target.value as ImageFormat)}
            >
              {FORMATS.map((item) => (
                <option key={item} value={item}>
                  {item.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--inline">
            <span className="field__label">质量 {quality}</span>
            <input
              type="range"
              min={40}
              max={100}
              value={quality}
              onChange={(event) => setQuality(Number(event.target.value))}
              disabled={targetFormat === 'png'}
            />
          </label>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={selected.size === 0 || batch.isPending || targetFormat === 'png'}
            onClick={() => batch.mutate()}
          >
            {batch.isPending ? <Spinner label="转换中" /> : `批量转换 (${selected.size})`}
          </button>
        </div>
        <p className="muted small">
          选中本页 {selectedOnPage} 张 · 已选 {selected.size} 张 · 转换会生成派生图片，原图保持不变（PNG 不支持质量参数）
        </p>
      </section>

      {items.length === 0 ? (
        <div className="card">
          <EmptyState
            title="图库还是空的"
            description="提交一个出图任务，完成后图片会自动出现在这里"
          />
        </div>
      ) : (
        <section className="card card--flush">
          <div className="gallery-toolbar">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => {
                  setSelected((previous) => {
                    const next = new Set(previous);
                    if (allSelected) pageIds.forEach((id) => next.delete(id));
                    else pageIds.forEach((id) => next.add(id));
                    return next;
                  });
                }}
              />
              全选本页
            </label>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}
            >
              清空选择
            </button>
          </div>

          <div className="gallery">
            {items.map((image) => (
              <figure key={image.id} className={`gallery__item${selected.has(image.id) ? ' is-selected' : ''}`}>
                <label className="gallery__check">
                  <input type="checkbox" checked={selected.has(image.id)} onChange={() => toggle(image.id)} />
                </label>
                <button type="button" className="gallery__thumb" onClick={() => setPreview(image)}>
                  <img src={fileUrl(image.thumbnailUrl)} alt={image.filename} loading="lazy" />
                </button>
                <figcaption>
                  <span className="mono ellipsis" title={image.filename}>
                    {image.filename}
                  </span>
                  <span className="muted">
                    {image.format.toUpperCase()} · {image.width}×{image.height} · {formatBytes(image.byteSize)}
                    {image.sourceImageId ? ' · 派生' : ''}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>

          {images.data ? (
            <Pagination page={images.data.page} pageSize={images.data.pageSize} total={images.data.total} onChange={setPage} />
          ) : null}
        </section>
      )}

      <Modal
        open={preview !== null}
        title={preview?.filename ?? '图片预览'}
        onClose={() => setPreview(null)}
        wide
        footer={
          preview ? (
            <>
              <span className="muted">
                {preview.width}×{preview.height} · {formatBytes(preview.byteSize)} · {formatDateTime(preview.createdAt)}
              </span>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() =>
                  api.images
                    .download(preview.id, preview.filename)
                    .catch((error) => toast.error('下载失败', errorMessage(error)))
                }
              >
                下载
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={single.isPending}
                onClick={() => single.mutate({ id: preview.id })}
              >
                {single.isPending ? '转换中…' : `转为 ${targetFormat.toUpperCase()}`}
              </button>
            </>
          ) : null
        }
      >
        {preview ? <img className="preview-img" src={fileUrl(preview.url)} alt={preview.filename} /> : null}
      </Modal>
    </>
  );
}
