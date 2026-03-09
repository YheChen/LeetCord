import { StatsSyncService } from '@leetcord/core';
import { createLogger } from '@leetcord/shared';

const logger = createLogger({ name: 'job-refresh-daily-completion' });

export const runRefreshDailyCompletionJob = async (
  statsSyncService: StatsSyncService
): Promise<void> => {
  try {
    await statsSyncService.refreshDailyCompletionForAllUsers();
    logger.info('Refreshed daily completion for linked users');
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      'Failed to refresh daily completion'
    );
  }
};
