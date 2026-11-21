/**
 * 应用装配：依赖注入 + 路由注册 + 统一错误处理。
 *
 * 分层：Fastify（HTTP）→ routes → services → repositories → Knex。
 * createApp 返回 { app, services, close }，测试里可直接拿到 services 做断言。
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { loadConfig, type AppConfig } from './config.js';
import { createDb, type Db } from './db/knex.js';
import { ensureSchema } from './db/schema.js';
import { AppError } from './lib/errors.js';
import { createAuthGuard } from './http/auth.js';
import { ok } from './http/respond.js';
import { AccountRepository } from './repositories/accountRepo.js';
import { AuditRepository, ConfigRepository } from './repositories/configRepo.js';
import { ImageRepository } from './repositories/imageRepo.js';
import { SettlementRepository } from './repositories/settlementRepo.js';
import { TaskRepository } from './repositories/taskRepo.js';
import { UsageRepository } from './repositories/usageRepo.js';
import { AuthService } from './services/authService.js';
import { ComfyUiClient } from './services/comfyuiClient.js';
import { ComfyUiPoller } from './services/poller.js';
import { ExportService } from './services/exportService.js';
import { ImageConverter } from './services/imageConverter.js';
import { ImageService } from './services/imageService.js';
import { TaskOrchestrator } from './services/orchestrator.js';
import { OverviewService } from './services/overviewService.js';
import { SettlementService } from './services/settlementService.js';
import { StorageService } from './services/storage.js';
import { TaskService } from './services/taskService.js';
import { TemplateService } from './services/templateService.js';
import { UsageService } from './services/usageService.js';
import { authPublicRoutes, authRoutes } from './routes/auth.js';
import { agentRoutes, settlementRoutes } from './routes/agents.js';
import { exportRoutes, usageRoutes } from './routes/usage.js';
import { imageRoutes } from './routes/images.js';
import { overviewRoutes } from './routes/overview.js';
import { settingsRoutes } from './routes/settings.js';
import { systemRoutes } from './routes/system.js';
import { taskRoutes } from './routes/tasks.js';
import { templateRoutes } from './routes/templates.js';

export interface AppServices {
  config: AppConfig;
  db: Db;
  client: ComfyUiClient;
  poller: ComfyUiPoller;
  orchestrator: TaskOrchestrator;
  auth: AuthService;
  accounts: AccountRepository;
  tasksRepo: TaskRepository;
  imagesRepo: ImageRepository;
  usageRepo: UsageRepository;
  settlementsRepo: SettlementRepository;
  configRepo: ConfigRepository;
  audit: AuditRepository;
  templates: TemplateService;
  tasks: TaskService;
  imageService: ImageService;
  usage: UsageService;
  settlements: SettlementService;
  exportService: ExportService;
  overview: OverviewService;
  storage: StorageService;
}

export interface CreateAppOptions {
  config?: Partial<AppConfig>;
  db?: Db;
  client?: ComfyUiClient;
  logger?: FastifyServerOptions['logger'];
  /** 启动时把上次进程中断的任务标记失败并恢复排队任务（生产入口开启） */
  recover?: boolean;
}

export interface CreateAppResult {
  app: FastifyInstance;
  services: AppServices;
  close: () => Promise<void>;
}

export async function createApp(options: CreateAppOptions = {}): Promise<CreateAppResult> {
  const config = loadConfig(options.config);

  if (!options.db && config.dbClient === 'sqlite') {
    mkdirSync(dirname(config.dbFilename), { recursive: true });
  }
  const db = options.db ?? createDb(config);
  await ensureSchema(db);

  const accounts = new AccountRepository(db);
  const tasksRepo = new TaskRepository(db);
  const imagesRepo = new ImageRepository(db);
  const usageRepo = new UsageRepository(db);
  const settlementsRepo = new SettlementRepository(db);
  const configRepo = new ConfigRepository(db);
  const audit = new AuditRepository(db);

  const storage = new StorageService(config.storageDir);
  await storage.ensure();
  const converter = new ImageConverter({ thumbnailSize: config.thumbnailSize });

  const client =
    options.client ??
    new ComfyUiClient({ baseUrl: config.comfyuiBaseUrl, timeoutMs: config.comfyuiRequestTimeoutMs });
  const poller = new ComfyUiPoller(client, {
    pollIntervalMs: config.comfyuiPollIntervalMs,
    jobTimeoutMs: config.comfyuiJobTimeoutMs,
    maxRetries: config.comfyuiMaxRetries,
  });

  const app: FastifyInstance = Fastify({
    logger: options.logger ?? { level: config.logLevel },
    bodyLimit: 2 * 1024 * 1024,
  });

  const orchestrator = new TaskOrchestrator({
    config,
    client,
    poller,
    storage,
    converter,
    tasks: tasksRepo,
    images: imagesRepo,
    usage: usageRepo,
    logger: app.log,
  });

  const services: AppServices = {
    config,
    db,
    client,
    poller,
    orchestrator,
    accounts,
    tasksRepo,
    imagesRepo,
    usageRepo,
    settlementsRepo,
    configRepo,
    audit,
    storage,
    auth: new AuthService(accounts, config),
    templates: new TemplateService(accounts),
    tasks: new TaskService(tasksRepo, imagesRepo, new TemplateService(accounts), orchestrator),
    imageService: new ImageService(imagesRepo, tasksRepo, storage, converter),
    usage: new UsageService(usageRepo),
    settlements: new SettlementService(db, accounts, usageRepo, settlementsRepo),
    exportService: new ExportService(usageRepo, settlementsRepo, audit),
    overview: new OverviewService(tasksRepo, imagesRepo, usageRepo),
  };

  await app.register(cors, {
    origin: true,
    credentials: false,
    exposedHeaders: ['Content-Disposition', 'X-Export-Filename'],
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({
        success: false,
        error: { code: error.code, message: error.message, details: error.details ?? null },
      });
      return;
    }
    if (error instanceof ZodError) {
      reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: '参数校验失败', details: error.issues },
      });
      return;
    }
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    if (statusCode >= 400 && statusCode < 500) {
      reply.code(statusCode).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: (error as Error).message },
      });
      return;
    }
    request.log.error({ err: error, url: request.url }, '未处理的服务端异常');
    reply.code(500).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: '服务端内部错误，请稍后重试' },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: `接口不存在：${request.method} ${request.url}` },
    });
  });

  // 公开路由：健康检查 + 登录
  await app.register(
    async (publicApi) => {
      publicApi.get('/health', async () => ok({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }));
      await authPublicRoutes(publicApi, services);
    },
    { prefix: '/api' },
  );

  // 受保护路由：统一在插件作用域内挂鉴权钩子
  await app.register(
    async (protectedApi) => {
      protectedApi.addHook('preHandler', createAuthGuard(services.auth));
      await authRoutes(protectedApi, services);
      await overviewRoutes(protectedApi, services);
      await templateRoutes(protectedApi, services);
      await taskRoutes(protectedApi, services);
      await imageRoutes(protectedApi, services);
      await usageRoutes(protectedApi, services);
      await exportRoutes(protectedApi, services);
      await agentRoutes(protectedApi, services);
      await settlementRoutes(protectedApi, services);
      await settingsRoutes(protectedApi, services);
      await systemRoutes(protectedApi, services);
    },
    { prefix: '/api' },
  );

  if (options.recover) {
    await orchestrator.recover();
  }

  const close = async (): Promise<void> => {
    await orchestrator.shutdown();
    await app.close();
    await db.destroy();
  };

  return { app, services, close };
}
