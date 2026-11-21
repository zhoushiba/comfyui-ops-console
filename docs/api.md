# 接口文档（API）

## 1. 通用约定

- Base URL：`http://127.0.0.1:3000/api`（开发期前端通过 Vite 代理 `/api`）。
- 认证：除 `POST /auth/login` 与 `GET /health` 外，全部接口需请求头：

  ```http
  Authorization: Bearer <token>
  ```

- 统一响应：

  ```json
  { "success": true, "data": { } }
  ```

  ```json
  {
    "success": false,
    "error": { "code": "VALIDATION_ERROR", "message": "参数校验失败", "details": [ ] }
  }
  ```

- 分页：`?page=1&pageSize=20`，`pageSize` 上限 100，默认 20；列表返回 `{ items, total, page, pageSize }`。
- 时间：ISO 8601 字符串；日期筛选使用 `YYYY-MM-DD`。
- 金额：接口返回「分」为单位的整数，前端格式化为元（两位小数）。

## 2. 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/login` | 邮箱 + 密码登录，返回 token 与用户信息 |
| GET | `/auth/me` | 当前用户 |
| POST | `/auth/logout` | 登出（前端清除本地 token） |

```bash
curl -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ops.local","password":"Admin@123456"}'
```

```json
{
  "success": true,
  "data": {
    "token": "eyJ...",
    "user": { "id": 1, "email": "admin@ops.local", "name": "平台管理员", "role": "admin", "agentId": null }
  }
}
```

## 3. 总览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/overview` | 运营看板聚合数据 |

返回字段：`generatedAt`、`today{tasks,images,gpuSeconds}`、`month{tasks,images,gpuSeconds,successRate}`、`statusCounts`、`duration{p50,p95,avg}`、`recentTasks[]`、`trend[]{date,tasks,images}`、`agents[]{agentId,agentName,tasks,images}`、`queue{concurrency,running,queued,completedSinceBoot,failedSinceBoot}`、`imageTotal`、`failureReasons[]{code,count}`。

```bash
curl http://127.0.0.1:3000/api/overview -H "Authorization: Bearer $TOKEN"
```

## 4. 模板

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/templates` | 可用出图模板（名称、模型、默认参数、节点预览） |

## 5. 任务

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/tasks` | 创建出图任务（支持幂等） |
| GET | `/tasks` | 任务列表，筛选：`status/keyword/from/to/userId/agentId` + 分页 |
| GET | `/tasks/:id` | 任务详情（含图片与尝试记录） |
| POST | `/tasks/:id/retry` | 重试失败/超时/不可达任务 |

创建请求：

```json
{
  "templateId": 1,
  "prompt": "云海之上的漂浮城市，清晨逆光，电影感广角",
  "negativePrompt": "低质量, 模糊",
  "seed": 42,
  "steps": 24,
  "cfg": 7.5,
  "width": 512,
  "height": 512,
  "batchSize": 1,
  "clientRequestId": "demo-20261121-0001"
}
```

字段约束：`prompt` 1–2000 字；`steps` 1–150；`cfg` 0–30；`width/height` 64–2048；`batchSize` 1–8；`clientRequestId` ≤ 80。

- 幂等：同一用户相同 `clientRequestId` 重复提交，返回已存在任务，不重复创建/计费。
- 返回任务 DTO（camelCase）：`id, taskNo, status, progress, promptPreview, imageCount, durationMs, attempts, errorCode, errorMessage, ...`。
- 任务号格式：`T` + `YYYYMMDD` + 6 位随机十六进制，例如 `T2026112116AD91`。

重试规则：仅 `failed / timeout / unreachable` 可重试，重试后状态回到 `queued`，重新走编排流程。

