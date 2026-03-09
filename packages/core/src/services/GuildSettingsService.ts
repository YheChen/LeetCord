import { PrismaClient } from '@prisma/client';
import { createLogger } from '@leetcord/shared';

const logger = createLogger({ name: 'core-guild-settings-service' });

export class GuildSettingsService {
  constructor(private readonly db: PrismaClient) {}

  async getOrCreateGuildSettings(guildId: string): Promise<{
    id: string;
    guildId: string;
    dailyChannelId: string | null;
    timezone: string | null;
    leaderboardEnabled: boolean;
  }> {
    const settings = await this.db.guildSettings.upsert({
      where: { guildId },
      update: {},
      create: {
        guildId,
        leaderboardEnabled: true
      }
    });

    return {
      id: settings.id,
      guildId: settings.guildId,
      dailyChannelId: settings.dailyChannelId ?? null,
      timezone: settings.timezone ?? null,
      leaderboardEnabled: settings.leaderboardEnabled
    };
  }

  async updateDailyChannel(guildId: string, channelId: string | null): Promise<void> {
    await this.db.guildSettings.upsert({
      where: { guildId },
      update: { dailyChannelId: channelId },
      create: {
        guildId,
        dailyChannelId: channelId ?? undefined,
        leaderboardEnabled: true
      }
    });
    logger.info({ guildId, channelId }, 'Updated daily channel');
  }

  async updateTimezone(guildId: string, timezone: string | null): Promise<void> {
    await this.db.guildSettings.upsert({
      where: { guildId },
      update: { timezone },
      create: {
        guildId,
        timezone: timezone ?? undefined,
        leaderboardEnabled: true
      }
    });
    logger.info({ guildId, timezone }, 'Updated timezone');
  }

  async setLeaderboardEnabled(guildId: string, enabled: boolean): Promise<void> {
    await this.db.guildSettings.upsert({
      where: { guildId },
      update: { leaderboardEnabled: enabled },
      create: {
        guildId,
        leaderboardEnabled: enabled
      }
    });
    logger.info({ guildId, enabled }, 'Updated leaderboard enabled');
  }
}

