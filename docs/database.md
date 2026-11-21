# 数据库设计（Database）

## 1. 选型与策略

| 项 | 选择 | 说明 |
| --- | --- | --- |
| 默认数据库 | SQLite（`better-sqlite3`） | 零安装、单文件，作品集演示与本地测试开箱即用 |
| 可选数据库 | MySQL 8 / PostgreSQL | 通过 `DB_CLIENT` + `DATABASE_URL` 切换，Knex 生成同一份表定义 |
| MySQL 交付物 | `db/schema.mysql.sql` | 与运行时 schema 一致的完整 DDL，供生产建库/评审 |
| 时间字段 | `VARCHAR(32)` ISO 字符串 | 避免不同数据库时区差异；`occurred_at` 固定为 `YYYY-MM-DD` |
| 金额字段 | 整数「分」 | 全程整数运算，杜绝浮点误差 |
| 外键 | 不建外键 | 应用层维护，便于分库/迁移；以索引 + 服务层校验保证一致性 |

初始化：

```bash
npm run db:setup   # 建表（幂等）
npm run db:seed    # 写入演示账号、模板、价格规则、系统配置（幂等）
```

## 2. ER 关系

```mermaid
erDiagram
  AGENT ||--o{ USER : "agent_id"
  AGENT ||--o{ AGENT_USER : "agent_id"
  USER ||--o| AGENT_USER : "user_id"
  USER ||--o{ GENERATION_TASK : "发起"
  AGENT ||--o{ GENERATION_TASK : "归属"
  PROMPT_TEMPLATE ||--o{ GENERATION_TASK : "使用"
  GENERATION_TASK ||--o{ TASK_ATTEMPT : "尝试"
  GENERATION_TASK ||--o{ IMAGE_ASSET : "产出"
  GENERATION_TASK ||--o| USAGE_RECORD : "计费"
  AGENT ||--o{ PRICING_RULE : "定价"
  AGENT ||--o{ SETTLEMENT : "结算"
  SETTLEMENT ||--o{ SETTLEMENT_ITEM : "明细"
  USAGE_RECORD ||--o| SETTLEMENT_ITEM : "计入"
  USER ||--o{ AUDIT_LOG : "操作"
```

## 3. 表清单（13 张）

| # | 表 | 用途 | 关键约束 |
| --- | --- | --- | --- |
| 1 | `agent` | 代理商 | `code` 唯一 |
| 2 | `user` | 用户（admin/agent/operator/user） | `email` 唯一，`agent_id` 索引 |
| 3 | `agent_user` | 代理商与用户关系 | `user_id` 唯一 |
| 4 | `prompt_template` | 出图模板（含 graph JSON 与默认参数） | `is_active` |
| 5 | `generation_task` | 出图任务主表 | `task_no` 唯一；`UNIQUE(user_id, client_request_id)` 幂等 |
| 6 | `task_attempt` | 每次提交/轮询尝试记录 | `task_id` 索引 |
| 7 | `image_asset` | 图片资产（原图/缩略图/转码派生图） | `task_id`、`source_image_id` 索引 |
| 8 | `usage_record` | 用量与计费记录 | `task_id` 唯一（一任务一条，保证不重复计费） |
| 9 | `pricing_rule` | 代理商阶梯定价与分成 | `agent_id` 索引 |
| 10 | `settlement` | 结算单 | `settlement_no` 唯一 |
| 11 | `settlement_item` | 结算阶梯明细 | `settlement_id` 索引 |
| 12 | `audit_log` | 审计日志 | `action`、`actor_id` 索引 |
| 13 | `system_config` | 运行时配置键值 | `key` 主键 |

## 4. 核心表字段

### 4.1 `generation_task`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | PK | 自增 |
| `task_no` | varchar(40) | 业务任务号，`T` + 年月日 + 6 位随机，唯一 |
| `user_id` / `agent_id` / `template_id` | int | 发起人、归属代理商、模板 |
| `client_request_id` | varchar(80) | 客户端幂等键 |
| `status` | varchar(24) | `queued/submitted/running/polling/downloading/completed/failed/timeout/unreachable` |
| `prompt_text` / `negative_prompt` | varchar(1000) | 提示词 |
| `params_json` | text | 尺寸、步数、CFG、种子、批量等 |
| `graph_json` | text | 提交给 ComfyUI 的节点图（对外 DTO 不返回） |
| `comfyui_prompt_id` | varchar(64) | ComfyUI 返回的 prompt_id |
| `progress` | int | 0–100 |
| `error_code` / `error_message` / `error_detail` | — | 失败分类与详情 |
| `attempts` | int | 已尝试次数（含首次） |
| `submitted_at/started_at/finished_at` | varchar(32) | 时间线 |
| `duration_ms` / `image_count` / `gpu_seconds` | int | 耗时、图片数、GPU 估算秒数 |
| `created_at` | varchar(32) | 创建时间 |

