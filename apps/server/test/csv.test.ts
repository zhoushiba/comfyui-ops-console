/** CSV：BOM、转义、中文表头、流式分页与行数上限 */
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  CsvStreamer,
  UTF8_BOM,
  escapeCsvCell,
  formatCents,
  streamCsv,
  toCsvLine,
} from '../src/lib/csv.js';

function collector(): { sink: Writable; chunks: Buffer[] } {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return { sink, chunks };
}

describe('CSV 转义', () => {
  it('逗号、双引号、换行都会被引号包裹，内部引号翻倍', () => {
    expect(escapeCsvCell('普通文本')).toBe('普通文本');
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('他说"你好"')).toBe('"他说""你好"""');
    expect(escapeCsvCell('第一行\n第二行')).toBe('"第一行\n第二行"');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(0)).toBe('0');
  });

  it('每行以 CRLF 结尾，列用逗号分隔', () => {
    expect(toCsvLine(['任务', 12, 3.5])).toBe('任务,12,3.5\r\n');
    expect(toCsvLine(['a,b', 'c"d'])).toBe('"a,b","c""d"\r\n');
  });

  it('金额（分）格式化为两位小数元', () => {
    expect(formatCents(123456)).toBe('1234.56');
    expect(formatCents(1)).toBe('0.01');
  });
});

describe('流式 CSV', () => {
  it('首 3 字节是 UTF-8 BOM，表头为中文', async () => {
    const { sink, chunks } = collector();
    await streamCsv({
      sink,
      headers: ['任务编号', '用户名', '图片数'],
      fetchPage: async () => [['T20260101-abcdef', '小林', 2]],
    });
    const buffer = Buffer.concat(chunks);
    expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(buffer.subarray(0, 3).equals(UTF8_BOM)).toBe(true);
    const lines = buffer.toString('utf8').replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe('任务编号,用户名,图片数');
    expect(lines[1]).toBe('T20260101-abcdef,小林,2');
  });

  it('按页拉取直到不足一页，返回写入行数与页数', async () => {
    const offsets: number[] = [];
    const { sink, chunks } = collector();
    const result = await streamCsv({
      sink,
      headers: ['id'],
      pageSize: 2,
      fetchPage: async (offset) => {
        offsets.push(offset);
        return [offset, offset + 1].slice(0, Math.max(0, 3 - offset)).map((id) => [id]);
      },
    });
    expect(result.rows).toBe(3);
    expect(result.pages).toBe(2);
    expect(offsets).toEqual([0, 2]);
    expect(Buffer.concat(chunks).toString('utf8')).toContain('id\r\n0\r\n1\r\n2\r\n');
  });

  it('超过 maxRows 时停止分页，避免异常数据无限导出', async () => {
    const { sink } = collector();
    let calls = 0;
    const result = await streamCsv({
      sink,
      headers: ['id'],
      pageSize: 2,
      maxRows: 2,
      fetchPage: async () => {
        calls += 1;
        return [[1], [2]];
      },
    });
    expect(result.rows).toBe(2);
    expect(calls).toBe(1);
  });

  it('CsvStreamer 重复 begin 会报错，防止写出两个 BOM', async () => {
    const { sink } = collector();
    const streamer = new CsvStreamer(sink);
    await streamer.begin(['a']);
    await expect(streamer.begin(['b'])).rejects.toThrow('already started');
    await streamer.writeRows([[1], [2]]);
    expect(streamer.rowsWritten).toBe(2);
  });
});
