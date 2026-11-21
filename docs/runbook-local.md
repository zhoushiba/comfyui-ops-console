# 本地运行手册（Runbook）

本手册以 Windows 10/11 + PowerShell 为主，macOS/Linux 仅命令替换差异。目标：从零到「运营后台可登录、能出图、能导 CSV、能截图」。

## 1. 前置条件

| 依赖 | 版本 | 检查命令 |
| --- | --- | --- |
| Node.js | ≥ 22（实测 v24.20.0） | `node -v` |
| npm | 11.x（或 pnpm 10+） | `npm -v` |
| Edge / Chrome | 任意较新版本（截图与 E2E 可选） | — |
| Docker | 可选，仅容器化演示 | `docker --version` |

> Windows 下若终端找不到 node/npm，先执行：
>
> ```powershell
> $env:Path = "D:\Apps\Develop\Environment\Node;" + $env:Path
> ```
>
> 且必须使用 `npm.cmd` / `pnpm.cmd`（带 `.cmd`）。

## 2. 安装依赖

```powershell
cd C:\path\to\comfyui-ops-console
npm.cmd install
```

- 仓库若已带 `node_modules` 可跳过。
- `better-sqlite3`、`sharp` 为原生模块，安装时会拉取预编译包；失败时见 §8。
- 不需要 Docker、MySQL、GPU。

## 3. 初始化数据库

```powershell
npm.cmd run db:setup   # 建表（幂等）
npm.cmd run db:seed    # 写入账号、模板、定价规则、系统配置（幂等）
```

- 默认 SQLite 文件：`apps/server/data/app.db`。
- 种子账号见 README「默认账号」。
- 重复执行不会覆盖已有业务数据。

## 4. 启动服务

### 4.1 一键启动（推荐）

```powershell
npm.cmd run dev
```

包含：

| 服务 | 地址 | 日志 |
| --- | --- | --- |
| ComfyUI mock | http://127.0.0.1:8188 | 终端 `mock` 前缀 |
| API | http://127.0.0.1:3000 | 终端 `server` 前缀 |
| Web | http://127.0.0.1:5173 | 终端 `web` 前缀 |

访问 <http://127.0.0.1:5173>，用 `admin@ops.local / Admin@123456` 登录。

### 4.2 分开启动

```powershell
npm.cmd run dev:mock      # mock
npm.cmd run dev:server    # API
npm.cmd run dev:web       # 前端
```

> Vite 7+ 默认可能只监听 IPv6（`[::1]:5173`）。如果 `http://127.0.0.1:5173` 打不开：
>
> ```powershell
> npm.cmd run dev:web -- --host 127.0.0.1
> ```
>
> 或直接访问 `http://localhost:5173`。

