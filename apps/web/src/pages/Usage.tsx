/** 用量统计：筛选、聚合指标、趋势、明细与流式 CSV 导出 */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, errorMessage } from '../lib/api';
import {
  formatDuration,
  formatNumber,
  formatPercent,
  formatSeconds,
  monthStartKey,
  todayKey,
} from '../lib/format';
import { statusLabel } from '../lib/status';
import { toast } from '../store/toast';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SkeletonCard,
  SkeletonTable,
  StatCard,
  StatusBadge,
} from '../components/ui';

interface Filters {
  from: string;
  to: string;
  agentId: number | undefined;
  status: string;
}

const EXPORT_STATUSES = ['completed', 'failed', 'timeout', 'unreachable'];

export default function UsagePage() {
  const [draft, setDraft] = useState<Filters>({
    from: monthStartKey(),
    to: todayKey(),
    agentId: undefined,
    status: '',
  });
  const [filters, setFilters] = useState<Filters>(draft);
  const [page, setPage] = useState(1);

  const agents = useQuery({ queryKey: ['agents'], queryFn: api.agents.list });

  const stats = useQuery({
    queryKey: ['usage', 'stats', filters],
    queryFn: () =>
      api.usage.stats({
        from: filters.from,
        to: filters.to,
        agentId: filters.agentId,
        status: filters.status || undefined,
      }),
  });

  const records = useQuery({
    queryKey: ['usage', 'records', filters, page],
    queryFn: () =>
      api.usage.records({
        page,
        pageSize: 20,
        from: filters.from,
        to: filters.to,
        agentId: filters.agentId,
        status: filters.status || undefined,
      }),
  });

  const [exported, setExported] = useState<{ received: number; name: string } | null>(null);

  const exportCsv = useMutation({
    mutationFn: () =>
      api.usage.exportCsv(
        {
          from: filters.from,
          to: filters.to,
          agentId: filters.agentId,
          status: filters.status || undefined,
        },
        (received) => setExported({ received, name: '' }),
      ),
    onSuccess: (name) => {
      setExported(null);
      toast.success('导出完成', name);
    },
    onError: (error) => {
      setExported(null);
      toast.error('导出失败', errorMessage(error));
    },
  });

  const apply = (): void => {
    setFilters(draft);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="用量统计"
        description="按日期、代理商、状态聚合；导出为流式 CSV（UTF-8 BOM，可直接用 Excel 打开）"
        actions={
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => exportCsv.mutate()}
            disabled={exportCsv.isPending}
          >
            {exportCsv.isPending
              ? `导出中 ${(exported?.received ?? 0) > 0 ? `· ${(exported!.received / 1024).toFixed(0)} KB` : ''}`
              : '导出用量 CSV'}
          </button>
        }
      />

      <section className="card card--tight">
        <form
          className="filters"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <label className="field field--inline">
            <span className="field__label">开始</span>
            <input
              className="input input--sm"
              type="date"
              value={draft.from}
              onChange={(event) => setDraft((previous) => ({ ...previous, from: event.target.value }))}
            />
          </label>
          <label className="field field--inline">
            <span className="field__label">结束</span>
            <input
              className="input input--sm"
              type="date"
              value={draft.to}
              onChange={(event) => setDraft((previous) => ({ ...previous, to: event.target.value }))}
            />
          </label>
          <label className="field field--inline">
            <span className="field__label">代理商</span>
            <select
              className="input input--sm"
              value={draft.agentId ?? ''}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  agentId: event.target.value ? Number(event.target.value) : undefined,
                }))
              }
            >
              <option value="">全部</option>
              {agents.data?.items.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--inline">
            <span className="field__label">状态</span>
            <select
              className="input input--sm"
              value={draft.status}
              onChange={(event) => setDraft((previous) => ({ ...previous, status: event.target.value }))}
            >
              <option value="">全部</option>
              {EXPORT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn--primary btn--sm" type="submit">
            应用筛选
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              const next: Filters = { from: monthStartKey(), to: todayKey(), agentId: undefined, status: '' };
              setDraft(next);
              setFilters(next);
              setPage(1);
            }}
          >
            重置
          </button>
        </form>
      </section>

      {stats.isLoading ? (
        <>
          <div className="grid grid--4">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonCard key={index} rows={2} />
            ))}
          </div>
          <SkeletonTable rows={6} />
        </>
      ) : stats.isError || !stats.data ? (
        <ErrorState message={errorMessage(stats.error)} onRetry={() => stats.refetch()} />
      ) : (
        <>
          <div className="grid grid--4">
            <StatCard label="任务数" value={formatNumber(stats.data.totals.tasks)} hint={`成功 ${formatNumber(stats.data.totals.succeeded)} · 失败 ${formatNumber(stats.data.totals.failed)}`} />
            <StatCard label="图片数" value={formatNumber(stats.data.totals.images)} hint={`计费 ${formatNumber(stats.data.totals.billableImages)} 张`} />
            <StatCard
              label="成功率"
              value={formatPercent(stats.data.successRate)}
              hint={`失败率 ${formatPercent(stats.data.failureRate)}`}
              tone={stats.data.successRate >= 0.9 ? 'good' : stats.data.successRate >= 0.7 ? 'warn' : 'bad'}
            />
            <StatCard
              label="P50 / P95"
              value={`${formatDuration(stats.data.p50DurationMs)} / ${formatDuration(stats.data.p95DurationMs)}`}
              hint={`平均 GPU ${formatSeconds(stats.data.avgGpuSeconds)}`}
            />
          </div>

          <div className="grid grid--2">
            <section className="card">
              <div className="card__head">
                <h2>用量趋势</h2>
                <span className="muted">{stats.data.trend.length} 天有记录</span>
              </div>
              {stats.data.trend.length === 0 ? (
                <EmptyState title="该区间没有用量" description="调整日期后再试" />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={stats.data.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="usageTasks" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#5eead4" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#5eead4" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(148,163,184,.12)" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} stroke="#7f8ea8" fontSize={11} tickLine={false} />
                    <YAxis stroke="#7f8ea8" fontSize={11} allowDecimals={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#0f1725', border: '1px solid #22304a', borderRadius: 10, color: '#e6edf7' }}
                      labelFormatter={(value) => `日期 ${value}`}
                    />
                    <Area type="monotone" dataKey="images" name="图片" stroke="#5eead4" strokeWidth={2} fill="url(#usageTasks)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </section>

            <section className="card">
              <div className="card__head">
                <h2>代理商排行</h2>
                <span className="muted">按图片数</span>
              </div>
              {stats.data.byAgent.length === 0 ? (
                <EmptyState title="没有代理商用量" />
              ) : (
                <ul className="rank">
                  {stats.data.byAgent.map((agent, index) => (
                    <li key={`${agent.agentId ?? 'self'}-${agent.agentName}`} className="rank__row">
                      <span className="rank__index">{index + 1}</span>
                      <span className="rank__name">{agent.agentName}</span>
                      <span className="rank__meta">
                        {formatNumber(agent.tasks)} 任务 · {formatNumber(agent.images)} 图
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="divider" />
              <p className="muted small">导出会记录审计日志（export.usage），文件名带生成时间戳。</p>
            </section>
          </div>

          <section className="card card--flush">
            <div className="card__head card__head--pad">
              <h2>用量明细</h2>
              <span className="muted">共 {records.data?.total ?? 0} 条</span>
            </div>
            {records.isLoading ? (
              <SkeletonTable rows={6} />
            ) : records.isError ? (
              <ErrorState message={errorMessage(records.error)} onRetry={() => records.refetch()} />
            ) : (records.data?.items.length ?? 0) === 0 ? (
              <EmptyState title="没有匹配的用量记录" />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>任务号</th>
                        <th>用户</th>
                        <th>代理商</th>
                        <th>模型</th>
                        <th>状态</th>
                        <th className="num">图片</th>
                        <th className="num">耗时</th>
                        <th className="num">GPU</th>
                        <th>计费</th>
                        <th>日期</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.data?.items.map((row) => (
                        <tr key={row.id}>
                          <td className="mono">{row.task_no ?? `#${row.task_id}`}</td>
                          <td>{row.user_name ?? `#${row.user_id}`}</td>
                          <td>{row.agent_name ?? '自营'}</td>
                          <td className="mono">{row.model_name}</td>
                          <td>
                            <StatusBadge status={row.status} />
                          </td>
                          <td className="num">{row.image_count}</td>
                          <td className="num">{formatDuration(row.duration_ms)}</td>
                          <td className="num">{row.gpu_seconds}s</td>
                          <td>{row.billable ? '是' : '否'}</td>
                          <td className="muted">{row.occurred_at}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {records.data ? (
                  <Pagination
                    page={records.data.page}
                    pageSize={records.data.pageSize}
                    total={records.data.total}
                    onChange={setPage}
                  />
                ) : null}
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
