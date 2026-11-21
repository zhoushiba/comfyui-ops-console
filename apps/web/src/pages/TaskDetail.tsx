/** 任务详情：实时进度、失败原因、参数、图片预览与重试 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage, fileUrl } from '../lib/api';
import { formatBytes, formatDateTime, formatDuration, formatSeconds } from '../lib/format';
import { isTerminal, statusLabel } from '../lib/status';
import { toast } from '../store/toast';
import {
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  ProgressBar,
  SkeletonCard,
  StatusBadge,
} from '../components/ui';
import type { TaskImage } from '../types';

const STEPS: Array<{ key: string; label: string }> = [
  { key: 'queued', label: '排队' },
  { key: 'submitted', label: '提交' },
  { key: 'running', label: '执行' },
  { key: 'polling', label: '轮询' },
  { key: 'downloading', label: '下载' },
  { key: 'completed', label: '完成' },
];

const ORDER = ['queued', 'submitted', 'running', 'polling', 'downloading', 'completed'];

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const taskId = Number(id);
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<TaskImage | null>(null);

  const detail = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => api.tasks.detail(taskId),
    enabled: Number.isFinite(taskId) && taskId > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.task.status;
      return status && !isTerminal(status) ? 1500 : false;
    },
  });

  const retry = useMutation({
    mutationFn: () => api.tasks.retry(taskId),
    onSuccess: () => {
      toast.success('已重新入队', '任务会从排队状态重新执行');
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => toast.error('重试失败', errorMessage(error)),
  });

  if (detail.isLoading) {
    return (
      <>
        <PageHeader title="任务详情" />
        <SkeletonCard rows={6} />
        <SkeletonCard rows={6} />
      </>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <>
        <PageHeader title="任务详情" />
        <ErrorState message={errorMessage(detail.error)} onRetry={() => detail.refetch()} />
      </>
    );
  }

  const { task, images, attempts, templateName } = detail.data;
  const currentIndex = ORDER.indexOf(task.status);
  const failed = ['failed', 'timeout', 'unreachable'].includes(task.status);
  const params = task.params as Record<string, number | string | undefined>;

  return (
    <>
      <PageHeader
        title={`任务 ${task.taskNo}`}
        description={`创建于 ${formatDateTime(task.createdAt)} · 模板 ${templateName ?? '—'}`}
        actions={
          <>
            <Link className="btn btn--ghost" to="/tasks">
              返回列表
            </Link>
            {failed ? (
              <button type="button" className="btn btn--primary" onClick={() => retry.mutate()} disabled={retry.isPending}>
                {retry.isPending ? '重新入队中…' : '重试任务'}
              </button>
            ) : null}
          </>
        }
      />

      <div className="grid grid--3">
        <section className="card card--span2">
          <div className="card__head">
            <h2>执行进度</h2>
            <StatusBadge status={task.status} pulse={!isTerminal(task.status)} />
          </div>

          <ol className="steps">
            {STEPS.map((step, index) => {
              const state =
                task.status === 'completed' || index < currentIndex
                  ? 'done'
                  : index === currentIndex
                    ? failed
                      ? 'failed'
                      : 'active'
                    : 'todo';
              return (
                <li key={step.key} className={`steps__item steps__item--${state}`}>
                  <span className="steps__dot" />
                  <span className="steps__label">{step.label}</span>
                </li>
              );
            })}
          </ol>

          <ProgressBar
            value={task.status === 'completed' ? 100 : task.progress}
            tone={task.status === 'completed' ? 'success' : failed ? 'danger' : 'info'}
            label={`${task.status === 'completed' ? 100 : task.progress}%`}
          />

          <div className="kv">
            <div>
              <span className="muted">ComfyUI Prompt ID</span>
              <span className="mono">{task.comfyuiPromptId ?? '—'}</span>
            </div>
            <div>
              <span className="muted">尝试次数</span>
              <span>{task.attempts}</span>
            </div>
            <div>
              <span className="muted">耗时</span>
              <span>{formatDuration(task.durationMs)}</span>
            </div>
            <div>
              <span className="muted">GPU 估算</span>
              <span>{formatSeconds(task.gpuSeconds)}</span>
            </div>
            <div>
              <span className="muted">提交时间</span>
              <span>{formatDateTime(task.submittedAt)}</span>
            </div>
            <div>
              <span className="muted">完成时间</span>
              <span>{formatDateTime(task.finishedAt)}</span>
            </div>
          </div>

          {failed ? (
            <div className="callout callout--danger">
              <p className="callout__title">
                {statusLabel(task.status)} · {task.errorCode ?? 'UNKNOWN'}
              </p>
              <p>{task.errorMessage ?? '未记录错误信息'}</p>
              {task.errorDetail ? (
                <details>
                  <summary>查看原始错误体</summary>
                  <pre className="code">{task.errorDetail}</pre>
                </details>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="card">
          <div className="card__head">
            <h2>出图参数</h2>
          </div>
          <dl className="params">
            <div>
              <dt>正向提示词</dt>
              <dd className="params__text">{task.prompt}</dd>
            </div>
            {task.negativePrompt ? (
              <div>
                <dt>负向提示词</dt>
                <dd className="params__text">{task.negativePrompt}</dd>
              </div>
            ) : null}
            <div>
              <dt>Seed</dt>
              <dd className="mono">{params.seed ?? '—'}</dd>
            </div>
            <div>
              <dt>Steps / CFG</dt>
              <dd className="mono">
                {params.steps ?? '—'} / {params.cfg ?? '—'}
              </dd>
            </div>
            <div>
              <dt>尺寸 / 批次</dt>
              <dd className="mono">
                {params.width ?? '—'}×{params.height ?? '—'} · batch {params.batchSize ?? 1}
              </dd>
            </div>
            <div>
              <dt>客户端幂等键</dt>
              <dd className="mono ellipsis">{task.clientRequestId ?? '—'}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="card">
        <div className="card__head">
          <h2>产出图片</h2>
          <span className="muted">{images.length} 张</span>
        </div>
        {images.length === 0 ? (
          <EmptyState title="还没有图片" description="任务完成后会在这里展示缩略图" />
        ) : (
          <div className="gallery">
            {images.map((image) => (
              <figure key={image.id} className="gallery__item">
                <button type="button" className="gallery__thumb" onClick={() => setPreview(image)}>
                  <img src={fileUrl(image.thumbnailUrl)} alt={image.filename} loading="lazy" />
                </button>
                <figcaption>
                  <span className="mono ellipsis">{image.filename}</span>
                  <span className="muted">
                    {image.format.toUpperCase()} · {image.width}×{image.height} · {formatBytes(image.byteSize)}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      <section className="card card--flush">
        <div className="card__head card__head--pad">
          <h2>尝试记录</h2>
          <span className="muted">指数退避会记录在这里</span>
        </div>
        {attempts.length === 0 ? (
          <EmptyState title="暂无尝试记录" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>阶段</th>
                  <th>结果</th>
                  <th>HTTP</th>
                  <th>退避</th>
                  <th>错误</th>
                  <th>开始</th>
                  <th>结束</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((attempt) => (
                  <tr key={attempt.id}>
                    <td>{attempt.attempt_no}</td>
                    <td>{attempt.stage ?? '—'}</td>
                    <td>{attempt.status}</td>
                    <td className="mono">{attempt.http_status ?? '—'}</td>
                    <td>{attempt.backoff_ms ? `${attempt.backoff_ms}ms` : '—'}</td>
                    <td className="ellipsis" style={{ maxWidth: 260 }} title={attempt.error_message ?? ''}>
                      {attempt.error_message ?? '—'}
                    </td>
                    <td className="muted">{formatDateTime(attempt.started_at)}</td>
                    <td className="muted">{formatDateTime(attempt.finished_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        open={preview !== null}
        title={preview?.filename ?? '图片预览'}
        onClose={() => setPreview(null)}
        wide
        footer={
          preview ? (
            <>
              <button type="button" className="btn btn--ghost" onClick={() => setPreview(null)}>
                关闭
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => api.images.download(preview.id, preview.filename).catch((error) => toast.error('下载失败', errorMessage(error)))}
              >
                下载原图
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
