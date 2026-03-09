import { getPrismaClient } from '@leetcord/database';
import { StatsSyncService } from '@leetcord/core';
import { createLogger } from '@leetcord/shared';

const logger = createLogger({ name: 'job-weekly-leaderboard' });

type WorkerDatabaseClient = ReturnType<typeof getPrismaClient>;

export const runComputeWeeklyLeaderboardJob = async (
  db: WorkerDatabaseClient,
  statsSyncService: StatsSyncService
): Promise<void> => {
  try {
    const guildSettings = await db.guildSettings.findMany({
      select: { guildId: true }
    });

    for (const guild of guildSettings) {
      await statsSyncService.computeWeeklyLeaderboardSnapshotForGuild(guild.guildId);
    }

    logger.info({ guildCount: guildSettings.length }, 'Computed weekly leaderboard snapshots');
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      'Failed to compute weekly leaderboard'
    );
  }
};
