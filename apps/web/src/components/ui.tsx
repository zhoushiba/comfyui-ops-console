/** 通用 UI 原子组件：状态徽章、骨架屏、空态、错误态、弹窗、分页、进度条 */
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { statusLabel, statusTone } from '../lib/status';
import { formatNumber } from '../lib/format';

export function StatusBadge({ status, pulse = false }: { status: string; pulse?: boolean }) {
  return (
    <span className={`badge badge--${statusTone(status)}${pulse ? ' badge--pulse' : ''}`}>
      <span className="badge__dot" />
      {statusLabel(status)}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-live="polite">
      <span className="spinner__circle" />
      {label ? <span>{label}</span> : null}
    </span>
  );
}

export function Skeleton({ width = '100%', height = 14, radius = 6 }: { width?: string | number; height?: number; radius?: number }) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius }} />;
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card skeleton-card" aria-hidden="true">
      <Skeleton width="38%" height={18} />
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} width={`${92 - index * 8}%`} height={12} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="table-wrap" aria-hidden="true">
      <table className="table">
        <tbody>
          {Array.from({ length: rows }).map((_, index) => (
            <tr key={index}>
              {Array.from({ length: 5 }).map((__, cell) => (
                <td key={cell}>
                  <Skeleton width={cell === 0 ? 90 : 120} height={12} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon" aria-hidden="true">
        ⌁
      </div>
      <p className="empty__title">{title}</p>
      {description ? <p className="empty__desc">{description}</p> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <div className="error-state__icon" aria-hidden="true">
        !
      </div>
      <div>
        <p className="error-state__title">加载失败</p>
        <p className="error-state__desc">{message}</p>
      </div>
      {onRetry ? (
        <button type="button" className="btn btn--ghost" onClick={onRetry}>
          重试
        </button>
      ) : null}
    </div>
  );
}

export function ProgressBar({ value, tone = 'info', label }: { value: number; tone?: 'info' | 'success' | 'danger'; label?: string }) {
  const safe = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="progress">
      <div className="progress__track">
        <div className={`progress__fill progress__fill--${tone}`} style={{ width: `${safe}%` }} />
      </div>
      <span className="progress__label">{label ?? `${safe}%`}</span>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span className="pagination__info">
        共 {formatNumber(total)} 条 · 第 {page} / {pages} 页
      </span>
      <div className="pagination__actions">
        <button type="button" className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          上一页
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-head__title">{title}</h1>
        {description ? <p className="page-head__desc">{description}</p> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'bad';
}) {
  return (
    <div className={`stat stat--${tone}`}>
      <span className="stat__label">{label}</span>
      <strong className="stat__value">{value}</strong>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </div>
  );
}
