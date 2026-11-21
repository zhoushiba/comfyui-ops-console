/** 展示层格式化工具：时间、耗时、字节、金额、百分比 */

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return value.slice(0, 10);
}

export function formatTimeAgo(value: string | null | undefined): string {
  if (!value) return '—';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return value;
  const diff = Date.now() - time;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  return `${Math.round(seconds * 10) / 10} s`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return `¥${(cents / 100).toFixed(2)}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('zh-CN').format(value);
}

export function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function monthStartKey(): string {
  return `${todayKey().slice(0, 7)}-01`;
}

export function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 10)}…` : value;
}
