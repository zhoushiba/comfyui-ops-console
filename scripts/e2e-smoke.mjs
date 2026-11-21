#!/usr/bin/env node
/**
 * 端到端冒烟：真实走一遍「登录 → 提交任务 → 轮询 → 下载 → 幂等」链路。
 *
 * 前置：mock（8188）与服务端（3000）已启动，且已执行过 db:setup --seed。
 * 用法：node scripts/e2e-smoke.mjs [--base http://127.0.0.1:3000] [--mock http://127.0.0.1:8188]
 */
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const BASE = argValue('--base', process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000');
const MOCK = argValue('--mock', process.env.SMOKE_MOCK_URL ?? 'http://127.0.0.1:8188');
const EMAIL = argValue('--email', 'admin@ops.local');
const PASSWORD = argValue('--password', 'Admin@123456');
const TIMEOUT_MS = Number(argValue('--timeout', '45000'));

let failures = 0;
function check(name, condition, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ''}`);
}

async function json(path, options = {}, token) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function main() {
  console.log(`冒烟目标：server=${BASE} mock=${MOCK}`);

  const health = await json('/api/health');
  check('服务健康检查', health.response.ok && health.body?.success === true);

  const mockStats = await fetch(`${MOCK}/system_stats`).then((r) => r.json());
  check('Mock ComfyUI 可达', Boolean(mockStats?.system?.comfyui_version), mockStats?.system?.comfyui_version);

  const login = await json('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  check('管理员登录', login.response.ok && Boolean(login.body?.data?.token));
  const token = login.body?.data?.token;
  if (!token) throw new Error('登录失败，无法继续');

  const templates = await json('/api/templates', {}, token);
  const template = templates.body?.data?.items?.[0];
  check('模板列表非空', Boolean(template), template ? `#${template.id} ${template.name}` : '');
  if (!template) throw new Error('没有可用模板');

  const clientRequestId = `smoke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const created = await json(
    '/api/tasks',
    {
      method: 'POST',
      body: JSON.stringify({
        templateId: template.id,
        prompt: 'a red fox in snowy forest, cinematic lighting',
        negativePrompt: 'blurry, watermark',
        steps: 12,
        cfg: 7,
        width: 512,
        height: 512,
        clientRequestId,
      }),
    },
    token,
  );
  const task = created.body?.data?.task;
  check('任务创建成功', created.response.ok && Boolean(task?.id), task ? `${task.taskNo} status=${task.status}` : JSON.stringify(created.body));
  if (!task) throw new Error('创建任务失败');

  const duplicate = await json(
    '/api/tasks',
    {
      method: 'POST',
      body: JSON.stringify({ templateId: template.id, prompt: 'duplicate submit', clientRequestId }),
    },
    token,
  );
  check(
    '幂等键返回同一任务',
    duplicate.body?.data?.created === false && duplicate.body?.data?.task?.id === task.id,
    `taskId=${duplicate.body?.data?.task?.id}`,
  );

  const startedAt = Date.now();
  let detail = null;
  let lastStatus = '';
  while (Date.now() - startedAt < TIMEOUT_MS) {
    const current = await json(`/api/tasks/${task.id}`, {}, token);
    detail = current.body?.data;
    const status = detail?.task?.status;
    if (status !== lastStatus) {
      lastStatus = status;
      console.log(`        状态 → ${status}（progress=${detail?.task?.progress}）`);
    }
    if (['completed', 'failed', 'timeout', 'unreachable'].includes(status)) break;
    await sleep(400);
  }
  check('任务到达终点', detail?.task?.status === 'completed', `最终状态=${detail?.task?.status} 耗时=${Date.now() - startedAt}ms`);
  check('任务有图片产物', (detail?.images?.length ?? 0) >= 1, `images=${detail?.images?.length ?? 0}`);
  check('记录尝试轨迹', (detail?.attempts?.length ?? 0) >= 1, `attempts=${detail?.attempts?.length ?? 0}`);

  const image = detail?.images?.[0];
  if (image) {
    const fileResponse = await fetch(`${BASE}${image.url}`, { headers: { Authorization: `Bearer ${token}` } });
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    check('图片可下载且是真实 PNG', fileResponse.ok && isPng, `bytes=${bytes.length}`);
    check('图片字节数合理（非空壳）', bytes.length > 2000, `${bytes.length} bytes`);

    const thumb = await fetch(`${BASE}${image.thumbnailUrl}`, { headers: { Authorization: `Bearer ${token}` } });
    check('缩略图可访问', thumb.ok, `status=${thumb.status}`);
  }

  const overview = await json('/api/overview', {}, token);
  check('总览接口可用', overview.response.ok && Boolean(overview.body?.data?.today));

  console.log(failures === 0 ? '\n冒烟通过 ✅' : `\n冒烟失败：${failures} 项 ❌`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('冒烟异常：', error);
  process.exitCode = 1;
});
