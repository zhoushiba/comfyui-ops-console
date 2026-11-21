/** 任务列表：筛选、自动刷新（可暂停）、分页 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { formatDateTime, formatDuration } from '../lib/format';
import { ALL_STATUSES, isTerminal, statusLabel } from '../lib/status';
import { EmptyState, ErrorState, PageHeader, Pagination, SkeletonTable, StatusBadge } from '../components/ui';

const AUTO_REFRESH_KEY = 'comfyui-ops.tasks.autoRefresh';

export default function TasksPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [keyword, setKeyword] = useState(searchParams.get('keyword') ?? '');
  const [appliedKeyword, setAppliedKeyword] = useState(keyword);
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(() => localStorage.getItem(AUTO_REFRESH_KEY) !== 'off');

  useEffect(() => {
    localStorage.setItem(AUTO_REFRESH_KEY, autoRefresh ? 'on' : 'off');
  }, [autoRefresh]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (status) next.set('status', status);
    if (appliedKeyword) next.set('keyword', appliedKeyword);
    setSearchParams(next, { replace: true });
    setPage(1);
  }, [status, appliedKeyword, setSearchParams]);

  const query = useQuery({
    queryKey: ['tasks', { status, keyword: appliedKeyword, page }],
    queryFn: () =>
      api.tasks.list({
        page,
        pageSize: 15,
        status: status || undefined,
        keyword: appliedKeyword || undefined,
      }),
    refetchInterval: autoRefresh ? 3000 : false,
  });

  return (
    <>
      <PageHeader
        title="任务"
        description="出图任务的状态、进度与重试记录"
        actions={
          <>
            <button
              type="button"
              className={`btn btn--ghost${autoRefresh ? ' is-on' : ''}`}
              onClick={() => setAutoRefresh((value) => !value)}
              aria-pressed={autoRefresh}
            >
              {autoRefresh ? '自动刷新中' : '自动刷新已暂停'}
            </button>
            <Link className="btn btn--primary" to="/create">
              新建任务
            </Link>
          </>
        }
      />

      <section className="card card--tight">
        <form
          className="filters"
          onSubmit={(event) => {
            event.preventDefault();
            setAppliedKeyword(keyword.trim());
          }}
        >
          <label className="field field--inline">
            <span className="field__label">状态</span>
            <select className="input input--sm" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">全部</option>
              {ALL_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {statusLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <label className="field field--inline field--grow">
            <span className="field__label">关键词</span>
            <input
              className="input input--sm"
              placeholder="任务号 / 提示词"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </label>
          <button className="btn btn--primary btn--sm" type="submit">
            筛选
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setStatus('');
              setKeyword('');
              setAppliedKeyword('');
            }}
          >
            重置
          </button>
        </form>
      </section>

      {query.isLoading ? (
        <SkeletonTable rows={8} />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : query.data && query.data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            title="没有符合条件的任务"
            description="调整筛选条件，或提交一个新的出图任务"
            action={
              <Link className="btn btn--primary" to="/create">
                去出图
              </Link>
            }
          />
        </div>
      ) : (
        <section className="card card--flush">
          <div className="table-wrap">
            <table className="table table--hover">
              <thead>
                <tr>
                  <th>任务号</th>
                  <th>提示词</th>
                  <th>状态</th>
                  <th className="num">进度</th>
                  <th className="num">图片</th>
                  <th className="num">尝试</th>
                  <th className="num">耗时</th>
                  <th>创建时间</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.items.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <Link to={`/tasks/${task.id}`} className="mono link">
                        {task.taskNo}
                      </Link>
                    </td>
                    <td className="ellipsis" style={{ maxWidth: 320 }} title={task.prompt}>
                      {task.promptPreview}
                    </td>
                    <td>
                      <StatusBadge status={task.status} pulse={!isTerminal(task.status)} />
                      {task.errorCode ? <div className="cell-sub mono">{task.errorCode}</div> : null}
                    </td>
                    <td className="num mono">{task.status === 'completed' ? '100%' : `${task.progress}%`}</td>
                    <td className="num">{task.imageCount}</td>
                    <td className="num">{task.attempts}</td>
                    <td className="num">{formatDuration(task.durationMs)}</td>
                    <td className="muted">{formatDateTime(task.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.data ? (
            <Pagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onChange={setPage} />
          ) : null}
        </section>
      )}
    </>
  );
}
