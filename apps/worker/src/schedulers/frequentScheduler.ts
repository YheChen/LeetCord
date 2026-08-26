import { REST } from '@discordjs/rest';
import { StatsSyncService } from '@leetcord/core';
import { getPrismaClient } from '@leetcord/database';
import cron from 'node-cron';
import { DAILY_COMPLETION_REFRESH_CRON, STATS_REFRESH_CRON } from '@leetcord/shared';
import { runRefreshUserStatsJob } from '../jobs/refreshUserStatsJob';
import { runRefreshDailyCompletionJob } from '../jobs/refreshDailyCompletionJob';
import { runComputeWeeklyLeaderboardJob } from '../jobs/computeWeeklyLeaderboardJob';

type WorkerDatabaseClient = ReturnType<typeof getPrismaClient>;

export interface FrequentSchedulerDependencies {
  db: WorkerDatabaseClient;
  statsSyncService: StatsSyncService;
  discordRest: REST;
}

export const registerFrequentSchedulers = (dependencies: FrequentSchedulerDependencies): void => {
  cron.schedule(STATS_REFRESH_CRON, async () => {
    await runRefreshUserStatsJob(dependencies.statsSyncService);

    // Recompute the weekly leaderboard immediately after stats change. It is a cache of
    // a derived value, and refreshing it only on Monday at 01:00 UTC meant it was
    // computed one hour into the week — when every delta is still 0 — and then served
    // unchanged for the remaining 167 hours. Stats refresh hourly, so recomputing here
    // keeps the snapshot as fresh as the data it is derived from.
    await runComputeWeeklyLeaderboardJob(dependencies.db, dependencies.statsSyncService);
  });

  cron.schedule(DAILY_COMPLETION_REFRESH_CRON, async () => {
    await runRefreshDailyCompletionJob(
      dependencies.statsSyncService,
      dependencies.db,
      dependencies.discordRest,
    );
  });
};
