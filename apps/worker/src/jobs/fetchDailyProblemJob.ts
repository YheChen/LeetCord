import { StatsSyncService } from '@leetcord/core';
import { createLogger } from '@leetcord/shared';

const logger = createLogger({ name: 'job-fetch-daily' });

export const runFetchDailyProblemJob = async (statsSyncService: StatsSyncService): Promise<void> => {
  try {
    await statsSyncService.refreshTodayDailyProblem();
    logger.info('Fetched and stored today daily problem');
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      'Failed to fetch daily problem'
    );
  }
};
