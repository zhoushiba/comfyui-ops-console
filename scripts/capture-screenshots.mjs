#!/usr/bin/env node
/**
 * 真实界面截图：Edge headless + Chrome DevTools Protocol。
 *
 * 流程：启动 Edge（独立临时 profile）→ 打开登录页 → 调用真实登录接口 →
 * 把令牌写入 localStorage → 逐个 hash 路由截取整屏 PNG。
 * 不修改业务代码，也不使用占位图。
 *
 * 前置：mock(8188) + server(3000) + web dev(5173) 已启动，且已执行 demo-data.mjs。
 * 用法：node scripts/capture-screenshots.mjs [--web http://127.0.0.1:5173]
 *        [--out docs/screenshots] [--edge "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"]
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const WEB = argValue('--web', process.env.CAPTURE_WEB_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const OUT = resolve(ROOT, argValue('--out', 'docs/screenshots'));
const EDGE = argValue(
  '--edge',
  process.env.CAPTURE_EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
);
const CDP_PORT = Number(argValue('--port', '9333'));
const EMAIL = argValue('--email', 'admin@ops.local');
const PASSWORD = argValue('--password', 'Admin@123456');
const WIDTH = Number(argValue('--width', '1440'));
const HEIGHT = Number(argValue('--height', '1400'));

const CDP = `http://127.0.0.1:${CDP_PORT}`;
mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'comfyui-shots-'));

let edgeProcess;
let socket;

async function waitForCdp(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${CDP}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      // 还没起来
    }
    if (Date.now() > deadline) throw new Error('Edge CDP 启动超时');
    await sleep(300);
  }
}

function connect(wsUrl) {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => resolvePromise(ws));
    ws.addEventListener('error', (event) => reject(new Error(`CDP WebSocket 失败: ${event?.message ?? 'unknown'}`)));
  });
}

let messageId = 0;
const pending = new Map();
const listeners = new Map();

function send(method, params = {}) {
  const id = ++messageId;
  return new Promise((resolvePromise, reject) => {
    pending.set(id, { resolve: resolvePromise, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function waitEvent(name, timeoutMs = 15_000) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      listeners.delete(name);
      resolvePromise(null); // 事件可能已错过，交给后续轮询兜底
    }, timeoutMs);
    listeners.set(name, (params) => {
      clearTimeout(timer);
      listeners.delete(name);
      resolvePromise(params);
    });
  });
}

async function evaluate(expression, awaitPromise = true) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`页面脚本执行失败：${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ''}`);
  }
  return result.result.value;
}

async function waitReady(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await evaluate('document.readyState').catch(() => null);
    if (state === 'complete') return;
    if (Date.now() > deadline) throw new Error('页面加载超时');
    await sleep(250);
  }
}

async function goto(url) {
  await send('Page.navigate', { url });
  await sleep(300);
  await waitReady();
}

async function shoot(name) {
  await evaluate('window.scrollTo(0, 0)');
  await sleep(400);
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = join(OUT, name);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`  截图 ${name}（${(Buffer.from(data, 'base64').length / 1024).toFixed(0)} KB）`);
}

async function main() {
  console.log(`截图目标：web=${WEB} 输出=${OUT}`);
  edgeProcess = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,MediaRouter',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${CDP_PORT}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  await waitForCdp();
  const version = await fetch(`${CDP}/json/version`).then((r) => r.json());
  console.log(`  Edge ${version.Browser}`);

  const target = await fetch(`${CDP}/json/new?${encodeURIComponent(`${WEB}/login`)}`, { method: 'PUT' }).then((r) => r.json());
  socket = await connect(target.webSocketDebuggerUrl);
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    } else if (message.method && listeners.has(message.method)) {
      listeners.get(message.method)(message.params);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await goto(`${WEB}/login`);

  const login = await evaluate(`(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(PASSWORD)} }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(JSON.stringify(payload).slice(0, 300));
    const data = payload.data;
    localStorage.setItem('comfyui-ops.token', data.token);
    localStorage.setItem('comfyui-ops.auth', JSON.stringify({ state: { token: data.token, user: data.user }, version: 0 }));
    return { role: data.user.role, name: data.user.name };
  })()`);
  console.log(`  已登录：${login.name}（${login.role}）`);

  // 全量刷新让 zustand 从 localStorage 恢复会话
  await goto(`${WEB}/#/overview`);
  await sleep(2600);
  await shoot('01-overview.png');

  for (const [route, file, waitMs] of [
    ['/#/tasks', '02-tasks.png', 2400],
    ['/#/gallery', '03-gallery.png', 2800],
    ['/#/agents', '05-agent-settlement.png', 2200],
  ]) {
    await evaluate(`location.hash = '#/${route.split('#/')[1]}'; window.scrollTo(0, 0)`);
    await sleep(waitMs);
    await shoot(file);
  }

  // 用量页：先截图静态界面，再触发真实 CSV 导出，截取「导出完成」提示
  await evaluate("location.hash = '#/usage'; window.scrollTo(0, 0)");
  await sleep(2400);
  await shoot('04a-usage.png');
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').includes('导出用量 CSV'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('未找到「导出用量 CSV」按钮');
  await sleep(1800);
  await shoot('04-usage-csv-export.png');

  console.log('截图完成');
}

main()
  .catch((error) => {
    console.error('[capture] 失败', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      if (socket) socket.close();
    } catch {
      // 忽略
    }
    if (edgeProcess?.pid) {
      try {
        execFileSync('taskkill', ['/PID', String(edgeProcess.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        try {
          edgeProcess.kill();
        } catch {
          // 忽略
        }
      }
    }
    await sleep(500);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // 临时目录清理失败不影响截图结果
    }
  });
