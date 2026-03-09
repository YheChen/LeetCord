import { REST } from '@discordjs/rest';
import { StatsSyncService } from '@leetcord/core';
import { getPrismaClient } from '@leetcord/database';
import cron from 'node-cron';
import { DAILY_COMPLETION_REFRESH_CRON, STATS_REFRESH_CRON } from '@leetcord/shared';
import { runRefreshUserStatsJob } from '../jobs/refreshUserStatsJob';
import { runRefreshDailyCompletionJob } from '../jobs/refreshDailyCompletionJob';

type WorkerDatabaseClient = ReturnType<typeof getPrismaClient>;

export interface FrequentSchedulerDependencies {
  db: WorkerDatabaseClient;
  statsSyncService: StatsSyncService;
  discordRest: REST;
}

export const registerFrequentSchedulers = (dependencies: FrequentSchedulerDependencies): void => {
  cron.schedule(STATS_REFRESH_CRON, async () => {
    await runRefreshUserStatsJob(dependencies.statsSyncService);
  });

  cron.schedule(DAILY_COMPLETION_REFRESH_CRON, async () => {
    await runRefreshDailyCompletionJob(
      dependencies.statsSyncService,
      dependencies.db,
      dependencies.discordRest,
    );
  });
};
