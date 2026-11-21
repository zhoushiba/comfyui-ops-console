# 兼容性评估报告（Compatibility Assessment）

评估对象：**ComfyUI 运营管理控制台 v1.0** 与 **ComfyUI HTTP API（0.3.x）** 的兼容性，以及本系统在目标运行环境（Windows + Node 22+、无 GPU）下的可运行性。

评估日期：2026-11-21
评估方式：契约对照 + 内置 mock + 自动化测试 + 真实链路冒烟（未连接真实 GPU 实例）
结论先行：**核心链路兼容，可在 mock/真实 ComfyUI 间无代码切换；对真实实例仍存在 3 项需联调确认的差异（进度、节点校验、输出结构变体），风险可控。**

## 1. 评估范围与方法

| 维度 | 方法 | 证据 |
| --- | --- | --- |
| HTTP 接口契约 | 对照 ComfyUI 官方 API 文档与源码行为 | `comfyuiClient.ts`、`services/comfyui-mock/src/server.ts`、`graph.ts` |
| 数据格式 | mock 返回与真实结构同构的 JSON | `services/comfyui-mock/src/*` |
| 错误语义 | 注入 4 类错误并断言状态机结果 | `apps/server/test/comfyuiClient.test.ts`（7 用例）、`poller.test.ts`（6 用例） |
| 图片格式 | 真实 PNG 生成、魔数校验、sharp 转码 | `apps/server/test/image.test.ts`（7 用例） |
| 端到端 | 真实 HTTP 调 mock 出图 | `scripts/e2e-smoke.mjs` 实跑通过；`scripts/demo-data.mjs` 生成 9 成功 + 1 失败 |
| 运行环境 | Windows 11 + Node v24.20.0（无 Docker/GPU） | 构建、测试、截图实测 |

未覆盖：真实 GPU 推理时延、真实 ComfyUI 自定义节点、WebSocket 实时进度、多实例调度。

## 2. 接口兼容矩阵

| 接口 | 使用方式 | Mock | 真实 ComfyUI 0.3.x | 兼容性 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `POST /prompt` | 提交节点图 | 实现 | 原生 | ✅ 高 | 请求体 `{prompt, client_id}`；400 时 `node_errors` 结构一致 |
| `GET /history/{id}` | 轮询结果 | 实现 | 原生 | ✅ 高 | 未完成返回 `{}`；完成后 `outputs[*].images[]` |
| `GET /view` | 下载图片 | 实现 | 原生 | ✅ 高 | 参数 `filename/subfolder/type` 一致 |
| `GET /queue` | 队列状态 | 实现 | 原生 | ✅ 高 | 仅展示，字段宽松读取 |
| `GET /system_stats` | 版本/设备 | 实现 | 原生 | ✅ 高 | 版本字段为 mock 标记 `0.3.68-mock` |
| `GET /object_info` | 节点定义 | 5 个节点 | 全量节点 | ⚠️ 中 | mock 只覆盖默认工作流所需；真实实例返回全量，当前不阻塞 |
| `WS /ws` | 实时进度 | 未实现 | 原生 | ⚠️ 未使用 | 本系统用轮询替代，兼容但非最优 |
| `POST /interrupt`、`/queue` 管理 | 取消任务 | 未实现 | 原生 | ⚠️ 未使用 | 当前无取消功能，roadmap 已列 |

### 2.1 请求/响应字段兼容

| 字段 | 本系统依赖 | 真实行为 | 风险 |
| --- | --- | --- | --- |
| `prompt_id` | 字符串、非空 | 返回 UUID | 低 |
| `number` | 数字（可缺省） | 队列序号 | 低，缺失时按 0 |
| `node_errors` | 对象/可缺省 | 400 时返回 | 低 |
| `history[prompt_id].status.completed` | 布尔 | 完成时 true | 低 |
| `history[prompt_id].status.status_str` | 字符串 | `success` / `error` | 低 |
| `outputs[nodeId].images[]` | 数组 | 每个输出节点各自返回 | 中：已做多节点摊平 |
| `images[].filename/subfolder/type` | 字符串 | 均存在 | 低 |
| `/view` 的 `Content-Type` | 不信任 | 通常 image/png | 低：以魔数为准 |

## 3. 版本兼容性

| ComfyUI 版本 | 评估 | 说明 |
| --- | --- | --- |
| 0.3.x（mock 模拟基线） | ✅ 兼容 | 接口与结构按该版本实现 |
| 0.2.x | ⚠️ 基本兼容 | `/history` 与 `/prompt` 结构一致；`system_stats` 字段可能较少，已容错 |
| 0.1.x | ⚠️ 未验证 | 旧版 `queue`/`history` 字段可能有差异 |
| 未来版本 | ⚠️ 需回归 | 建议以契约测试 + mock 升级作为回归门槛 |

系统不依赖 ComfyUI 的具体补丁版本，只依赖上述 6 个 HTTP 接口；版本字符串仅用于展示与诊断（`/api/system/status`）。

## 4. 差异与风险

