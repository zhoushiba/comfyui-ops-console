/** 服务入口：加载 .env → 建应用 → 监听 → 优雅退出 */
import { loadDotEnv, loadConfig } from './config.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  loadDotEnv(process.cwd());
  const config = loadConfig();
  const { app, close } = await createApp({ config, recover: true });

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `ComfyUI 运营控制台 API 已启动：http://127.0.0.1:${config.port}/api/health（ComfyUI: ${config.comfyuiBaseUrl}）`,
  );

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    app.log.info(`收到 ${signal}，正在优雅退出…`);
    try {
      await close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, '优雅退出失败');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[server] 启动失败', error);
  process.exit(1);
});
