# 部署与上线（Deployment）

## 1. 环境要求

| 项 | 本地开发 | 生产建议 |
| --- | --- | --- |
| Node.js | ≥ 22（实测 v24.20.0） | ≥ 22 LTS |
| 包管理器 | npm 11 / pnpm 10+ | 与锁文件一致 |
| 操作系统 | Windows 10/11、macOS、Linux | Linux x64 |
| 数据库 | SQLite（默认，零安装） | MySQL 8 / PostgreSQL |
| 反向代理 | 无（Vite dev server） | Nginx 1.24+ |
| 容器 | 可选（本机未安装 Docker，未实测） | Docker 24+ / Compose v2 |

## 2. 本地部署

```bash
# 1) 安装依赖（仓库已含 node_modules 时可跳过）
npm install

# 2) 初始化数据库并写入种子数据
npm run db:setup
npm run db:seed

# 3) 一键启动 mock(8188) + server(3000) + web(5173)
npm run dev
```

访问 <http://127.0.0.1:5173>，使用 `admin@ops.local / Admin@123456` 登录。

分步启动：

```bash
npm run dev:mock     # ComfyUI mock，127.0.0.1:8188
npm run dev:server   # Fastify API，127.0.0.1:3000
npm run dev:web      # Vite dev server，127.0.0.1:5173
```

> Windows 下若 `127.0.0.1:5173` 无法访问，Vite 默认可能只监听 IPv6。使用 `npm run dev:web -- --host 127.0.0.1`，或改用 `http://localhost:5173`。

## 3. 生产构建

```bash
npm run build        # mock tsc + server tsc + web (tsc --noEmit && vite build)
npm test             # vitest 46 用例
npm run check:web    # 构建产物无头检查（26 项）
```

产物位置：

| 产物 | 路径 |
| --- | --- |
| 前端静态文件 | `apps/web/dist/` |
| 服务端 | `apps/server/dist/index.js` |
| Mock | `services/comfyui-mock/dist/index.js` |

启动：

```bash
# API（工作目录必须是 apps/server，.env、data/、storage/ 均相对该目录）
cd apps/server
node dist/index.js

# Mock（仅本地/演示环境需要）
cd services/comfyui-mock
node dist/index.js
```

