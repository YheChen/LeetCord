import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';
import { REST } from '@discordjs/rest';
import { getPrismaClient } from '@leetcord/database';
import { LeetCodeService, StatsSyncService } from '@leetcord/core';
import { createLeetCodeClient } from '@leetcord/leetcode-client';
import { createLogger } from '@leetcord/shared';
import { loadWorkerEnv } from './config/env';
import { runComputeWeeklyLeaderboardJob } from './jobs/computeWeeklyLeaderboardJob';
import { runFetchDailyProblemJob } from './jobs/fetchDailyProblemJob';
import { runPostDailyProblemJob } from './jobs/postDailyProblemJob';
import { runRefreshDailyCompletionJob } from './jobs/refreshDailyCompletionJob';
import { runRefreshUserStatsJob } from './jobs/refreshUserStatsJob';
import { registerDailyScheduler } from './schedulers/dailyScheduler';
import { registerFrequentSchedulers } from './schedulers/frequentScheduler';
import { registerWeeklyScheduler } from './schedulers/weeklyScheduler';

loadDotenv({ path: resolve(__dirname, '../../../.env') });

const logger = createLogger({ name: 'worker-main' });

const main = async (): Promise<void> => {
  const env = loadWorkerEnv();
  const db = getPrismaClient();
  const leetCodeClient = createLeetCodeClient(env.LEETCODE_FETCH_USER_AGENT);
  const leetCodeService = new LeetCodeService(leetCodeClient);
  const statsSyncService = new StatsSyncService(db, leetCodeService);
  const discordRest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

  logger.info('Running startup jobs');
  await runFetchDailyProblemJob(statsSyncService);
  await runRefreshUserStatsJob(statsSyncService);
  await runRefreshDailyCompletionJob(statsSyncService);
  await runComputeWeeklyLeaderboardJob(db, statsSyncService);
  await runPostDailyProblemJob(db, discordRest);

  registerDailyScheduler({ db, statsSyncService, discordRest });
  registerFrequentSchedulers({ db, statsSyncService, discordRest });
  registerWeeklyScheduler({ db, statsSyncService });
  logger.info('Startup jobs completed; worker schedulers registered');
};

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Worker failed to start');
  process.exit(1);
});
