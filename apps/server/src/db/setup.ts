/** 建库 + 种子数据 CLI：npm run db:setup（可加 --seed 同时灌种子） */
import { loadDotEnv, loadConfig } from '../config.js';
import { createDb } from './knex.js';
import { ensureSchema } from './schema.js';
import { seedDatabase } from './seed.js';

async function main(): Promise<void> {
  loadDotEnv(process.cwd());
  const config = loadConfig();
  const db = createDb(config);
  try {
    await ensureSchema(db);
    console.log(`[db] schema 已就绪（${config.dbClient}）`);
    if (process.argv.includes('--seed') || process.argv.includes('--with-seed')) {
      const result = await seedDatabase(db);
      console.log(`[db] 种子数据完成：新增用户 ${result.users}、模板 ${result.templates}`);
    }
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('[db] 初始化失败', error);
  process.exitCode = 1;
});