## 6. 图片

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/images` | 图库列表，筛选：`taskId`、`format` + 分页 |
| GET | `/images/:id` | 图片元数据 |
| GET | `/images/:id/file` | 原图（inline） |
| GET | `/images/:id/thumbnail` | 256px 缩略图 |
| GET | `/images/:id/download` | 原图下载（attachment） |
| POST | `/images/:id/convert` | 单图转码，返回派生图（201） |
| POST | `/images/batch-convert` | 批量转码，最多 50 张 |
| POST | `/images/bundle` | 批量下载清单，最多 100 张 |

转码请求：

```json
{ "format": "webp", "quality": 82 }
```

`format` 支持 `png / jpeg / webp`，`quality` 1–100（默认 82）。批量转码请求体为 `{ "ids": [1,2], "format": "jpeg", "quality": 80 }`。

图片 DTO 直接给出三个 URL：

```json
{
  "id": 1,
  "url": "/api/images/1/file",
  "thumbnailUrl": "/api/images/1/thumbnail",
  "downloadUrl": "/api/images/1/download"
}
```

> 这三个地址也需要 `Authorization` 头，前端通过 `fileUrl()` 拼接 token 使用。

## 7. 用量

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/usage/stats` | 用量统计：总量、成功率/失败率、P50/P95/平均耗时、按日趋势、按代理商/用户聚合 |
| GET | `/usage/records` | 用量明细分页 |
| GET | `/export/usage.csv` | 用量 CSV 流式导出 |

筛选参数（`stats` / `records` / 导出共用）：`from`、`to`（默认本月 1 日至今天）、`agentId`、`userId`、`status`、`modelName`。

`stats` 返回：

```json
{
  "totals": { "tasks": 11, "images": 10, "gpuSeconds": 38, "succeeded": 10, "failed": 1, "billableTasks": 10 },
  "successRate": 0.9091,
  "failureRate": 0.0909,
  "p50DurationMs": 4849,
  "p95DurationMs": 5824.5,
  "avgDurationMs": 4644,
  "avgGpuSeconds": 3.45,
  "trend": [ { "date": "2026-11-21", "tasks": 10, "images": 9 } ],
  "byAgent": [ { "agentId": 1, "agentName": "星野视觉工作室", "tasks": 6, "images": 6 } ],
  "byUser": [ ]
}
```

## 8. CSV 导出

### 8.1 用量 CSV `GET /export/usage.csv`

- 响应头：

  ```http
  Content-Type: text/csv; charset=utf-8
  Content-Disposition: attachment; filename="usage-20261121-234812.csv"
  X-Export-Filename: usage-20261121-234812.csv
  ```

- 文件内容：UTF-8 BOM（`EF BB BF`）+ `\r\n` 行尾 + 中文表头。
- 列（10 列）：`任务编号, 用户名, 代理商, 模型, 状态, 图片数, 耗时(毫秒), GPU秒, 是否计费, 发生日期`。
- 转义：字段包含 `"`、`,`、`\r`、`\n` 时整体加双引号，内部 `"` 翻倍。
- 实现：`fetchPage(offset, limit)` 分页 500 条拉取，`PassThrough` 流式写出，避免大表全量进内存（上限 10 万行）。
- 导出行为写入审计日志：`action=export.usage`，包含筛选条件、行数、分页数、IP。

### 8.2 结算 CSV `GET /export/settlements.csv`

- 列（11 列）：`结算单号, 代理商, 账期开始, 账期结束, 状态, 任务数, 图片数, 流水(元), 平台分成(元), 代理商应结(元), 创建时间`。
- 同样带 BOM 与流式输出；审计 `action=export.settlement`。
- 支持筛选：`agentId`、`status`、`from`、`to`。

### 8.3 验证 BOM

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3000/api/export/usage.csv?from=2026-11-01&to=2026-11-30" \
  -o usage.csv
# 前 3 字节应为 efbbbf
xxd -l 3 usage.csv
```

## 9. 代理商与结算

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/agents` | 代理商列表（含本月任务/图片数） |
| GET | `/agents/:id` | 代理商详情（用户、定价规则） |
| GET | `/agents/:id/settlement-preview?from=&to=` | 结算预览（阶梯明细 + 金额） |
| GET | `/settlements` | 结算单列表（`agentId`、`status` + 分页） |
| POST | `/settlements` | 创建结算单（201） |
| GET | `/settlements/:id` | 结算单详情（含阶梯明细） |
| POST | `/settlements/:id/confirm` | 确认结算单 |
| POST | `/settlements/:id/pay` | 标记已打款 |

