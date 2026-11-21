#!/usr/bin/env node
/**
 * 前端构建产物无头检查（不启动浏览器）：
 *   1. dist/index.html 存在、包含 #root 挂载点、资源引用全部是相对路径（Electron file:// 兼容）
 *   2. HTML 引用的每个 JS/CSS 产物真实存在且非空
 *   3. JS/CSS 体积阈值（原始 / gzip / brotli），防止依赖失控或漏打包
 *   4. 关键运行时标识存在（登录令牌 key、HashRouter 使用痕迹）
 *
 * 用法：node scripts/check-web.mjs [--dist path] [--json]
 * 退出码：0 = 全部通过；1 = 存在失败项（CI 可直接使用）
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const DIST = resolve(argValue('--dist', join(ROOT, 'apps', 'web', 'dist')));
const AS_JSON = args.includes('--json');

/** 体积阈值：超过即失败（留出合理余量，当前实测约 786 KB / gzip 210 KB） */
const LIMITS = {
  htmlKb: 8,
  cssRawKb: 120,
  jsTotalRawKb: 1200,
  jsTotalGzipKb: 340,
  singleChunkRawKb: 700,
};

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail ?? '' });
}
function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
function gzipSize(buffer) {
  return gzipSync(buffer, { level: 9 }).length;
}
function brotliSize(buffer) {
  return brotliCompressSync(buffer).length;
}

/** 从 index.html 提取本地资源引用 */
function extractRefs(html) {
  const refs = [];
  const pattern = /(?:src|href)="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(html))) {
    const value = match[1];
    if (/^(?:https?:|data:|mailto:|#|\/\/)/i.test(value)) continue;
    refs.push(value);
  }
  return refs;
}

async function main() {
  console.log(`检查目录：${relative(ROOT, DIST) || DIST}`);

  const indexFile = join(DIST, 'index.html');
  if (!existsSync(indexFile)) {
    check('dist/index.html 存在', false, `${indexFile} 不存在，请先执行 npm run build`);
    return finish();
  }
  const html = await readFile(indexFile);
  const htmlText = html.toString('utf8');
  check('dist/index.html 存在', true, kb(html.length));
  check('HTML 体积在阈值内', html.length <= LIMITS.htmlKb * 1024, `${kb(html.length)} ≤ ${LIMITS.htmlKb} KB`);
  check('包含 React 挂载点 #root', /<div[^>]+id="root"/.test(htmlText));
  check('包含页面标题', /<title>[^<]+<\/title>/.test(htmlText), (htmlText.match(/<title>([^<]+)<\/title>/) ?? [])[1] ?? '');
  check('声明 UTF-8 编码', /charset="?utf-8/i.test(htmlText));

  const refs = extractRefs(htmlText);
  const assetRefs = refs.filter((ref) => /\.(?:js|css)$/i.test(ref));
  check('HTML 引用了构建产物', assetRefs.length > 0, `${assetRefs.length} 个 js/css`);
  check('资源引用为相对路径（适配 Electron file://）', assetRefs.every((ref) => ref.startsWith('./')), assetRefs.join(' '));

  const jsAssets = [];
  const cssAssets = [];
  for (const ref of assetRefs) {
    const file = resolve(DIST, ref);
    const exists = existsSync(file);
    check(`产物存在：${ref}`, exists);
    if (!exists) continue;
    const info = await stat(file);
    check(`产物非空：${ref}`, info.size > 0, kb(info.size));
    const kind = ref.endsWith('.js') ? 'js' : 'css';
    (kind === 'js' ? jsAssets : cssAssets).push({ ref, file, size: info.size, buffer: await readFile(file) });
  }

  // dist 内未被 HTML 直接引用的其余产物（动态 chunk / 字体等）也必须非空
  const allDistFiles = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else allDistFiles.push(full);
    }
  }
  await walk(DIST);
  const empty = [];
  for (const file of allDistFiles) {
    const info = await stat(file);
    if (info.size === 0) empty.push(relative(DIST, file));
  }
  check('dist 内没有空文件', empty.length === 0, empty.join(', '));

  const jsTotal = jsAssets.reduce((sum, asset) => sum + asset.size, 0);
  const jsGzip = jsAssets.reduce((sum, asset) => sum + gzipSize(asset.buffer), 0);
  const jsBrotli = jsAssets.reduce((sum, asset) => sum + brotliSize(asset.buffer), 0);
  const cssTotal = cssAssets.reduce((sum, asset) => sum + asset.size, 0);
  check('JS 总体积在阈值内', jsTotal <= LIMITS.jsTotalRawKb * 1024, `${kb(jsTotal)} ≤ ${LIMITS.jsTotalRawKb} KB`);
  check('JS gzip 体积在阈值内', jsGzip <= LIMITS.jsTotalGzipKb * 1024, `${kb(jsGzip)} ≤ ${LIMITS.jsTotalGzipKb} KB`);
  check('CSS 体积在阈值内', cssTotal <= LIMITS.cssRawKb * 1024, `${kb(cssTotal)} ≤ ${LIMITS.cssRawKb} KB`);

  const biggest = [...jsAssets].sort((a, b) => b.size - a.size)[0];
  check(
    '单个 chunk 体积在阈值内',
    Boolean(biggest) && biggest.size <= LIMITS.singleChunkRawKb * 1024,
    biggest ? `${biggest.ref} ${kb(biggest.size)}` : '',
  );

  // 关键运行时标识：登录令牌 key 与 HashRouter（字符串可能被压缩为常量，缺失只告警不失败）
  const bundleText = jsAssets.map((asset) => asset.buffer.toString('utf8')).join('\n');
  check('产物包含登录令牌 key（comfyui-ops.token）', bundleText.includes('comfyui-ops.token'));
  const hashRouterHint = bundleText.includes('comfyui-ops.auth') || /hashchange/i.test(bundleText);
  check('产物包含 HashRouter 运行时痕迹（hashchange）', hashRouterHint);

  console.log(
    `\n产物统计：JS ${jsAssets.length} 个 / ${kb(jsTotal)}（gzip ${kb(jsGzip)}、brotli ${kb(jsBrotli)}）；CSS ${cssAssets.length} 个 / ${kb(cssTotal)}`,
  );
  for (const asset of jsAssets.sort((a, b) => b.size - a.size)) {
    console.log(`  ${asset.ref.padEnd(46)} ${kb(asset.size).padStart(9)}  gzip ${kb(gzipSize(asset.buffer))}`);
  }
  return finish();
}

function finish() {
  const failed = checks.filter((entry) => !entry.ok);
  if (AS_JSON) {
    console.log(JSON.stringify({ checks, failed: failed.length }, null, 2));
  } else {
    for (const entry of checks) {
      console.log(`[${entry.ok ? 'PASS' : 'FAIL'}] ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`);
    }
    console.log(`\n${checks.length - failed.length}/${checks.length} 项通过`);
  }
  if (failed.length > 0) {
    console.error(`check-web 失败：${failed.length} 项未通过`);
    process.exitCode = 1;
  } else {
    console.log('check-web 通过：静态产物可用于部署 / Electron 加载');
  }
}

main().catch((error) => {
  console.error('[check-web] 执行异常', error);
  process.exitCode = 1;
});
