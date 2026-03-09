import { getPrismaClient } from '@leetcord/database';
import { StatsSyncService } from '@leetcord/core';
import cron from 'node-cron';
import { WEEKLY_LEADERBOARD_CRON } from '@leetcord/shared';
import { runComputeWeeklyLeaderboardJob } from '../jobs/computeWeeklyLeaderboardJob';

type WorkerDatabaseClient = ReturnType<typeof getPrismaClient>;

export interface WeeklySchedulerDependencies {
  db: WorkerDatabaseClient;
  statsSyncService: StatsSyncService;
}

export const registerWeeklyScheduler = (dependencies: WeeklySchedulerDependencies): void => {
  cron.schedule(WEEKLY_LEADERBOARD_CRON, async () => {
    await runComputeWeeklyLeaderboardJob(dependencies.db, dependencies.statsSyncService);
  });
};
