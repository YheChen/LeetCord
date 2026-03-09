import { StatsSyncService } from '@leetcord/core';
import { createLogger } from '@leetcord/shared';

const logger = createLogger({ name: 'job-refresh-user-stats' });

export const runRefreshUserStatsJob = async (
  statsSyncService: StatsSyncService
): Promise<void> => {
  try {
    await statsSyncService.refreshUserStatsForAllLinkedUsers();
    logger.info('Refreshed user stats for linked users');
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      'Failed to refresh user stats'
    );
  }
};
