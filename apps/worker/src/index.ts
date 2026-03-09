import 'dotenv/config';
import { REST } from '@discordjs/rest';
import { getPrismaClient } from '@leetcord/database';
import { LeetCodeService, StatsSyncService } from '@leetcord/core';
import { createLeetCodeClient } from '@leetcord/leetcode-client';
import { createLogger } from '@leetcord/shared';
import { loadWorkerEnv } from './config/env';
import { registerDailyScheduler } from './schedulers/dailyScheduler';
import { registerFrequentSchedulers } from './schedulers/frequentScheduler';
import { registerWeeklyScheduler } from './schedulers/weeklyScheduler';

const logger = createLogger({ name: 'worker-main' });

const main = async (): Promise<void> => {
  const env = loadWorkerEnv();
  const db = getPrismaClient();
  const leetCodeClient = createLeetCodeClient(env.LEETCODE_FETCH_USER_AGENT);
  const leetCodeService = new LeetCodeService(leetCodeClient);
  const statsSyncService = new StatsSyncService(db, leetCodeService);
  const discordRest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

  registerDailyScheduler({ db, statsSyncService, discordRest });
  registerFrequentSchedulers({ statsSyncService });
  registerWeeklyScheduler({ db, statsSyncService });
  logger.info('Worker started and schedulers registered');
};

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Worker failed to start');
  process.exit(1);
});
