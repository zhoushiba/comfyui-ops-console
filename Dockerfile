# ============================================================================
# ComfyUI 算力运营控制台 · 多阶段构建
#
# 目标（target）：
#   server —— 编排 API（Fastify + SQLite 卷）
#   mock   —— ComfyUI 模拟服务（真实 PNG、故障注入）
#   web    —— 运营后台静态产物 + Nginx（/api 反代到 server）
#
# 本地无 Docker 环境，本文件仅作为部署参考，未在 CI 中验证；
# 直接在本机运行时请使用 docs/runbook-local.md 的 npm 流程。
# ============================================================================

FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV npm_config_update_notifier=false
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY services/comfyui-mock/package.json services/comfyui-mock/package.json
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# 编排 API
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS server
WORKDIR /app/apps/server
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_CLIENT=sqlite \
    DB_FILENAME=/data/app.db \
    STORAGE_DIR=/storage
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/server/dist /app/apps/server/dist
COPY --from=build /app/apps/server/package.json /app/apps/server/package.json
RUN mkdir -p /data /storage
EXPOSE 3000
CMD ["node", "dist/index.js"]

# ---------------------------------------------------------------------------
# ComfyUI 模拟服务
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS mock
WORKDIR /app/services/comfyui-mock
ENV NODE_ENV=production \
    MOCK_PORT=8188 \
    MOCK_HOST=0.0.0.0 \
    MOCK_MODE=ok
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=build /app/services/comfyui-mock/dist /app/services/comfyui-mock/dist
COPY --from=build /app/services/comfyui-mock/package.json /app/services/comfyui-mock/package.json
EXPOSE 8188
CMD ["node", "dist/index.js"]

# ---------------------------------------------------------------------------
# 运营后台（静态产物 + Nginx）
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
