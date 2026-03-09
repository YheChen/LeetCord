import { REST } from '@discordjs/rest';
import { getPrismaClient } from '@leetcord/database';
import { StatsSyncService } from '@leetcord/core';
import cron from 'node-cron';
import { DAILY_POST_CRON_UTC } from '@leetcord/shared';
import { runFetchDailyProblemJob } from '../jobs/fetchDailyProblemJob';
import { runPostDailyProblemJob } from '../jobs/postDailyProblemJob';

type WorkerDatabaseClient = ReturnType<typeof getPrismaClient>;

export interface DailySchedulerDependencies {
  db: WorkerDatabaseClient;
  statsSyncService: StatsSyncService;
  discordRest: REST;
}

export const registerDailyScheduler = (dependencies: DailySchedulerDependencies): void => {
  cron.schedule(DAILY_POST_CRON_UTC, async () => {
    await runFetchDailyProblemJob(dependencies.statsSyncService);
    await runPostDailyProblemJob(dependencies.db, dependencies.discordRest);
  });
};
