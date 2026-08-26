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
  // Pinned to UTC because startOfWeekUtc defines the week boundary in UTC. Without
  // this, node-cron uses the host timezone: the old Raspberry Pi fired this at 05:00
  // UTC rather than 01:00, so behaviour depended on where the worker happened to run.
  //
  // The hourly job in frequentScheduler now keeps the snapshot current; this remains as
  // a safety net that computes the new week's snapshot promptly after the boundary.
  cron.schedule(
    WEEKLY_LEADERBOARD_CRON,
    async () => {
      await runComputeWeeklyLeaderboardJob(dependencies.db, dependencies.statsSyncService);
    },
    { timezone: 'UTC' },
  );
};
