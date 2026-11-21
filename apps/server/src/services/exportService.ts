/**
 * CSV 导出服务：用量明细 + 代理商结算。
 *
 * 路由层拿到 PassThrough 流后立刻 send，数据边查边写；
 * done Promise 用于写审计日志（导出完成后再落库，避免大文件阻塞响应头）。
 */
import { PassThrough } from 'node:stream';
import { csvFileName, formatCents, streamCsv } from '../lib/csv.js';
import type { AuditRepository } from '../repositories/configRepo.js';
import type { SettlementRepository } from '../repositories/settlementRepo.js';
import type { UsageFilters, UsageRepository } from '../repositories/usageRepo.js';

export interface ExportStream {
  filename: string;
  contentType: string;
  stream: PassThrough;
  done: Promise<{ filename: string; rows: number }>;
}

export interface ExportActor {
  id: number;
  ip?: string | null;
}

const USAGE_HEADERS = [
  '任务编号',
  '用户名',
  '代理商',
  '模型',
  '状态',
  '图片数',
  '耗时(毫秒)',
  'GPU秒',
  '是否计费',
  '发生日期',
];

const SETTLEMENT_HEADERS = [
  '结算单号',
  '代理商',
  '账期开始',
  '账期结束',
  '状态',
  '任务数',
  '图片数',
  '流水(元)',
  '平台分成(元)',
  '代理商应结(元)',
  '创建时间',
];

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    queued: '排队中',
    submitted: '已提交',
    running: '生成中',
    polling: '轮询中',
    downloading: '下载中',
    completed: '已完成',
    failed: '失败',
    timeout: '超时',
    unreachable: '不可达',
    pending: '待确认',
    confirmed: '已确认',
    paid: '已打款',
  };
  return map[status] ?? status;
}

export class ExportService {
  private readonly usage: UsageRepository;
  private readonly settlements: SettlementRepository;
  private readonly audit: AuditRepository;

  constructor(usage: UsageRepository, settlements: SettlementRepository, audit: AuditRepository) {
    this.usage = usage;
    this.settlements = settlements;
    this.audit = audit;
  }

  usageCsv(filters: UsageFilters, actor: ExportActor): ExportStream {
    const filename = csvFileName('usage');
    const stream = new PassThrough();
    const done = (async () => {
      try {
        const result = await streamCsv({
          sink: stream,
          headers: USAGE_HEADERS,
          pageSize: 500,
          fetchPage: async (offset, limit) => {
            const rows = await this.usage.page(filters, offset, limit);
            return rows.map((row) => [
              row.task_no ?? '',
              row.user_name ?? '',
              row.agent_name ?? '自营',
              row.model_name ?? '',
              statusLabel(String(row.status ?? '')),
              Number(row.image_count ?? 0),
              row.duration_ms ?? '',
              Number(row.gpu_seconds ?? 0),
              Number(row.billable) === 1 || row.billable === true ? '是' : '否',
              row.occurred_at ?? '',
            ]);
          },
        });
        stream.end();
        await this.audit.record({
          actorId: actor.id,
          action: 'export.usage',
          targetType: 'usage_record',
          targetId: filename,
          detail: { filters, rows: result.rows, pages: result.pages },
          ip: actor.ip ?? null,
        });
        return { filename, rows: result.rows };
      } catch (error) {
        stream.destroy(error as Error);
        throw error;
      }
    })();
    return { filename, contentType: 'text/csv; charset=utf-8', stream, done };
  }

  settlementCsv(filters: { agentId?: number; status?: string }, actor: ExportActor): ExportStream {
    const filename = csvFileName('settlement');
    const stream = new PassThrough();
    const done = (async () => {
      try {
        const result = await streamCsv({
          sink: stream,
          headers: SETTLEMENT_HEADERS,
          pageSize: 500,
          fetchPage: async (offset, limit) => {
            const rows = await this.settlements.list(filters, offset, limit);
            return rows.map((row) => [
              row.settlement_no,
              row.agent_name ?? '',
              row.period_start,
              row.period_end,
              statusLabel(row.status),
              row.task_count,
              row.image_count,
              formatCents(row.gross_cents),
              formatCents(row.platform_fee_cents),
              formatCents(row.agent_amount_cents),
              row.created_at,
            ]);
          },
        });
        stream.end();
        await this.audit.record({
          actorId: actor.id,
          action: 'export.settlement',
          targetType: 'settlement',
          targetId: filename,
          detail: { filters, rows: result.rows },
          ip: actor.ip ?? null,
        });
        return { filename, rows: result.rows };
      } catch (error) {
        stream.destroy(error as Error);
        throw error;
      }
    })();
    return { filename, contentType: 'text/csv; charset=utf-8', stream, done };
  }
}
