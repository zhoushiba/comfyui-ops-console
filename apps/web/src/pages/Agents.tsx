/** 代理商与结算：代理商卡片、结算单列表、确认/打款与 CSV 导出 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { formatCents, formatDateTime, formatNumber } from '../lib/format';
import { toast } from '../store/toast';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SkeletonCard,
  SkeletonTable,
} from '../components/ui';

const SETTLEMENT_LABELS: Record<string, string> = {
  pending: '待确认',
  confirmed: '已确认',
  paid: '已打款',
};

const SETTLEMENT_TONES: Record<string, string> = {
  pending: 'warn',
  confirmed: 'info',
  paid: 'success',
};

export default function AgentsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [exported, setExported] = useState<number>(0);

  const agents = useQuery({ queryKey: ['agents'], queryFn: api.agents.list });

  const settlements = useQuery({
    queryKey: ['settlements', { status, page }],
    queryFn: () => api.settlements.list({ page, pageSize: 10, status: status || undefined }),
  });

  const exportCsv = useMutation({
    mutationFn: () =>
      api.settlements.exportCsv({ status: status || undefined }, (received) => setExported(received)),
    onSuccess: (name) => {
      setExported(0);
      toast.success('导出完成', name);
    },
    onError: (error) => {
      setExported(0);
      toast.error('导出失败', errorMessage(error));
    },
  });

  const decide = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'confirm' | 'pay' }) =>
      action === 'confirm' ? api.settlements.confirm(id) : api.settlements.pay(id),
    onSuccess: (data) => {
      toast.success('状态已更新', `${data.settlement.settlement_no} → ${SETTLEMENT_LABELS[data.settlement.status]}`);
      queryClient.invalidateQueries({ queryKey: ['settlements'] });
    },
    onError: (error) => toast.error('操作失败', errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        title="代理商与结算"
        description="阶梯计价按账期累计图片数；结算单状态流转为 待确认 → 已确认 → 已打款"
        actions={
          <button
            type="button"
            className="btn btn--primary"
            disabled={exportCsv.isPending}
            onClick={() => exportCsv.mutate()}
          >
            {exportCsv.isPending ? `导出中 · ${(exported / 1024).toFixed(0)} KB` : '导出结算 CSV'}
          </button>
        }
      />

      {agents.isLoading ? (
        <div className="grid grid--3">
          {Array.from({ length: 3 }).map((_, index) => (
            <SkeletonCard key={index} rows={3} />
          ))}
        </div>
      ) : agents.isError ? (
        <ErrorState message={errorMessage(agents.error)} onRetry={() => agents.refetch()} />
      ) : (agents.data?.items.length ?? 0) === 0 ? (
        <div className="card">
          <EmptyState title="还没有代理商" description="执行 npm run db:seed 会创建一个示例代理商" />
        </div>
      ) : (
        <div className="grid grid--3">
          {agents.data?.items.map((agent) => (
            <Link key={agent.id} to={`/agents/${agent.id}`} className="card link-card">
              <div className="card__head">
                <h2>{agent.name}</h2>
                <span className="mono muted">{agent.code}</span>
              </div>
              <dl className="kv">
                <div>
                  <span className="muted">联系人</span>
                  <span>{agent.contactName ?? '—'}</span>
                </div>
                <div>
                  <span className="muted">分成比例</span>
                  <span>{Math.round(agent.shareRatio * 100)}%</span>
                </div>
                <div>
                  <span className="muted">下级用户</span>
                  <span>{formatNumber(agent.userCount)}</span>
                </div>
              </dl>
              <div className="mini-stats">
                <div>
                  <span className="muted">本月任务</span>
                  <strong>{formatNumber(agent.monthTasks)}</strong>
                </div>
                <div>
                  <span className="muted">本月图片</span>
                  <strong>{formatNumber(agent.monthImages)}</strong>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <section className="card card--flush">
        <div className="card__head card__head--pad">
          <h2>结算单</h2>
          <label className="field field--inline">
            <span className="field__label">状态</span>
            <select
              className="input input--sm"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部</option>
              {Object.entries(SETTLEMENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {settlements.isLoading ? (
          <SkeletonTable rows={6} />
        ) : settlements.isError ? (
          <ErrorState message={errorMessage(settlements.error)} onRetry={() => settlements.refetch()} />
        ) : (settlements.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="没有结算单"
            description="进入代理商详情，选择账期后可以生成结算单"
            action={
              agents.data && agents.data.items.length > 0 ? (
                <Link className="btn btn--primary" to={`/agents/${agents.data.items[0].id}`}>
                  去生成
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>结算单号</th>
                    <th>代理商</th>
                    <th>账期</th>
                    <th>状态</th>
                    <th className="num">任务</th>
                    <th className="num">图片</th>
                    <th className="num">流水</th>
                    <th className="num">代理商应结</th>
                    <th>创建时间</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {settlements.data?.items.map((settlement) => (
                    <tr key={settlement.id}>
                      <td className="mono">{settlement.settlement_no}</td>
                      <td>{settlement.agent_name ?? `#${settlement.agent_id}`}</td>
                      <td className="muted">
                        {settlement.period_start} ~ {settlement.period_end}
                      </td>
                      <td>
                        <span className={`badge badge--${SETTLEMENT_TONES[settlement.status] ?? 'neutral'}`}>
                          <span className="badge__dot" />
                          {SETTLEMENT_LABELS[settlement.status] ?? settlement.status}
                        </span>
                      </td>
                      <td className="num">{settlement.task_count}</td>
                      <td className="num">{settlement.image_count}</td>
                      <td className="num">{formatCents(settlement.gross_cents)}</td>
                      <td className="num">{formatCents(settlement.agent_amount_cents)}</td>
                      <td className="muted">{formatDateTime(settlement.created_at)}</td>
                      <td>
                        {settlement.status === 'pending' ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: settlement.id, action: 'confirm' })}
                          >
                            确认
                          </button>
                        ) : settlement.status === 'confirmed' ? (
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: settlement.id, action: 'pay' })}
                          >
                            打款
                          </button>
                        ) : (
                          <span className="muted small">已完成</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {settlements.data ? (
              <Pagination
                page={settlements.data.page}
                pageSize={settlements.data.pageSize}
                total={settlements.data.total}
                onChange={setPage}
              />
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
