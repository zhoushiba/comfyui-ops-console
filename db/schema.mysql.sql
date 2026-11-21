-- ============================================================================
-- ComfyUI 算力运营控制台 · MySQL 8.0 建表参考脚本
--
-- 说明：
--   1. 运行期建表以 apps/server/src/db/schema.ts 为准（Knex 同时支持
--      sqlite / mysql / pg），本文件是等价的 MySQL DDL，便于 DBA 审阅、
--      在 MySQL 环境手工初始化或做变更比对。
--   2. 与 schema.ts 保持一致：整数自增主键、字符串存 ISO-8601 时间戳、
--      金额一律用整数「分」；未显式建外键（应用层维护），只建索引/唯一键。
--   3. 字符集统一 utf8mb4，排序规则 utf8mb4_0900_ai_ci（MySQL 8 默认）。
--   4. 初始化完成后执行：npm run db:seed（幂等，写入默认账号/模板/定价规则）。
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `comfyui_ops`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE `comfyui_ops`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- 1. agent：代理商
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `agent`;
CREATE TABLE `agent` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`          VARCHAR(120) NOT NULL COMMENT '代理商名称',
  `code`          VARCHAR(64)  NOT NULL COMMENT '代理商编码（唯一，如 XY）',
  `contact_name`  VARCHAR(64)  NULL,
  `contact_phone` VARCHAR(32)  NULL,
  `share_ratio`   DECIMAL(6,4) NOT NULL DEFAULT 0.7000 COMMENT '分成比例 0~1',
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'active',
  `created_at`    VARCHAR(32)  NOT NULL COMMENT 'ISO-8601 时间戳',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='代理商';

-- ---------------------------------------------------------------------------
-- 2. user：登录账号（admin / operator / agent / user）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `user`;
CREATE TABLE `user` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email`         VARCHAR(190) NOT NULL,
  `name`          VARCHAR(64)  NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL COMMENT 'scrypt$saltHex$hashHex',
  `role`          VARCHAR(24)  NOT NULL DEFAULT 'operator',
  `agent_id`      INT UNSIGNED NULL COMMENT '所属代理商（仅 agent/user 角色）',
  `status`        VARCHAR(16)  NOT NULL DEFAULT 'active',
  `created_at`    VARCHAR(32)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_email` (`email`),
  KEY `idx_user_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='登录账号';

