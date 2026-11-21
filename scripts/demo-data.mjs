#!/usr/bin/env node
/**
 * 演示数据脚本（本地截图 / 演示环境用，可重复执行）：
 *   1. 用代理商账号提交若干真实出图任务，等待编排链路跑完（真实调用 ComfyUI Mock）
 *   2. 用管理员账号提交一批任务，补齐运营视角的数据
 *   3. 切换 Mock 为 fail 模式，制造一条失败任务（覆盖失败/重试路径）
 *   4. 生成一张代理商结算单并确认
 *
 * 前置：mock(8188) + server(3000) 已启动，且已 `npm run db:setup`。
 * 用法：node scripts/demo-data.mjs [--base http://127.0.0.1:3000] [--mock http://127.0.0.1:8188]
 */
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}
const BASE = argValue('--base', process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:3000');
const MOCK = argValue('--mock', process.env.DEMO_MOCK_URL ?? 'http://127.0.0.1:8188');

const TERMINAL = new Set(['completed', 'failed', 'timeout', 'unreachable']);

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${method} ${path} -> HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload?.data;
}

async function login(email, password) {
  const data = await request('/api/auth/login', { method: 'POST', body: { email, password } });
  return data.token;
}

async function waitTask(id, token, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { task } = await request(`/api/tasks/${id}`, { token });
    if (TERMINAL.has(task.status)) return task;
    if (Date.now() > deadline) throw new Error(`任务 #${id} 等待超时，最后状态 ${task.status}`);
    await sleep(500);
  }
}

async function createTask(token, templateId, payload) {
  const { task } = await request('/api/tasks', {
    method: 'POST',
    token,
    body: {
      templateId,
      clientRequestId: `demo-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      ...payload,
    },
  });
  return task;
}

const STUDIO_PROMPTS = [
  { prompt: '云海之上的漂浮城市，晨光穿透薄雾，电影感广角', batchSize: 2, steps: 28 },
  { prompt: '国风山水，青绿设色，飞鸟掠过山脊，留白构图', batchSize: 1, steps: 24 },
  { prompt: '赛博朋克夜市，霓虹灯牌倒映在积水路面，胶片颗粒', batchSize: 2, steps: 30 },
  { prompt: '极简产品摄影，白色陶瓷杯，柔和顶光，浅景深', batchSize: 1, steps: 20 },
  { prompt: '敦煌壁画风格飞天，金箔与矿物颜料质感', batchSize: 2, steps: 26 },
  { prompt: '雪山日落，长焦压缩感，暖冷对比', batchSize: 1, steps: 22 },
];

const ADMIN_PROMPTS = [
  { prompt: '未来主义建筑概念图，参数化表皮，黄昏', batchSize: 2, steps: 26 },
  { prompt: '宠物拟人插画，水彩质感，温暖色调', batchSize: 1, steps: 18 },
  { prompt: '深海生物发光，微距摄影，纯净黑背景', batchSize: 2, steps: 24 },
];

async function main() {
  console.log(`演示数据目标：server=${BASE} mock=${MOCK}`);

  const adminToken = await login('admin@ops.local', 'Admin@123456');
  const studioToken = await login('studio@ops.local', 'Studio@123456');

  const { items: templates } = await request('/api/templates', { token: adminToken });
  if (!templates?.length) throw new Error('模板为空，请先执行 npm run db:setup -- --seed');
  const templateId = templates[0].id;
  console.log(`使用模板 #${templateId} ${templates[0].name}`);

  // 1) 代理商任务（真实出图，产生 agent 维度的用量与图片）
  const agentTasks = [];
  for (const item of STUDIO_PROMPTS) {
    const task = await createTask(studioToken, templateId, item);
    agentTasks.push(task);
    console.log(`  提交代理商任务 #${task.id} ${task.taskNo ?? ''}`);
  }
  const agentResults = await Promise.all(agentTasks.map((task) => waitTask(task.id, studioToken)));

  // 2) 平台任务
  const adminTasks = [];
  for (const item of ADMIN_PROMPTS) {
    const task = await createTask(adminToken, templateId, item);
    adminTasks.push(task);
    console.log(`  提交平台任务 #${task.id} ${task.taskNo ?? ''}`);
  }
  const adminResults = await Promise.all(adminTasks.map((task) => waitTask(task.id, adminToken)));

  // 3) 故障注入：Mock 返回 500，验证失败态与指数退避重试
  await fetch(`${MOCK}/__admin/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'fail' }),
  }).catch(() => null);
  const failedTask = await createTask(adminToken, templateId, { prompt: '用于验证失败链路与重试的测试提示词', batchSize: 1 });
  const failedResult = await waitTask(failedTask.id, adminToken);
  console.log(`  故障注入任务 #${failedTask.id} -> ${failedResult.status}（attempts=${failedResult.attempts}）`);
  await fetch(`${MOCK}/__admin/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'ok' }),
  }).catch(() => null);

  // 4) 结算单：按当前月账期生成并确认
  const now = new Date();
  const periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const periodEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let settlement = null;
  try {
    settlement = await request('/api/settlements', {
      method: 'POST',
      token: adminToken,
      body: { agentId: 1, periodStart, periodEnd },
    });
    await request(`/api/settlements/${settlement.id}/confirm`, { method: 'POST', token: adminToken });
    console.log(`  结算单 #${settlement.id} ${settlement.settlementNo} 已创建并确认`);
  } catch (error) {
    console.log(`  跳过结算单创建：${error.message}`);
  }

  const results = [...agentResults, ...adminResults];
  const summarize = (list) =>
    list.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] ?? 0) + 1;
      return acc;
    }, {});
  console.log('\n演示数据完成：');
  console.log(`  成功任务 ${results.filter((task) => task.status === 'completed').length} 个，图片 ${results.reduce((sum, task) => sum + (task.imageCount ?? 0), 0)} 张`);
  console.log(`  状态分布 ${JSON.stringify(summarize([...results, failedResult]))}`);
  console.log(`  结算单 ${settlement ? settlement.settlementNo : '未创建'}`);
}

main().catch((error) => {
  console.error('[demo-data] 失败', error);
  process.exitCode = 1;
});
