/** 总览：今日/本月指标、趋势、状态分布、耗时、最近任务与代理商排行 */
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
import { formatDuration, formatNumber, formatPercent, formatSeconds } from '../lib/format';
import { STATUS_LABELS } from '../lib/status';
import { EmptyState, ErrorState, PageHeader, SkeletonCard, StatCard, StatusBadge } from '../components/ui';

const CHART_COLORS = {
  tasks: '#5eead4',
  images: '#a78bfa',
  grid: 'rgba(148, 163, 184, 0.12)',
  axis: '#7f8ea8',
};

export default function OverviewPage() {
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: api.overview,
    refetchInterval: 20_000,
  });

  if (overview.isLoading) {
    return (
      <>
        <PageHeader title="总览" description="今日运营数据与执行队列" />
        <div className="grid grid--4">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard key={index} rows={2} />
          ))}
        </div>
        <SkeletonCard rows={8} />
      </>
    );
  }

  if (overview.isError || !overview.data) {
    return (
      <>
        <PageHeader title="总览" />
        <ErrorState message={errorMessage(overview.error)} onRetry={() => overview.refetch()} />
      </>
    );
  }

  const data = overview.data;
  const completed = data.statusCounts.completed ?? 0;
  const totalTasks = Object.values(data.statusCounts).reduce((sum, value) => sum + value, 0);
  const active = (data.statusCounts.running ?? 0) + (data.statusCounts.polling ?? 0) + (data.statusCounts.queued ?? 0);

  return (
    <>
      <PageHeader
        title="总览"
        description={`数据生成于 ${new Date(data.generatedAt).toLocaleString('zh-CN')} · 每 20 秒自动刷新`}
        actions={
          <Link className="btn btn--primary" to="/create">
            新建出图任务
          </Link>
        }
      />

      <div className="grid grid--4">
        <StatCard label="今日任务" value={formatNumber(data.today.tasks)} hint={`本月 ${formatNumber(data.month.tasks)}`} />
        <StatCard label="今日图片" value={formatNumber(data.today.images)} hint={`图库累计 ${formatNumber(data.imageTotal)}`} />
        <StatCard
          label="本月成功率"
          value={formatPercent(data.month.successRate)}
          hint={`完成 ${formatNumber(completed)} / ${formatNumber(totalTasks)}`}
          tone={data.month.successRate >= 0.9 ? 'good' : data.month.successRate >= 0.7 ? 'warn' : 'bad'}
        />
        <StatCard
          label="队列"
          value={`${data.queue.running} 执行 / ${data.queue.queued} 等待`}
          hint={`并发上限 ${data.queue.concurrency} · 进行中 ${active}`}
        />
      </div>

      <div className="grid grid--2">
        <section className="card">
          <div className="card__head">
            <h2>近 14 天趋势</h2>
            <span className="muted">任务 / 图片</span>
          </div>
          {data.trend.length === 0 ? (
            <EmptyState title="还没有趋势数据" description="提交第一个出图任务后即可看到曲线" />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={data.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillTasks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.tasks} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={CHART_COLORS.tasks} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="fillImages" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.images} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={CHART_COLORS.images} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
                <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} stroke={CHART_COLORS.axis} fontSize={11} tickLine={false} />
                <YAxis stroke={CHART_COLORS.axis} fontSize={11} allowDecimals={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#0f1725', border: '1px solid #22304a', borderRadius: 10, color: '#e6edf7' }}
                  labelFormatter={(value) => `日期 ${value}`}
                />
                <Area type="monotone" dataKey="tasks" name="任务" stroke={CHART_COLORS.tasks} strokeWidth={2} fill="url(#fillTasks)" />
                <Area type="monotone" dataKey="images" name="图片" stroke={CHART_COLORS.images} strokeWidth={2} fill="url(#fillImages)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className="card">
          <div className="card__head">
            <h2>状态分布</h2>
            <span className="muted">累计 {formatNumber(totalTasks)} 个任务</span>
          </div>
          <div className="status-bars">
            {(Object.keys(STATUS_LABELS) as Array<keyof typeof STATUS_LABELS>)
              .filter((status) => (data.statusCounts[status] ?? 0) > 0)
              .map((status) => {
                const count = data.statusCounts[status] ?? 0;
                const percent = totalTasks > 0 ? (count / totalTasks) * 100 : 0;
                return (
                  <div key={status} className="status-bars__row">
                    <span className="status-bars__name">{STATUS_LABELS[status]}</span>
                    <div className="status-bars__track">
                      <div className={`status-bars__fill status-bars__fill--${status}`} style={{ width: `${Math.max(percent, 2)}%` }} />
                    </div>
                    <span className="status-bars__value">{count}</span>
                  </div>
                );
              })}
            {totalTasks === 0 ? <EmptyState title="暂无任务" description="从「出图」页提交第一个任务" /> : null}
          </div>
          <div className="divider" />
          <div className="mini-stats">
            <div>
              <span className="muted">P50 耗时</span>
              <strong>{formatDuration(data.duration.p50)}</strong>
            </div>
            <div>
              <span className="muted">P95 耗时</span>
              <strong>{formatDuration(data.duration.p95)}</strong>
            </div>
            <div>
              <span className="muted">今日 GPU 估算</span>
              <strong>{formatSeconds(data.today.gpuSeconds)}</strong>
            </div>
          </div>
        </section>
      </div>

      <div className="grid grid--2">
        <section className="card card--flush">
          <div className="card__head card__head--pad">
            <h2>最近任务</h2>
            <Link to="/tasks" className="link">
              查看全部
            </Link>
          </div>
          {data.recentTasks.length === 0 ? (
            <EmptyState title="还没有任务" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>任务号</th>
                    <th>提示词</th>
                    <th>状态</th>
                    <th>图片</th>
                    <th>耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentTasks.map((task) => (
                    <tr key={task.id}>
                      <td>
                        <Link className="mono link" to={`/tasks/${task.id}`}>
                          {task.taskNo}
                        </Link>
                      </td>
                      <td className="cell-prompt" title={task.prompt}>
                        <span className="ellipsis">{task.promptPreview}</span>
                      </td>
                      <td>
                        <StatusBadge status={task.status} />
                      </td>
                      <td>{task.imageCount}</td>
                      <td>{formatDuration(task.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card__head">
            <h2>代理商用量</h2>
            <span className="muted">本月图片数</span>
          </div>
          {data.agents.length === 0 ? (
            <EmptyState title="本月暂无代理商用量" />
          ) : (
            <ul className="rank">
              {data.agents.slice(0, 6).map((agent, index) => (
                <li key={`${agent.agentId ?? 'none'}-${agent.agentName}`} className="rank__row">
                  <span className="rank__index">{index + 1}</span>
                  <span className="rank__name">{agent.agentName}</span>
                  <span className="rank__meta">
                    {formatNumber(agent.tasks)} 任务 · {formatNumber(agent.images)} 图
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.failureReasons.length > 0 ? (
            <>
              <div className="divider" />
              <p className="muted">失败原因</p>
              <div className="chips">
                {data.failureReasons.map((reason) => (
                  <span key={reason.code} className="chip chip--danger">
                    {reason.code} · {reason.count}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}
