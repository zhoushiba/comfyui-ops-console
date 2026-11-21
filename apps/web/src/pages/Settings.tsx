/** 设置：ComfyUI 连接参数、健康检查、系统状态与审计日志 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { canManage, useAuthStore } from '../store/auth';
import { toast } from '../store/toast';
import {
  ErrorState,
  PageHeader,
  SkeletonCard,
  Spinner,
  StatCard,
} from '../components/ui';
import type { PlatformSettings } from '../types';

const EMPTY: PlatformSettings = {
  comfyuiBaseUrl: 'http://127.0.0.1:8188',
  comfyuiRequestTimeoutMs: 10000,
  comfyuiPollIntervalMs: 800,
  comfyuiJobTimeoutMs: 60000,
  orchestratorConcurrency: 2,
  thumbnailSize: 256,
};

export default function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const editable = canManage(user);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PlatformSettings>(EMPTY);

  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
  const status = useQuery({ queryKey: ['system', 'status'], queryFn: api.system.status, refetchInterval: 20_000 });
  const audit = useQuery({ queryKey: ['system', 'audit'], queryFn: () => api.system.auditLogs(20) });

  useEffect(() => {
    if (settings.data) setForm(settings.data.settings);
  }, [settings.data]);

  const test = useMutation({
    mutationFn: api.settings.test,
    onSuccess: (result) => {
      if (result.reachable) {
        toast.success('ComfyUI 连接正常', `${result.version ?? '未知版本'} · ${result.latencyMs}ms`);
      } else {
        toast.error('ComfyUI 不可达', `${result.errorKind ?? 'ERROR'} · ${result.message ?? ''}`);
      }
      queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
    },
    onError: (error) => toast.error('测试失败', errorMessage(error)),
  });

  const save = useMutation({
    mutationFn: () => api.settings.update(form),
    onSuccess: (data) => {
      setForm(data.settings);
      toast.success('设置已保存', '新参数已即时生效');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['system', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['system', 'audit'] });
    },
    onError: (error) => toast.error('保存失败', errorMessage(error)),
  });

  const patch = <K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]): void => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  return (
    <>
      <PageHeader
        title="设置"
        description="ComfyUI 地址与轮询参数支持热更新，保存后立即用于下一个任务"
        actions={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => test.mutate()}
            disabled={test.isPending}
          >
            {test.isPending ? <Spinner label="测试中" /> : '测试连接'}
          </button>
        }
      />

      {settings.isLoading ? (
        <SkeletonCard rows={6} />
      ) : settings.isError || !settings.data ? (
        <ErrorState message={errorMessage(settings.error)} onRetry={() => settings.refetch()} />
      ) : (
        <div className="grid grid--3">
          <section className="card card--span2">
            <div className="card__head">
              <h2>ComfyUI 连接</h2>
              <span className={`badge badge--${status.data?.comfyui.reachable ? 'success' : 'danger'}`}>
                <span className="badge__dot" />
                {status.data?.comfyui.reachable ? '在线' : '离线'}
              </span>
            </div>

            <label className="field">
              <span className="field__label">服务地址</span>
              <input
                className="input"
                value={form.comfyuiBaseUrl}
                disabled={!editable}
                onChange={(event) => patch('comfyuiBaseUrl', event.target.value)}
                placeholder="http://127.0.0.1:8188"
              />
            </label>

            <div className="grid grid--2">
              <label className="field">
                <span className="field__label">请求超时（毫秒）</span>
                <input
                  className="input"
                  type="number"
                  min={1000}
                  max={120000}
                  step={500}
                  disabled={!editable}
                  value={form.comfyuiRequestTimeoutMs}
                  onChange={(event) => patch('comfyuiRequestTimeoutMs', Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span className="field__label">轮询间隔（毫秒）</span>
                <input
                  className="input"
                  type="number"
                  min={200}
                  max={10000}
                  step={100}
                  disabled={!editable}
                  value={form.comfyuiPollIntervalMs}
                  onChange={(event) => patch('comfyuiPollIntervalMs', Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span className="field__label">任务总超时（毫秒）</span>
                <input
                  className="input"
                  type="number"
                  min={5000}
                  max={3600000}
                  step={1000}
                  disabled={!editable}
                  value={form.comfyuiJobTimeoutMs}
                  onChange={(event) => patch('comfyuiJobTimeoutMs', Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span className="field__label">编排并发上限</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={8}
                  disabled={!editable}
                  value={form.orchestratorConcurrency}
                  onChange={(event) => patch('orchestratorConcurrency', Number(event.target.value))}
                />
              </label>
              <label className="field">
                <span className="field__label">缩略图边长（像素）</span>
                <input
                  className="input"
                  type="number"
                  min={64}
                  max={512}
                  step={32}
                  disabled={!editable}
                  value={form.thumbnailSize}
                  onChange={(event) => patch('thumbnailSize', Number(event.target.value))}
                />
              </label>
            </div>

            {editable ? (
              <div className="stack stack--row">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={save.isPending}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? <Spinner label="保存中" /> : '保存设置'}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => settings.data && setForm(settings.data.settings)}
                >
                  还原
                </button>
              </div>
            ) : (
              <p className="muted small">仅管理员可修改设置，你可以查看当前参数。</p>
            )}
          </section>

          <section className="card">
            <div className="card__head">
              <h2>运行环境</h2>
            </div>
            <dl className="kv">
              <div>
                <span className="muted">版本</span>
                <span className="mono">{settings.data.version}</span>
              </div>
              <div>
                <span className="muted">数据库</span>
                <span className="mono">{settings.data.dbClient}</span>
              </div>
              <div>
                <span className="muted">存储目录</span>
                <span className="mono ellipsis" title={settings.data.storageDir}>
                  {settings.data.storageDir}
                </span>
              </div>
              <div>
                <span className="muted">Node</span>
                <span className="mono">{status.data?.nodeVersion ?? '—'}</span>
              </div>
              <div>
                <span className="muted">运行时长</span>
                <span>{status.data ? `${Math.floor(status.data.uptimeSeconds / 60)} 分钟` : '—'}</span>
              </div>
            </dl>
            <div className="divider" />
            <div className="mini-stats">
              <div>
                <span className="muted">执行中</span>
                <strong>{status.data?.queue.running ?? 0}</strong>
              </div>
              <div>
                <span className="muted">排队</span>
                <strong>{status.data?.queue.queued ?? 0}</strong>
              </div>
              <div>
                <span className="muted">ComfyUI 延迟</span>
                <strong>{status.data?.comfyui.latencyMs ?? '—'}ms</strong>
              </div>
            </div>
          </section>
        </div>
      )}

      {test.data && !test.data.reachable ? (
        <section className="card">
          <div className="callout callout--danger">
            <p className="callout__title">连接测试失败 · {test.data.errorKind ?? 'ERROR'}</p>
            <p>{test.data.message ?? '请确认 ComfyUI（或 mock 服务）已启动，并检查服务地址。'}</p>
          </div>
        </section>
      ) : null}

      {status.data ? (
        <div className="grid grid--4">
          <StatCard label="数据库" value={status.data.db === 'ok' ? '正常' : '异常'} tone={status.data.db === 'ok' ? 'good' : 'bad'} />
          <StatCard label="ComfyUI" value={status.data.comfyui.reachable ? '可达' : '不可达'} hint={`${status.data.comfyui.latencyMs}ms`} tone={status.data.comfyui.reachable ? 'good' : 'warn'} />
          <StatCard label="本次启动完成" value={status.data.orchestrator.completedSinceBoot} hint={`失败 ${status.data.orchestrator.failedSinceBoot}`} />
          <StatCard label="本次启动失败" value={status.data.orchestrator.failedSinceBoot} tone={status.data.orchestrator.failedSinceBoot > 0 ? 'warn' : 'default'} />
        </div>
      ) : null}

      <section className="card card--flush">
        <div className="card__head card__head--pad">
          <h2>审计日志</h2>
          <span className="muted">最近 20 条</span>
        </div>
        {audit.isLoading ? (
          <SkeletonCard rows={5} />
        ) : audit.isError ? (
          <ErrorState message={errorMessage(audit.error)} onRetry={() => audit.refetch()} />
        ) : audit.data && audit.data.items.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作人</th>
                  <th>动作</th>
                  <th>对象</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.items.map((row, index) => {
                  const record = row as Record<string, unknown>;
                  return (
                    <tr key={String(record.id ?? index)}>
                      <td className="muted">{formatDateTime(String(record.created_at ?? ''))}</td>
                      <td>{String(record.actor_name ?? '系统')}</td>
                      <td className="mono">{String(record.action ?? '')}</td>
                      <td className="mono">
                        {String(record.target_type ?? '—')}
                        {record.target_id ? ` #${String(record.target_id)}` : ''}
                      </td>
                      <td className="ellipsis" style={{ maxWidth: 360 }} title={String(record.detail_json ?? '')}>
                        {String(record.detail_json ?? '—')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ padding: 16 }}>
            暂无审计日志
          </p>
        )}
      </section>
    </>
  );
}