前端由 Nginx 托管：

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;   # apps/web/dist

  location /assets/ {
    expires 30d;
    add_header Cache-Control "public, immutable";
  }

  location = /index.html {
    add_header Cache-Control "no-cache";
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_buffering off;        # CSV 流式导出必须关闭缓冲
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

> 前端使用 HashRouter，`/` 回退到 `index.html` 即可；若未来切换 BrowserRouter，才需要 history fallback 规则。

## 4. Docker Compose

仓库根提供 `Dockerfile`、`docker-compose.yml`、`docker/nginx.conf`：

```bash
docker compose up -d --build
# web:    http://127.0.0.1:8080
# server: http://127.0.0.1:3000
# mock:   http://127.0.0.1:8188
```

服务编排：

| 服务 | 镜像/构建 | 端口 | 说明 |
| --- | --- | --- | --- |
| `mock` | Dockerfile `mock` target | 8188 | healthcheck：`/system_stats` |
| `server` | Dockerfile `server` target | 3000 | 依赖 mock healthy；healthcheck：`/api/health` |
| `web` | Dockerfile `web` target（nginx） | 8080→80 | 反代 `/api` 到 server |
| `mysql` | `mysql:8.0`（profile `mysql`） | 3306 | 挂载 `db/schema.mysql.sql` 自动建库 |

- 数据卷：`server-data`（SQLite）、`server-storage`（图片）、`mysql-data`。
- 首次启动后执行种子：`docker compose exec server npm run db:seed`。
- **说明**：交付环境未安装 Docker，编排文件按标准写法提供，未在本机实际运行验证。

## 5. 环境变量

配置加载顺序：进程环境变量 > `.env` > 代码默认值。复制 `.env.example` 为 `.env` 后修改。

### 服务端

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DB_CLIENT` | `sqlite` | `sqlite / mysql / pg` |
| `DB_FILENAME` | `./data/app.db` | SQLite 文件（相对 server 工作目录） |
| `DATABASE_URL` | — | 设置后优先于 SQLite |
| `COMFYUI_BASE_URL` | `http://127.0.0.1:8188` | ComfyUI 地址 |
| `COMFYUI_REQUEST_TIMEOUT_MS` | `10000` | 单次 HTTP 超时 |
| `POLL_INTERVAL_MS` | `800` | 轮询间隔 |
| `JOB_TIMEOUT_MS` | `60000` | 整任务超时 |
| `MAX_RETRIES` | `3` | 最大重试次数 |
| `ORCHESTRATOR_CONCURRENCY` | `2` | 编排并发 |
| `STORAGE_DIR` | `./storage` | 图片存储目录 |
| `THUMBNAIL_SIZE` | `256` | 缩略图边长 |
| `JWT_SECRET` | `dev-only-change-me-in-production` | **生产必须替换** |
| `TOKEN_TTL_SECONDS` | `43200` | token 有效期（12h） |
| `PLATFORM_FEE_RATIO` | `0.2` | 平台费率（展示/兜底） |
| `LOG_LEVEL` | `info` | 日志级别 |

### Mock

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `MOCK_PORT` | `8188` | 端口 |
| `MOCK_HOST` | `127.0.0.1` | 监听地址 |
| `MOCK_MODE` | `ok` | `ok / slow / fail / partial` |
| `MOCK_SLOW_MS` | `5000` | slow 模式延迟 |
| `MOCK_JOB_DURATION_MS` | `3000` | 任务“生成”时长 |

### 前端

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | 空 | 空时使用同源 `/api`；跨域部署时填完整地址 |

## 6. 数据库切换

```bash
# MySQL：先执行 db/schema.mysql.sql（或让 db:setup 建表）
DB_CLIENT=mysql DATABASE_URL="mysql://user:pass@host:3306/comfyui_ops" npm run db:setup
DB_CLIENT=mysql DATABASE_URL="mysql://user:pass@host:3306/comfyui_ops" npm run db:seed

# PostgreSQL
DB_CLIENT=pg DATABASE_URL="postgres://user:pass@host:5432/comfyui_ops" npm run db:setup
```

生产环境建议：

- 使用独立数据库账号，只授予业务库 DML/DDL 权限。
- 将 `ensureSchema` 换成正式迁移工具（如 Knex migrations），支持列变更与回滚。
- 开启慢查询日志，定期归档 `audit_log`。

## 7. 上线检查清单

- [ ] `JWT_SECRET` 已替换为高强度随机值。
- [ ] 种子账号密码已修改或禁用演示账号。
- [ ] `COMFYUI_BASE_URL` 指向真实 ComfyUI（或明确的 mock 环境）。
- [ ] `GET /api/health` 返回 200。
- [ ] `GET /api/system/status` 中 `db=ok`、`comfyui.reachable=true`。
- [ ] `npm test` 全绿、`npm run check:web` 退出码 0。
- [ ] `node scripts/e2e-smoke.mjs --base http://127.0.0.1:3000 --mock http://127.0.0.1:8188` 通过。
- [ ] Nginx 对 `/api/` 关闭 `proxy_buffering`（CSV 流式）。
- [ ] 静态资源带 hash 长缓存，`index.html` no-cache。
- [ ] `storage/` 与数据库纳入备份；磁盘余量监控。
- [ ] 确认单实例部署（编排队列在进程内，多实例需要外部队列）。

## 8. 升级与回滚

1. 备份数据库与 `storage/`。
2. 拉取新版本，`npm ci`，`npm run build`。
3. 执行数据库变更（当前版本无破坏性变更；跨版本需自行迁移）。
4. 重启进程，验证健康检查与 smoke。
5. 回滚：恢复上一版本代码与数据库备份，重启。

## 9. 已知部署限制

- 编排器队列在内存中，多实例并行会产生竞争；生产建议单实例或引入 Redis 队列。
- 图片存本地磁盘，容器化需挂载持久卷；多副本需对象存储。
- 未内置 HTTPS、CSP、限流；应由网关统一处理。
- 无 Docker 环境的实测记录，`docker-compose.yml` 为按标准编写的交付物。
