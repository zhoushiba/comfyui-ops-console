# 贡献指南（Contributing）

本项目是个人作品集项目，仍按可维护的方式组织。提交改动前请阅读以下约定。

## 1. 本地开发流程

```bash
npm install
npm run db:setup
npm run db:seed
npm run dev
```

- 前端：<http://127.0.0.1:5173>
- API：<http://127.0.0.1:3000>
- Mock：<http://127.0.0.1:8188>

## 2. 分支与提交

- 分支：`main` 保持可运行；功能分支建议 `feat/<scope>`、修复 `fix/<scope>`。
- 提交信息建议使用 Conventional Commits：
  - `feat(server): 增加任务取消接口`
  - `fix(web): 修复用量页导出状态`
  - `docs: 补充 ComfyUI 兼容性矩阵`
  - `test(server): 覆盖结算跨档拆分`
- 一次提交只做一件事，附上必要的测试或文档。

## 3. 代码约定

### 3.1 服务端

- TypeScript strict；不使用 `any` 逃逸类型检查。
- 路由只做参数校验、调用 service、返回 DTO；业务逻辑放 `services/`，SQL 放 `repositories/`。
- 所有响应统一 `{ success: true, data }`；错误抛 `AppError` 子类，由全局错误处理器转换。
- 新增接口必须补 zod schema 与错误码说明（`docs/api.md`）。
- 金额一律用整数分；时间用 ISO 字符串 / `YYYY-MM-DD`。

### 3.2 前端

- 页面组件放 `src/pages/`，通用组件放 `src/components/`。
- 数据请求统一走 `src/lib/api.ts` 与 React Query；不要直接在页面里写 `fetch`。
- 新增页面需接入路由与左侧导航，并处理加载/空态/错误态。
- 样式沿用 `styles.css` 中的设计变量，保持深色主题一致。

### 3.3 Mock

- 接口行为必须与真实 ComfyUI 契约一致；新增模拟能力不得破坏正常模式。
- 故障注入通过 `POST /__admin/mode`，不要在默认 `ok` 模式引入随机失败。

## 4. 提交前检查

```bash
npm run build        # 必须成功
npm test             # 46 用例必须全绿
npm run check:web    # 退出码必须为 0
npm run smoke        # 改动出图链路时必跑（需 server + mock）
```

- 新增业务逻辑需补对应单测；修复 bug 需补回归用例。
- 改动接口或数据表时同步更新 `docs/api.md`、`docs/database.md`。
- 改动 ComfyUI 接入时同步更新 `docs/comfyui-integration.md` 与兼容性报告。

## 5. 代码风格

- 缩进 2 空格，单引号，语句结尾分号（与现有代码一致）。
- 命名：文件用 kebab/camel 与目录语义一致；类型用 PascalCase；常量用 UPPER_SNAKE。
- 注释解释「为什么」，不重复「做了什么」。
- 不提交生成物：`node_modules/`、`dist/`、`data/*.db`、`storage/`、`.env`、日志。

## 6. 文档

- 文档使用中文，命令使用代码块，路径使用相对路径。
- 截图必须来自真实运行页面，放入 `docs/screenshots/`，由脚本生成而非手工拼图。
- 新增文档需在 README「文档索引」中登记。

## 7. 安全

- 不要提交真实密钥、token、生产地址或用户数据。
- 生产部署必须替换 `JWT_SECRET`、修改种子账号密码、限制 CORS 与访问来源。
- 发现安全问题请私下联系维护者，不要公开 issue 细节。
