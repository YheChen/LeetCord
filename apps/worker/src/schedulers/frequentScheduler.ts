import { StatsSyncService } from '@leetcord/core';
import cron from 'node-cron';
import { DAILY_COMPLETION_REFRESH_CRON, STATS_REFRESH_CRON } from '@leetcord/shared';
import { runRefreshUserStatsJob } from '../jobs/refreshUserStatsJob';
import { runRefreshDailyCompletionJob } from '../jobs/refreshDailyCompletionJob';

export interface FrequentSchedulerDependencies {
  statsSyncService: StatsSyncService;
}

export const registerFrequentSchedulers = (dependencies: FrequentSchedulerDependencies): void => {
  cron.schedule(STATS_REFRESH_CRON, async () => {
    await runRefreshUserStatsJob(dependencies.statsSyncService);
  });

  cron.schedule(DAILY_COMPLETION_REFRESH_CRON, async () => {
    await runRefreshDailyCompletionJob(dependencies.statsSyncService);
  });
};
