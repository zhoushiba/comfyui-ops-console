/** 通用小工具 */
import { randomBytes } from 'node:crypto';

/** 生成任务号：T + 年月日 + 6 位随机（去重靠唯一索引兜底） */
export function taskNo(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return `T${stamp}${randomBytes(3).toString('hex').toUpperCase()}`;
}

/** 结算单号：S + 代理商 id + 账期 */
export function settlementNo(agentId: number, periodStart: string, periodEnd: string): string {
  return `S${agentId}-${periodStart.replace(/-/g, '')}-${periodEnd.replace(/-/g, '')}`;
}

/** 计算分位数（线性插值），输入需升序 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low]!;
  const weight = rank - low;
  return sorted[low]! * (1 - weight) + sorted[high]! * weight;
}

/** 四舍五入到指定小数位（避免 0.1+0.2 类浮点误差） */
export function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** 今天往前 N 天的日期键（YYYY-MM-DD） */
export function dateKeyOffset(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