### 4.3 健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
Invoke-RestMethod http://127.0.0.1:8188/system_stats
(Invoke-WebRequest http://127.0.0.1:5173/ -UseBasicParsing).StatusCode
```

预期：API 返回 `{ success: true, data: { status: "ok" } }`，mock 返回 `comfyui_version`，Web 返回 200。

## 5. 走通一次真实出图

1. 浏览器登录，进入「出图」。
2. 选择模板「SDXL 基础出图」，填提示词（如「云海之上的漂浮城市，电影感广角」），提交。
3. 进入「任务」页，观察状态：`queued → submitted → running → polling → downloading → completed`（前端每 2 秒刷新）。
4. 完成后进入「图库」，应看到真实 PNG 缩略图，可预览、下载、转码。
5. 在「用量」页点击「导出用量 CSV」，浏览器下载 `usage-YYYYMMDD-HHmmss.csv`。
6. 在「代理商」页点击「导出结算 CSV」。

也可用脚本一键生成演示数据（9 个成功任务 + 1 个失败任务 + 1 张结算单）：

```powershell
node scripts/demo-data.mjs
```

## 6. Mock 故障注入

Mock 提供管理接口，模拟真实故障场景：

```powershell
# 正常
Invoke-RestMethod -Method Post http://127.0.0.1:8188/__admin/mode -ContentType "application/json" -Body '{"mode":"ok"}'

# 慢响应：默认延迟 5s（小于默认请求超时 10s，任务会"慢但成功"）
# 要验证超时，重启 mock 时把 MOCK_SLOW_MS 调到大于 COMFYUI_REQUEST_TIMEOUT_MS（如 15000）
Invoke-RestMethod -Method Post http://127.0.0.1:8188/__admin/mode -ContentType "application/json" -Body '{"mode":"slow"}'

# 提交返回 500（任务重试 3 次后 failed，错误码 COMFYUI_HTTP_ERROR）
Invoke-RestMethod -Method Post http://127.0.0.1:8188/__admin/mode -ContentType "application/json" -Body '{"mode":"fail"}'

# 返回截断 PNG（图片校验失败，任务 failed）
Invoke-RestMethod -Method Post http://127.0.0.1:8188/__admin/mode -ContentType "application/json" -Body '{"mode":"partial"}'

# 模拟服务未启动（关闭监听 → 提交变 unreachable）
Invoke-RestMethod -Method Post http://127.0.0.1:8188/__admin/mode -ContentType "application/json" -Body '{"mode":"dead"}'

# 恢复
Invoke-RestMethod -Method Post http://127.0.0.1:8188/__admin/mode -ContentType "application/json" -Body '{"mode":"ok"}'
```

查看更多 mock 状态：`Invoke-RestMethod http://127.0.0.1:8188/__admin/state`。

预期结果：

| 模式 | 任务最终状态 | 错误码 |
| --- | --- | --- |
| `fail` | `failed`（attempts=4） | `COMFYUI_HTTP_ERROR` |
| `slow` 且延迟 > 请求超时 | `timeout` | `COMFYUI_TIMEOUT` |
| `dead` | `unreachable` | `COMFYUI_UNREACHABLE` |
| `partial` | `failed` | `IMAGE_INVALID` / `COMFYUI_INVALID_RESPONSE` |

## 7. 测试、构建与验收

```powershell
npm.cmd test              # 服务端 vitest（46 用例）
npm.cmd run build         # mock + server + web 构建
npm.cmd run check:web     # 检查 dist 产物（26 项，退出码 0 为通过）
npm.cmd run smoke         # E2E 冒烟（需 server + mock 已启动）
```

单独跑某个测试文件：

```powershell
cd apps/server
npx.cmd vitest run test/csv.test.ts
```

### 7.1 E2E 冒烟

```powershell
node scripts/e2e-smoke.mjs --base http://127.0.0.1:3000 --mock http://127.0.0.1:8188
```

覆盖：健康检查 → mock 版本 → 管理员登录 → 模板 → 创建任务 → 幂等 → 轮询完成 → 图片校验（PNG 字节数）→ 缩略图 → 总览。失败时退出码为 1。

### 7.2 重建截图

```powershell
# 需 web(5173)、server(3000)、mock(8188) 均在运行，且已有演示数据
node scripts/demo-data.mjs
node scripts/capture-screenshots.mjs
```

脚本用 Edge headless + CDP 登录并截取 6 张页面图到 `docs/screenshots/`。若 Edge 路径不同，改脚本顶部的 `EDGE_PATH`。

## 8. 常见问题

### 8.1 `better-sqlite3` 安装失败
- 确认 Node 为 64 位 22+；删除 `node_modules` 后重试。
- 公司网络无法下载预编译包时，需安装 Python/VS Build Tools 从源码编译。

### 8.2 `sharp` 报 `Could not load the sharp module`
- 常见于跨平台拷贝 `node_modules`（Windows 与 Linux 二进制不同）。
- 在目标平台重新 `npm install sharp`。

### 8.3 端口被占用
```powershell
netstat -ano | findstr ":3000"
taskkill /PID <pid> /F
```
端口：3000 API、5173 Web、8188 Mock。

### 8.4 登录 401 / 一直跳登录页
- 确认 server 已启动、Vite 代理 `/api` 正常：访问 `http://127.0.0.1:5173/api/health`。
- 清除浏览器 `localStorage` 中的 `comfyui-ops.token` 与 `comfyui-ops.auth` 后重登。

### 8.5 任务一直 `queued`
- 检查 `GET /api/system/status` 的 `orchestrator` 与 `comfyui.reachable`。
- 若 mock 处于 `dead` 模式，先切回 `ok`。
- 服务重启后中断任务会被标记失败，`queued` 任务会重新入队。

### 8.6 CSV 打开乱码
- 文件必须带 UTF-8 BOM（前 3 字节 `EF BB BF`），Excel 才能正确识别中文。
- 用 PowerShell 检查：
  ```powershell
  Format-Hex usage-*.csv -Count 3
  ```

### 8.7 截图空白
- 确认 web 已在运行且 `docs/screenshots` 可写。
- HashRouter 下必须整页导航（脚本已处理），只改 hash 不会刷新登录态。
- 截图前先跑 `scripts/demo-data.mjs`，否则列表页为空。

### 8.8 重置演示环境
```powershell
# 停服务后删除数据与图片，再重新初始化
Remove-Item apps/server/data/app.db -Force
Remove-Item apps/server/storage/* -Recurse -Force
npm.cmd run db:setup
npm.cmd run db:seed
```

## 9. 关键文件位置

| 内容 | 路径 |
| --- | --- |
| SQLite 数据库 | `apps/server/data/app.db` |
| 图片存储 | `apps/server/storage/` |
| 服务端日志 | 终端输出（`LOG_LEVEL` 控制） |
| 环境变量模板 | `.env.example` |
| 演示数据脚本 | `scripts/demo-data.mjs` |
| 截图脚本 | `scripts/capture-screenshots.mjs` |
| E2E 脚本 | `scripts/e2e-smoke.mjs` |
| 产物检查 | `scripts/check-web.mjs` |
