/** 代理商详情：基础信息、下级用户、定价规则、账期结算预览与生成 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { formatCents, monthStartKey, todayKey } from '../lib/format';
import { toast } from '../store/toast';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonCard,
  Spinner,
  StatCard,
} from '../components/ui';

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const agentId = Number(id);
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(monthStartKey());
  const [to, setTo] = useState(todayKey());
  const [period, setPeriod] = useState({ from: monthStartKey(), to: todayKey() });

  const detail = useQuery({
    queryKey: ['agent', agentId],
    queryFn: () => api.agents.detail(agentId),
    enabled: Number.isFinite(agentId) && agentId > 0,
  });

  const preview = useQuery({
    queryKey: ['agent', agentId, 'preview', period],
    queryFn: () => api.agents.preview(agentId, period.from, period.to),
    enabled: Number.isFinite(agentId) && agentId > 0,
    retry: false,
  });

  const create = useMutation({
    mutationFn: () => api.settlements.create(agentId, period.from, period.to),
    onSuccess: (data) => {
      toast.success('结算单已生成', data.settlementNo);
      queryClient.invalidateQueries({ queryKey: ['agent', agentId, 'preview', period] });
      queryClient.invalidateQueries({ queryKey: ['settlements'] });
    },
    onError: (error) => toast.error('生成失败', errorMessage(error)),
  });

  if (detail.isLoading) {
    return (
      <>
        <PageHeader title="代理商详情" />
        <SkeletonCard rows={4} />
        <SkeletonCard rows={6} />
      </>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <>
        <PageHeader title="代理商详情" />
        <ErrorState message={errorMessage(detail.error)} onRetry={() => detail.refetch()} />
      </>
    );
  }

  const { agent, users, pricingRules } = detail.data;

  return (
    <>
      <PageHeader
        title={agent.name}
        description={`编码 ${agent.code} · 联系人 ${agent.contactName ?? '—'} ${agent.contactPhone ?? ''}`}
        actions={
          <Link className="btn btn--ghost" to="/agents">
            返回列表
          </Link>
        }
      />

      <div className="grid grid--3">
        <section className="card">
          <div className="card__head">
            <h2>合作信息</h2>
          </div>
          <dl className="kv">
            <div>
              <span className="muted">分成比例</span>
              <span>{Math.round(agent.shareRatio * 100)}%</span>
            </div>
            <div>
              <span className="muted">状态</span>
              <span>{agent.status === 'active' ? '合作中' : agent.status}</span>
            </div>
            <div>
              <span className="muted">下级用户</span>
              <span>{users.length}</span>
            </div>
          </dl>
          <div className="divider" />
          <p className="muted small">下级用户</p>
          {users.length === 0 ? (
            <EmptyState title="暂无下级用户" />
          ) : (
            <ul className="simple-list">
              {users.map((user) => (
                <li key={user.userId}>
                  <span>{user.name}</span>
                  <span className="muted mono">{user.email}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card__head">
            <h2>定价规则</h2>
            <span className="muted">{pricingRules.length} 条</span>
          </div>
          {pricingRules.length === 0 ? (
            <EmptyState title="尚未配置定价" description="缺少定价规则时无法生成结算单" />
          ) : (
            <ul className="simple-list">
              {pricingRules.map((rule) => (
                <li key={rule.id}>
                  <span className="mono">{rule.modelName}</span>
                  <span className="muted">
                    {formatCents(rule.basePriceCents)}/张 · 满 {rule.tierThreshold} 张后 {formatCents(rule.tier2PriceCents)}/张 · 分成{' '}
                    {Math.round(rule.shareRatio * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card__head">
            <h2>账期结算</h2>
          </div>
          <div className="filters">
            <label className="field field--inline">
              <span className="field__label">开始</span>
              <input className="input input--sm" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="field field--inline">
              <span className="field__label">结束</span>
              <input className="input input--sm" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPeriod({ from, to })}>
              查询
            </button>
          </div>
          <p className="muted small">
            当前账期 {period.from} ~ {period.to}
          </p>
        </section>
      </div>

      {preview.isLoading ? (
        <SkeletonCard rows={6} />
      ) : preview.isError ? (
        <ErrorState message={errorMessage(preview.error)} onRetry={() => preview.refetch()} />
      ) : preview.data ? (
        <>
          <div className="grid grid--4">
            <StatCard label="计费任务" value={preview.data.taskCount} hint={`${preview.data.userCount} 位用户`} />
            <StatCard label="计费图片" value={preview.data.imageCount} hint="成功且计费的记录" />
            <StatCard label="流水金额" value={formatCents(preview.data.amount.grossCents)} hint="按阶梯单价累计" />
            <StatCard
              label="代理商应结"
              value={formatCents(preview.data.amount.agentAmountCents)}
              hint={`平台留存 ${formatCents(preview.data.amount.platformFeeCents)} · 分成 ${Math.round(preview.data.amount.shareRatio * 100)}%`}
              tone="good"
            />
          </div>

          <section className="card">
            <div className="card__head">
              <h2>阶梯明细</h2>
              <div>
                {preview.data.existingSettlementId ? (
                  <span className="badge badge--info">
                    <span className="badge__dot" />
                    该账期已生成 #{preview.data.existingSettlementId}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={create.isPending || preview.data.imageCount === 0}
                    onClick={() => create.mutate()}
                  >
                    {create.isPending ? <Spinner label="生成中" /> : '生成结算单'}
                  </button>
                )}
              </div>
            </div>
            {preview.data.items.length === 0 ? (
              <EmptyState title="该账期没有可结算用量" description="换一个账期，或等待任务完成后再试" />
            ) : (
              <>
                <div className="grid grid--3">
                  {preview.data.amount.tiers.map((tier) => (
                    <div key={tier.label} className="tier-card">
                      <span className="muted">{tier.label}</span>
                      <strong>{tier.imageCount} 张 × {formatCents(tier.unitPriceCents)}</strong>
                      <span>{formatCents(tier.amountCents)}</span>
                    </div>
                  ))}
                </div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>明细</th>
                        <th className="num">图片</th>
                        <th className="num">单价</th>
                        <th className="num">金额</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.data.items.slice(0, 50).map((item, index) => (
                        <tr key={`${item.description}-${index}`}>
                          <td>{item.description}</td>
                          <td className="num">{item.imageCount}</td>
                          <td className="num">{formatCents(item.unitPriceCents)}</td>
                          <td className="num">{formatCents(item.amountCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.data.items.length > 50 ? (
                  <p className="muted small">仅展示前 50 条明细，共 {preview.data.items.length} 条。</p>
                ) : null}
              </>
            )}
          </section>

          {preview.data.users.length > 0 ? (
            <section className="card">
              <div className="card__head">
                <h2>下级用户用量</h2>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>用户</th>
                      <th className="num">任务</th>
                      <th className="num">图片</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.data.users.map((user) => (
                      <tr key={user.userId}>
                        <td>{user.userName}</td>
                        <td className="num">{user.tasks}</td>
                        <td className="num">{user.images}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