创建请求：

```json
{ "agentId": 1, "periodStart": "2026-11-01", "periodEnd": "2026-11-21" }
```

- 结算单号：`S<agentId>-<YYYYMMDD>-<YYYYMMDD>`，例如 `S1-20261101-20261121`。
- 状态流转：`pending → confirmed → paid`，不允许回退；重复状态变更幂等。
- 错误：同账期重复创建返回 `409 SETTLEMENT_EXISTS`；账期内无可用用量返回 `409 NOTHING_TO_SETTLE`。

## 10. 设置与系统

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/settings` | 当前运行时设置、存储目录、DB 客户端、版本 |
| PUT | `/settings` | 修改设置（仅 admin），立即生效并落库 |
| POST | `/settings/test` | 测试 ComfyUI 连接（返回版本、延迟、GPU 设备） |
| GET | `/system/status` | DB / ComfyUI / 编排器 / 队列 / 运行时长 |
| GET | `/system/audit-logs?limit=` | 审计日志（默认 50，上限 200） |
| GET | `/system/summary` | 任务/图片/代理商总量与最近任务 |
| GET | `/health` | 健康检查（无需认证） |

`PUT /settings` 可改字段：`comfyuiBaseUrl`、`comfyuiRequestTimeoutMs`、`comfyuiPollIntervalMs`、`comfyuiJobTimeoutMs`、`orchestratorConcurrency`（1–8）、`thumbnailSize`（64–512）。

## 11. 错误码

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | zod 参数校验失败（`details` 含字段路径） |
| 400 | `INVALID_ID` | ID 非正整数 |
| 401 | `UNAUTHORIZED` | 未登录、token 过期或签名错误 |
| 403 | `FORBIDDEN` | 角色权限不足 |
| 404 | `NOT_FOUND` | 任务/图片/结算单不存在 |
| 409 | `CONFLICT` | 通用冲突 |
| 409 | `SETTLEMENT_EXISTS` | 同代理商同账期结算单已存在 |
| 409 | `NOTHING_TO_SETTLE` | 账期内无成功计费用量 |
| 409 | `TASK_NOT_RETRYABLE` | 任务状态不允许重试 |
| 422 | `UNPROCESSABLE` | 业务上无法处理 |
| 500 | `INTERNAL_ERROR` | 未捕获异常（响应不暴露堆栈） |

任务侧错误码（写入 `generation_task.error_code`）：`COMFYUI_TIMEOUT`、`COMFYUI_UNREACHABLE`、`COMFYUI_HTTP_ERROR`、`COMFYUI_INVALID_RESPONSE`、`IMAGE_INVALID` 等。

## 12. 完整接口清单（36 个）

```text
GET    /api/health
POST   /api/auth/login
GET    /api/auth/me
POST   /api/auth/logout
GET    /api/overview
GET    /api/templates
POST   /api/tasks
GET    /api/tasks
GET    /api/tasks/:id
POST   /api/tasks/:id/retry
GET    /api/images
POST   /api/images/batch-convert
POST   /api/images/bundle
GET    /api/images/:id
GET    /api/images/:id/file
GET    /api/images/:id/thumbnail
GET    /api/images/:id/download
POST   /api/images/:id/convert
GET    /api/usage/stats
GET    /api/usage/records
GET    /api/export/usage.csv
GET    /api/export/settlements.csv
GET    /api/agents
GET    /api/agents/:id
GET    /api/agents/:id/settlement-preview
GET    /api/settlements
POST   /api/settlements
GET    /api/settlements/:id
POST   /api/settlements/:id/confirm
POST   /api/settlements/:id/pay
GET    /api/settings
PUT    /api/settings
POST   /api/settings/test
GET    /api/system/status
GET    /api/system/audit-logs
GET    /api/system/summary
```