| # | 差异/风险 | 影响 | 等级 | 缓解措施 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | 未接 WebSocket，进度靠轮询 | 进度非精确节点级；轮询有少量开销 | 中 | 前端展示 15%→90% 估算进度；轮询间隔可配；后续接 `/ws` | 已接受，roadmap |
| 2 | 真实 `outputs` 可能多节点/多图 | 图片数量与命名需适配 | 中 | `collectImages()` 摊平所有节点；按序号命名 | 已处理 |
| 3 | 真实 `node_errors` 内容更丰富 | 错误详情展示有限 | 低 | 原文截断 4000 字存入 `error_detail`；前端展示摘要 | 已处理 |
| 4 | 自定义节点/模型名不一致 | 提交 400 | 中 | 模板 `graph_json` 可替换；错误体保留，便于定位 | 联调确认 |
| 5 | 真实实例耗时长 | 默认 60s 任务超时可能偏短 | 中 | `JOB_TIMEOUT_MS` 可配；建议生产调大 | 配置项 |
| 6 | 真实 ComfyUI 可能置于鉴权网关后 | 401/403 被归为 `http` 不可重试 | 低 | 网关放行内网或加代理头；错误详情可见 | 部署约定 |
| 7 | mock 生图速度与真实差异大 | 性能/并发结论不可直接外推 | 中 | 压测需真实实例；当前数据标注为 mock 指标 | 已说明 |
| 8 | 真实图片可能为 JPEG/WebP | 格式判断 | 低 | 魔数识别 PNG/JPEG/WebP；统一转码 | 已处理 |

### 4.1 兼容性分级

- **强兼容（无需改动）**：提交、历史查询、图片下载、错误分类、重试与状态机、CSV/结算等业务逻辑。
- **条件兼容（配置/模板适配）**：节点图与模型名、任务超时、并发、对象存储路径。
- **待增强（不影响 v1.0 验收）**：WebSocket 进度、任务取消、多实例调度、`object_info` 动态表单。

## 5. 运行环境兼容性

| 项 | 要求 | 实测 | 结论 |
| --- | --- | --- | --- |
| 操作系统 | Windows 10/11、Linux、macOS | Windows 11 | ✅ |
| Node.js | ≥ 22 | v24.20.0 | ✅ |
| 包管理器 | npm 11 / pnpm 10+ | npm 11.19.0 / pnpm 12.18.0（packageManager） | ✅ |
| 数据库 | SQLite 默认；MySQL 8 / PG 可选 | SQLite 实测；MySQL DDL 交付未连库 | ✅ / ⚠️ 未实测 |
| 原生依赖 | better-sqlite3、sharp | 预编译包安装成功 | ✅ |
| 浏览器 | 现代 Chromium/Firefox/Safari | Edge 157 headless 截图 | ✅ |
| Docker | 可选 | 本机未安装，未运行 | ⚠️ 交付文件未实测 |
| GPU | 非必需（mock） | 无 GPU | ✅ |
| 端口 | 3000 / 5173 / 8188 | 实测可用 | ✅ |

### 5.1 前端构建兼容

- Vite 8（Rolldown）+ React 19 + TypeScript 5.9，`tsc --noEmit` 通过。
- 构建产物使用相对路径 `./assets/`，HashRouter，兼容 Electron `file://`。
- `manualChunks` 采用函数形式（Vite 8 已不支持对象形式）。
- 产物检查 26 项通过：JS 总量 767.9KB / gzip 221.8KB，CSS 22.4KB，无空文件。

## 6. 验证证据

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| 服务端单测 | `npm test` | 6 个文件 / **46 用例全部通过**（csv 7、comfyuiClient 7、image 7、settlement 9、poller 6、api 10） |
| 构建 | `npm run build` | mock/server tsc 通过，web 487 modules 构建成功 |
| 产物检查 | `npm run check:web` | **26/26 通过，退出码 0** |
| E2E 冒烟 | `node scripts/e2e-smoke.mjs` | 健康检查 → 登录 → 建任务 → 轮询完成 → 图片/缩略图 → 总览，全通过 |
| 真实出图 | `node scripts/demo-data.mjs` | 9 个 completed、10 张真实 PNG、1 个 failed（attempts=4） |
| 真实界面 | `node scripts/capture-screenshots.mjs` | 6 张 1440×1400 截图，非空白 |
| 服务未启动 | mock 切 `dead` 后提交 | 任务 `unreachable`、`COMFYUI_UNREACHABLE` |
| 请求超时 | mock 切 `slow` 且 `MOCK_SLOW_MS` > 请求超时 | 任务 `timeout`、`COMFYUI_TIMEOUT` |
| 节点错误 | mock `fail` | 任务 `failed`、`COMFYUI_HTTP_ERROR`，重试 3 次后终态 |

## 7. 结论与建议

1. **可以交付**：核心接入链路与真实 ComfyUI 的 HTTP 契约一致，替换地址与模板即可对接真实实例。
2. **联调前必做**：确认真实工作流的节点 id、模型文件名、任务耗时上限；用设置页「测试连接」验证 `/system_stats`。
3. **建议增强**：接入 WebSocket 获取真实进度；增加任务取消；将 `object_info` 用于动态表单；生产环境切 MySQL/PG 并引入外部队列。
4. **残余风险**：真实 GPU 时延、并发与图片体积未在大规模数据下验证；mock 指标不能代表生产性能。该风险已在 README 与 roadmap 中披露。
