import { REST } from '@discordjs/rest';
import { StatsSyncService } from '@leetcord/core';
import { getPrismaClient } from '@leetcord/database';
import { createLogger } from '@leetcord/shared';
import { runPostCompletionFeedJob } from './postCompletionFeedJob';

const logger = createLogger({ name: 'job-refresh-daily-completion' });

type WorkerDatabaseClient = ReturnType<typeof getPrismaClient>;

export const runRefreshDailyCompletionJob = async (
  statsSyncService: StatsSyncService,
  db?: WorkerDatabaseClient,
  discordRest?: REST,
): Promise<void> => {
  try {
    const newCompletions = await statsSyncService.refreshDailyCompletionForAllUsers();
    logger.info(
      { newCompletions: newCompletions.length },
      'Refreshed daily completion for linked users',
    );

    if (newCompletions.length > 0 && db && discordRest) {
      await runPostCompletionFeedJob(db, discordRest, newCompletions);
    }
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      'Failed to refresh daily completion',
    );
  }
};
