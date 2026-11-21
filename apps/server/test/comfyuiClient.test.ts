/** ComfyUI 客户端：正常 / 400 node_errors / 500 / 超时 / 连接拒绝 / 空历史 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ComfyUiClient, ComfyUiError } from '../src/services/comfyuiClient.js';

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

const servers: TestServer[] = [];

async function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<TestServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const entry: TestServer = {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
  servers.push(entry);
  return entry;
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server?.close();
  }
});

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

describe('ComfyUiClient', () => {
  it('submitPrompt 正常返回 prompt_id 与 number', async () => {
    let received: { prompt?: unknown; client_id?: string } = {};
    const server = await startServer(async (req, res) => {
      received = JSON.parse(await readBody(req));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ prompt_id: 'p-123', number: 7, node_errors: {} }));
    });
    const client = new ComfyUiClient({ baseUrl: server.url, timeoutMs: 2000 });
    const result = await client.submitPrompt({ '1': { class_type: 'X', inputs: {} } }, 'client-1');
    expect(result.promptId).toBe('p-123');
    expect(result.number).toBe(7);
    expect(received.client_id).toBe('client-1');
    expect(received.prompt).toMatchObject({ '1': { class_type: 'X' } });
  });

  it('400 时抛出 kind=http 且保留 node_errors 原始错误体，不重试', async () => {
    const errorBody = {
      error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation', details: 'text' },
      node_errors: { '2': { errors: [{ type: 'required_input_missing', message: 'Required input is missing', details: 'text' }], class_type: 'CLIPTextEncode' } },
    };
    const server = await startServer((_req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(errorBody));
    });
    const client = new ComfyUiClient({ baseUrl: server.url, timeoutMs: 2000 });
    const error = await client.submitPrompt({}, 'c').catch((err: unknown) => err as ComfyUiError);
    expect(error).toBeInstanceOf(ComfyUiError);
    expect(error.kind).toBe('http');
    expect(error.status).toBe(400);
    expect(error.retriable).toBe(false);
    expect(error.bodyText).toContain('prompt_outputs_failed_validation');
    expect((error.nodeErrors as typeof errorBody).node_errors['2'].errors[0].details).toBe('text');
  });

  it('500 标记为可重试', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal' }));
    });
    const client = new ComfyUiClient({ baseUrl: server.url, timeoutMs: 2000 });
    const error = await client.getQueue().catch((err: unknown) => err as ComfyUiError);
    expect(error.kind).toBe('http');
    expect(error.status).toBe(500);
    expect(error.retriable).toBe(true);
  });

  it('请求超时归类为 kind=timeout', async () => {
    const server = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      }, 300);
    });
    const client = new ComfyUiClient({ baseUrl: server.url, timeoutMs: 60 });
    const error = await client.submitPrompt({}, 'c').catch((err: unknown) => err as ComfyUiError);
    expect(error.kind).toBe('timeout');
    expect(error.retriable).toBe(true);
  });

  it('连接被拒绝归类为 unreachable（用于“服务未启动”场景）', async () => {
    const server = await startServer((_req, res) => res.end('{}'));
    const deadUrl = server.url;
    await server.close();
    servers.splice(servers.indexOf(server), 1);

    const client = new ComfyUiClient({ baseUrl: deadUrl, timeoutMs: 800 });
    const error = await client.submitPrompt({}, 'c').catch((err: unknown) => err as ComfyUiError);
    expect(error.kind).toBe('unreachable');
    expect(error.retriable).toBe(true);
    expect(error.message).toContain('无法连接 ComfyUI');
  });

  it('history 返回 {} 时归一化为 null（任务未完成）', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    const client = new ComfyUiClient({ baseUrl: server.url, timeoutMs: 2000 });
    await expect(client.getHistory('absent')).resolves.toBeNull();
  });

  it('downloadImage 返回真实字节与 content-type', async () => {
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const server = await startServer((req, res) => {
      expect(req.url).toContain('/view?');
      expect(req.url).toContain('filename=ComfyUI_0001.png');
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(payload);
    });
    const client = new ComfyUiClient({ baseUrl: server.url, timeoutMs: 2000 });
    const result = await client.downloadImage({ filename: 'ComfyUI_0001.png', subfolder: '', type: 'output' });
    expect(result.contentType).toBe('image/png');
    expect(Buffer.compare(result.buffer, payload)).toBe(0);
  });
});
