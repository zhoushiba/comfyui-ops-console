/**
 * CSV 导出基础设施。
 *
 * 需求（JD 第 1 条）：
 *  - 流式输出：分页拉数据，边取边写，不把全量结果放进内存；
 *  - UTF-8 BOM：Excel 打开中文不乱码（EF BB BF）；
 *  - 正确转义：逗号 / 双引号 / 换行 / 回车；
 *  - 文件名带时间戳。
 */
import { once } from 'node:events';
import type { Writable } from 'node:stream';

/** UTF-8 BOM，Excel 识别 UTF-8 的关键 3 字节 */
export const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const NEEDS_QUOTE = /[",\r\n]/;

/** 单元格转义：包含逗号、引号、换行时用双引号包裹，内部引号翻倍 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  if (NEEDS_QUOTE.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** 一行 CSV（CRLF 换行，兼容 Excel/WPS） */
export function toCsvLine(values: unknown[]): string {
  return `${values.map(escapeCsvCell).join(',')}\r\n`;
}

/** 金额（分）格式化为两位小数的元，插入 CSV 时保持数值可计算 */
export function formatCents(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

/** 生成带时间戳的文件名，如 usage-20261116-183012.csv */
export function csvFileName(prefix: string, date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${prefix}-${stamp}.csv`;
}

/**
 * 流式写 CSV：先写 BOM + 表头，再按页取数据写入。
 * 每次写完后如果目标流返回 false（缓冲区满）就等待 drain，保证大文件不占内存。
 */
export class CsvStreamer {
  private readonly sink: Writable;
  private rows = 0;
  private started = false;

  constructor(sink: Writable) {
    this.sink = sink;
  }

  get rowsWritten(): number {
    return this.rows;
  }

  private async write(chunk: string): Promise<void> {
    if (!this.sink.write(chunk)) {
      await once(this.sink, 'drain');
    }
  }

  async begin(headers: string[]): Promise<void> {
    if (this.started) throw new Error('CsvStreamer already started');
    this.started = true;
    // BOM 必须最先写入，后续内容都跟在它后面
    this.sink.write(UTF8_BOM);
    await this.write(toCsvLine(headers));
  }

  async writeRow(values: unknown[]): Promise<void> {
    this.rows += 1;
    await this.write(toCsvLine(values));
  }

  async writeRows(rows: unknown[][]): Promise<void> {
    if (rows.length === 0) return;
    // 合并成一次写入，减少系统调用；仍然受 backpressure 保护
    this.rows += rows.length;
    await this.write(rows.map(toCsvLine).join(''));
  }
}

export interface StreamCsvOptions {
  sink: Writable;
  headers: string[];
  /** 分页取数据：offset/limit 语义，返回空数组代表结束 */
  fetchPage: (offset: number, limit: number) => Promise<unknown[][]>;
  pageSize?: number;
  /** 安全上限，避免异常数据导致无限分页 */
  maxRows?: number;
}

/**
 * 通用分页流式导出。返回写入行数与页数，便于审计与测试断言。
 */
export async function streamCsv(options: StreamCsvOptions): Promise<{ rows: number; pages: number }> {
  const pageSize = options.pageSize ?? 500;
  const maxRows = options.maxRows ?? 100_000;
  const streamer = new CsvStreamer(options.sink);
  await streamer.begin(options.headers);

  let offset = 0;
  let pages = 0;
  for (;;) {
    const page = await options.fetchPage(offset, pageSize);
    pages += 1;
    if (page.length === 0) break;
    await streamer.writeRows(page);
    offset += page.length;
    if (streamer.rowsWritten >= maxRows) break;
    if (page.length < pageSize) break;
  }

  return { rows: streamer.rowsWritten, pages };
}
