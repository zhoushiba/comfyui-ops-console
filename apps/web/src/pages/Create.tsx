/** 出图表单：模板选择、提示词、高级参数、客户端幂等键 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { toast } from '../store/toast';
import { EmptyState, ErrorState, PageHeader, SkeletonCard, Spinner } from '../components/ui';

interface FormState {
  prompt: string;
  negativePrompt: string;
  seed: number;
  steps: number;
  cfg: number;
  width: number;
  height: number;
  batchSize: number;
}

const DEFAULTS: FormState = {
  prompt: 'a cinematic portrait of an astronaut, soft rim light, ultra detailed',
  negativePrompt: 'low quality, blurry, watermark, text',
  seed: 20261116,
  steps: 24,
  cfg: 7,
  width: 768,
  height: 768,
  batchSize: 1,
};

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

export default function CreatePage() {
  const navigate = useNavigate();
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.templates });
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (templateId !== null || !templates.data || templates.data.items.length === 0) return;
    setTemplateId(templates.data.items[0].id);
  }, [templates.data, templateId]);

  const selected = useMemo(
    () => templates.data?.items.find((template) => template.id === templateId) ?? null,
    [templates.data, templateId],
  );

  const create = useMutation({
    mutationFn: () =>
      api.tasks.create({
        templateId: templateId as number,
        prompt: form.prompt.trim(),
        negativePrompt: form.negativePrompt.trim() || undefined,
        seed: form.seed,
        steps: form.steps,
        cfg: form.cfg,
        width: form.width,
        height: form.height,
        batchSize: form.batchSize,
        clientRequestId,
      }),
    onSuccess: (data) => {
      toast.success(data.created ? '任务已提交' : '已复用同一任务', `${data.task.taskNo} · ${data.task.status}`);
      navigate(`/tasks/${data.task.id}`);
    },
    onError: (error) => toast.error('提交失败', errorMessage(error)),
  });

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  if (templates.isLoading) {
    return (
      <>
        <PageHeader title="出图" description="选择模板并提交任务" />
        <SkeletonCard rows={4} />
        <SkeletonCard rows={6} />
      </>
    );
  }

  if (templates.isError) {
    return (
      <>
        <PageHeader title="出图" />
        <ErrorState message={errorMessage(templates.error)} onRetry={() => templates.refetch()} />
      </>
    );
  }

  if (!templates.data || templates.data.items.length === 0) {
    return (
      <>
        <PageHeader title="出图" />
        <div className="card">
          <EmptyState title="还没有可用的提示词模板" description="执行 npm run db:seed 初始化示例模板" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="出图"
        description="提交后会依次经过提交、执行、轮询、下载四个阶段，可在任务详情实时观察"
      />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid grid--3">
          <section className="card card--span2">
            <div className="card__head">
              <h2>选择模板</h2>
              <span className="muted">{templates.data.items.length} 个可用</span>
            </div>
            <div className="template-picker">
              {templates.data.items.map((template) => (
                <label key={template.id} className={`template-option${templateId === template.id ? ' is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="template"
                    value={template.id}
                    checked={templateId === template.id}
                    onChange={() => setTemplateId(template.id)}
                  />
                  <span className="template-option__name">{template.name}</span>
                  <span className="template-option__meta mono">{template.model_name}</span>
                  {template.description ? <span className="template-option__desc">{template.description}</span> : null}
                </label>
              ))}
            </div>

            <div className="divider" />

            <label className="field">
              <span className="field__label">正向提示词 *</span>
              <textarea
                className="input"
                rows={4}
                required
                value={form.prompt}
                onChange={(event) => patch('prompt', event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">负向提示词</span>
              <textarea
                className="input"
                rows={2}
                value={form.negativePrompt}
                onChange={(event) => patch('negativePrompt', event.target.value)}
              />
            </label>

            <details className="advanced" open>
              <summary>高级参数</summary>
              <div className="grid grid--3">
                <label className="field">
                  <span className="field__label">Seed</span>
                  <div className="input-row">
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={form.seed}
                      onChange={(event) => patch('seed', Number(event.target.value))}
                    />
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => patch('seed', randomSeed())}>
                      随机
                    </button>
                  </div>
                </label>
                <label className="field">
                  <span className="field__label">Steps</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={150}
                    value={form.steps}
                    onChange={(event) => patch('steps', Number(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span className="field__label">CFG</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={30}
                    step={0.5}
                    value={form.cfg}
                    onChange={(event) => patch('cfg', Number(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span className="field__label">宽度</span>
                  <input
                    className="input"
                    type="number"
                    min={64}
                    max={2048}
                    step={64}
                    value={form.width}
                    onChange={(event) => patch('width', Number(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span className="field__label">高度</span>
                  <input
                    className="input"
                    type="number"
                    min={64}
                    max={2048}
                    step={64}
                    value={form.height}
                    onChange={(event) => patch('height', Number(event.target.value))}
                  />
                </label>
                <label className="field">
                  <span className="field__label">每批张数</span>
                  <select
                    className="input"
                    value={form.batchSize}
                    onChange={(event) => patch('batchSize', Number(event.target.value))}
                  >
                    {[1, 2, 3, 4].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </details>
          </section>

          <aside className="card">
            <div className="card__head">
              <h2>提交预览</h2>
            </div>
            <dl className="params">
              <div>
                <dt>模板</dt>
                <dd>{selected?.name ?? '—'}</dd>
              </div>
              <div>
                <dt>模型</dt>
                <dd className="mono">{selected?.model_name ?? '—'}</dd>
              </div>
              <div>
                <dt>尺寸</dt>
                <dd className="mono">
                  {form.width}×{form.height}
                </dd>
              </div>
              <div>
                <dt>步数 / CFG</dt>
                <dd className="mono">
                  {form.steps} / {form.cfg}
                </dd>
              </div>
              <div>
                <dt>预计张数</dt>
                <dd>{form.batchSize} 张</dd>
              </div>
              <div>
                <dt>幂等键</dt>
                <dd className="mono ellipsis" title={clientRequestId}>
                  {clientRequestId}
                </dd>
              </div>
            </dl>
            <p className="muted small">
              同一个幂等键重复提交只会创建一条任务；需要再出一张时请点击下方刷新幂等键。
            </p>
            <div className="stack">
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => setClientRequestId(crypto.randomUUID())}
              >
                刷新幂等键
              </button>
              <button type="submit" className="btn btn--primary btn--block" disabled={create.isPending || !templateId}>
                {create.isPending ? <Spinner label="提交中" /> : '提交出图任务'}
              </button>
            </div>
          </aside>
        </div>
      </form>
    </>
  );
}
