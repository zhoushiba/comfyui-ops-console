/** 独立种子 CLI：npm run db:seed */
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
    const result = await seedDatabase(db);
    console.log(
      `[seed] 完成：用户 +${result.users}、模板 +${result.templates}（已存在的记录会跳过）`,
    );
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('[seed] 失败', error);
  process.exitCode = 1;
});
