/** Mock 服务入口：node dist/index.js 或 pnpm dev */
import { createMockApp } from './server.js';

const { app, config, state } = createMockApp();

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(
    `[comfyui-mock] listening on http://${config.host}:${config.port} mode=${state.mode} ` +
      `jobDuration=${config.jobDurationMs}ms`,
  );
} catch (error) {
  console.error('[comfyui-mock] failed to start:', error);
  process.exit(1);
}

const shutdown = async (signal: string): Promise<void> => {
  console.log(`[comfyui-mock] received ${signal}, shutting down`);
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