### 4.2 `usage_record`

| 字段 | 说明 |
| --- | --- |
| `task_id` | 唯一，任务终态时写入，天然幂等 |
| `user_id` / `agent_id` | 计费归属 |
| `model_name` / `status` | 模型与任务终态 |
| `image_count` / `duration_ms` / `gpu_seconds` | 计量 |
| `billable` | 是否计费（当前成功任务为真） |
| `occurred_at` | 日期键 `YYYY-MM-DD`，按天聚合与筛选 |

### 4.3 `settlement` / `settlement_item`

- `settlement` 保存账期、状态（`pending → confirmed → paid`）、任务数、图片数、流水、平台分成、代理商应结（均为分）。
- `settlement_item` 保存按阶梯拆分后的明细：描述、图片数、单价、金额，并可选关联 `usage_record_id`。
- 阶梯跨档时会把同一条用量拆成两条明细，保证「明细金额合计 = 结算总额」。

### 4.4 `audit_log`

记录 `actor_id / action / target_type / target_id / detail_json / ip / created_at`。当前写入：登录、CSV 导出（`export.usage`、`export.settlement`）、结算创建/确认/打款、设置修改。

## 5. 结算公式

计价模型（`settlementCalculator.ts`）：

```text
前 tierThreshold 张：单价 basePriceCents
超出部分：       单价 tier2PriceCents
grossCents      = Σ 各阶梯金额
agentAmountCents = round(grossCents × shareRatio)
platformFeeCents = grossCents − agentAmountCents
```

默认规则：`basePriceCents=120`、`tierThreshold=1000`、`tier2PriceCents=100`、`shareRatio=0.7`。

示例：

| 图片数 | 流水 | 代理商应结 | 平台分成 |
| --- | --- | --- | --- |
| 6 张（演示数据） | 6 × 120 = 720 分 = ¥7.20 | 504 分 = ¥5.04 | 216 分 = ¥2.16 |
| 1200 张 | 1000×120 + 200×100 = 140000 分 = ¥1400 | 98000 分 = ¥980 | 42000 分 = ¥420 |

口径说明：

- 只统计「成功且计费」的 `usage_record`（`status='completed' AND billable=1`），按 `id` 升序累计，保证阶梯顺序稳定。
- 同一代理商同一账期只允许一张结算单；重复创建返回 `SETTLEMENT_EXISTS`。
- 金额全部以分存储，前端统一用 `formatCents` 展示为两位小数。

## 6. 索引与查询

- 任务列表：`idx_task_created(created_at)`、`status`、`user_id`、`agent_id`。
- 用量导出：`occurred_at` 索引 + `usage_record.task_id` 唯一键。
- 结算预览：`agent_id + occurred_at` 组合过滤。
- 图片按 `task_id`、`agent_id`、`source_image_id` 索引。
- 审计按 `action`、`actor_id` 索引。

## 7. 切换 MySQL / PostgreSQL

```bash
# MySQL
DB_CLIENT=mysql DATABASE_URL="mysql://user:pass@127.0.0.1:3306/comfyui_ops" npm run db:setup

# PostgreSQL
DB_CLIENT=pg DATABASE_URL="postgres://user:pass@127.0.0.1:5432/comfyui_ops" npm run db:setup
```

- `db/schema.mysql.sql` 可用于 MySQL 人工建库（含 `CREATE DATABASE`、`utf8mb4`、全部索引与注释）。
- 切库后需重新执行 `db:seed`；SQLite 数据不会自动迁移。
- 生产建议：MySQL 8 + 独立迁移流程（当前 `ensureSchema` 只做「不存在则建表」，不支持列变更）。

## 8. 数据保留与备份

- 默认数据文件：`apps/server/data/app.db`；图片目录：`apps/server/storage/`。
- 备份：停止写入后复制 `.db` 文件与 `storage/` 目录；或使用 SQLite `.backup`。
- `usage_record` 与 `settlement` 属财务数据，不建议物理删除；可在应用层做归档表。
- 演示环境可用 `npm run db:seed` 反复初始化（幂等，不覆盖已有业务数据）。