-- ---------------------------------------------------------------------------
-- 3. agent_user：代理商成员关系
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `agent_user`;
CREATE TABLE `agent_user` (
  `id`        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `agent_id`  INT UNSIGNED NOT NULL,
  `user_id`   INT UNSIGNED NOT NULL,
  `joined_at` VARCHAR(32)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_user_user` (`user_id`),
  KEY `idx_agent_user_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='代理商成员';

-- ---------------------------------------------------------------------------
-- 4. prompt_template：出图模板（ComfyUI 节点图 + 参数映射）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `prompt_template`;
CREATE TABLE `prompt_template` (
  `id`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`                VARCHAR(120) NOT NULL,
  `description`         VARCHAR(500) NULL,
  `model_name`          VARCHAR(120) NOT NULL DEFAULT 'sd_xl_base_1.0.safetensors',
  `graph_json`          TEXT         NOT NULL COMMENT 'ComfyUI API 格式节点图',
  `default_params_json` TEXT         NULL COMMENT '参数默认值与节点映射',
  `is_active`           TINYINT(1)   NOT NULL DEFAULT 1,
  `created_by`          INT UNSIGNED NULL,
  `created_at`          VARCHAR(32)  NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='出图模板';

-- ---------------------------------------------------------------------------
-- 5. generation_task：出图任务（状态机 + 幂等键）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `generation_task`;
CREATE TABLE `generation_task` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_no`           VARCHAR(40)  NOT NULL COMMENT '业务单号 Tyyyymmddxxxxxx',
  `user_id`           INT UNSIGNED NOT NULL,
  `agent_id`          INT UNSIGNED NULL,
  `template_id`       INT UNSIGNED NULL,
  `client_request_id` VARCHAR(80)  NULL COMMENT '前端幂等键',
  `status`            VARCHAR(24)  NOT NULL DEFAULT 'queued'
                      COMMENT 'queued/submitted/running/polling/downloading/completed/failed/timeout/unreachable',
  `prompt_text`       VARCHAR(1000) NOT NULL,
  `negative_prompt`   VARCHAR(1000) NULL,
  `params_json`       TEXT         NOT NULL,
  `graph_json`        TEXT         NOT NULL,
  `comfyui_prompt_id` VARCHAR(64)  NULL,
  `progress`          INT          NOT NULL DEFAULT 0,
  `error_code`        VARCHAR(64)  NULL,
  `error_message`     VARCHAR(1000) NULL,
  `error_detail`      TEXT         NULL,
  `attempts`          INT          NOT NULL DEFAULT 0,
  `submitted_at`      VARCHAR(32)  NULL,
  `started_at`        VARCHAR(32)  NULL,
  `finished_at`       VARCHAR(32)  NULL,
  `duration_ms`       INT          NULL,
  `image_count`       INT          NOT NULL DEFAULT 0,
  `gpu_seconds`       INT          NOT NULL DEFAULT 0,
  `created_at`        VARCHAR(32)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_task_no` (`task_no`),
  UNIQUE KEY `uq_task_idempotent` (`user_id`, `client_request_id`),
  KEY `idx_task_user` (`user_id`),
  KEY `idx_task_agent` (`agent_id`),
  KEY `idx_task_status` (`status`),
  KEY `idx_task_prompt` (`comfyui_prompt_id`),
  KEY `idx_task_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='出图任务';

-- ---------------------------------------------------------------------------
-- 6. task_attempt：每次提交/轮询尝试的审计轨迹
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `task_attempt`;
CREATE TABLE `task_attempt` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id`       INT UNSIGNED NOT NULL,
  `attempt_no`    INT          NOT NULL,
  `status`        VARCHAR(24)  NOT NULL,
  `stage`         VARCHAR(24)  NOT NULL COMMENT 'submit/poll/download/convert',
  `http_status`   INT          NULL,
  `error_type`    VARCHAR(64)  NULL,
  `error_message` VARCHAR(1000) NULL,
  `backoff_ms`    INT          NOT NULL DEFAULT 0,
  `started_at`    VARCHAR(32)  NOT NULL,
  `finished_at`   VARCHAR(32)  NULL,
  PRIMARY KEY (`id`),
  KEY `idx_attempt_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务尝试记录';

-- ---------------------------------------------------------------------------
-- 7. image_asset：图片资产（原图 / 缩略图 / 派生格式）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `image_asset`;
CREATE TABLE `image_asset` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id`         INT UNSIGNED NOT NULL,
  `user_id`         INT UNSIGNED NOT NULL,
  `agent_id`        INT UNSIGNED NULL,
  `filename`        VARCHAR(190) NOT NULL,
  `storage_path`    VARCHAR(500) NOT NULL,
  `mime_type`       VARCHAR(64)  NOT NULL,
  `format`          VARCHAR(16)  NOT NULL,
  `width`           INT          NULL,
  `height`          INT          NULL,
  `byte_size`       INT          NOT NULL,
  `sha256`          VARCHAR(64)  NOT NULL,
  `thumbnail_path`  VARCHAR(500) NULL,
  `converted_path`  VARCHAR(500) NULL,
  `source_image_id` INT UNSIGNED NULL COMMENT '格式转换来源图',
  `created_at`      VARCHAR(32)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_image_task` (`task_id`),
  KEY `idx_image_user` (`user_id`),
  KEY `idx_image_agent` (`agent_id`),
  KEY `idx_image_source` (`source_image_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='图片资产';

-- ---------------------------------------------------------------------------
-- 8. usage_record：用量流水（每个终态任务一条，结算依据）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `usage_record`;
CREATE TABLE `usage_record` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_id`     INT UNSIGNED NOT NULL,
  `user_id`     INT UNSIGNED NOT NULL,
  `agent_id`    INT UNSIGNED NULL,
  `model_name`  VARCHAR(120) NOT NULL,
  `status`      VARCHAR(24)  NOT NULL,
  `image_count` INT          NOT NULL DEFAULT 0,
  `duration_ms` INT          NULL,
  `gpu_seconds` INT          NOT NULL DEFAULT 0,
  `billable`    TINYINT(1)   NOT NULL DEFAULT 1,
  `occurred_at` VARCHAR(10)  NOT NULL COMMENT 'YYYY-MM-DD，聚合与筛选维度',
  `created_at`  VARCHAR(32)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usage_task` (`task_id`),
  KEY `idx_usage_user` (`user_id`),
  KEY `idx_usage_agent` (`agent_id`),
  KEY `idx_usage_occurred` (`occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用量流水';

-- ---------------------------------------------------------------------------
-- 9. pricing_rule：代理商阶梯定价
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `pricing_rule`;
CREATE TABLE `pricing_rule` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `agent_id`          INT UNSIGNED NOT NULL,
  `model_name`        VARCHAR(120) NOT NULL DEFAULT '*',
  `base_price_cents`  INT          NOT NULL DEFAULT 120 COMMENT '阶梯一单价（分/张）',
  `tier_threshold`    INT          NOT NULL DEFAULT 1000 COMMENT '阶梯一上限张数',
  `tier2_price_cents` INT          NOT NULL DEFAULT 100 COMMENT '阶梯二单价（分/张）',
  `share_ratio`       DECIMAL(6,4) NOT NULL DEFAULT 0.7000,
  `effective_from`    VARCHAR(10)  NOT NULL COMMENT 'YYYY-MM-DD',
  `created_at`        VARCHAR(32)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pricing_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='代理商定价规则';

-- ---------------------------------------------------------------------------
-- 10. settlement：结算单
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `settlement`;
CREATE TABLE `settlement` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `settlement_no`     VARCHAR(40)  NOT NULL COMMENT '结算单号 STyyyymmddxxxx',
  `agent_id`          INT UNSIGNED NOT NULL,
  `period_start`      VARCHAR(10)  NOT NULL,
  `period_end`        VARCHAR(10)  NOT NULL,
  `status`            VARCHAR(24)  NOT NULL DEFAULT 'pending'
                      COMMENT 'pending/confirmed/paid',
  `task_count`        INT          NOT NULL DEFAULT 0,
  `image_count`       INT          NOT NULL DEFAULT 0,
  `gross_cents`       INT          NOT NULL DEFAULT 0 COMMENT '流水（分）',
  `platform_fee_cents` INT         NOT NULL DEFAULT 0 COMMENT '平台分成（分）',
  `agent_amount_cents` INT         NOT NULL DEFAULT 0 COMMENT '代理商应结（分）',
  `confirmed_at`      VARCHAR(32)  NULL,
  `paid_at`           VARCHAR(32)  NULL,
  `created_at`        VARCHAR(32)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_settlement_no` (`settlement_no`),
  KEY `idx_settlement_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='代理商结算单';

-- ---------------------------------------------------------------------------
-- 11. settlement_item：结算明细（阶梯行）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `settlement_item`;
CREATE TABLE `settlement_item` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `settlement_id`    INT UNSIGNED NOT NULL,
  `usage_record_id`  INT UNSIGNED NULL,
  `description`      VARCHAR(255) NOT NULL,
  `image_count`      INT          NOT NULL,
  `unit_price_cents` INT          NOT NULL,
  `amount_cents`     INT          NOT NULL,
  `created_at`       VARCHAR(32)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_settlement_item_settlement` (`settlement_id`),
  KEY `idx_settlement_item_usage` (`usage_record_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='结算明细';

-- ---------------------------------------------------------------------------
-- 12. audit_log：审计日志（登录、任务、导出、结算、配置变更）
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `audit_log`;
CREATE TABLE `audit_log` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_id`    INT UNSIGNED NULL,
  `action`      VARCHAR(64)  NOT NULL,
  `target_type` VARCHAR(48)  NULL,
  `target_id`   VARCHAR(64)  NULL,
  `detail_json` TEXT         NULL,
  `ip`          VARCHAR(64)  NULL,
  `created_at`  VARCHAR(32)  NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_audit_actor` (`actor_id`),
  KEY `idx_audit_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='审计日志';

-- ---------------------------------------------------------------------------
-- 13. system_config：运行期可热更新配置
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `system_config`;
CREATE TABLE `system_config` (
  `key`        VARCHAR(96) NOT NULL,
  `value`      TEXT        NOT NULL,
  `updated_at` VARCHAR(32) NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统配置';

SET FOREIGN_KEY_CHECKS = 1;
