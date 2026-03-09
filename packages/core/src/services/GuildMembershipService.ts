import { PrismaClient } from '@prisma/client';
import { createLogger } from '@leetcord/shared';

const logger = createLogger({ name: 'core-guild-membership-service' });

export class GuildMembershipService {
  constructor(private readonly db: PrismaClient) {}

  async ensureMembershipForDiscordUser(discordUserId: string, guildId: string): Promise<void> {
    const link = await this.db.userLink.findUnique({
      where: { discordUserId },
      select: { id: true, verified: true }
    });

    if (!link || !link.verified) {
      return;
    }

    await this.ensureMembershipForUserLinkId(link.id, guildId);
  }

  async ensureMembershipForUserLinkId(userLinkId: string, guildId: string): Promise<void> {
    await this.db.guildMemberLink.upsert({
      where: {
        guildId_userLinkId: {
          guildId,
          userLinkId
        }
      },
      update: {},
      create: {
        guildId,
        userLinkId
      }
    });

    logger.debug({ guildId, userLinkId }, 'Ensured guild member link');
  }

  async removeMembershipForDiscordUser(discordUserId: string, guildId: string): Promise<void> {
    const link = await this.db.userLink.findUnique({
      where: { discordUserId },
      select: { id: true }
    });

    if (!link) {
      return;
    }

    await this.db.guildMemberLink.deleteMany({
      where: {
        guildId,
        userLinkId: link.id
      }
    });

    logger.debug({ guildId, userLinkId: link.id }, 'Removed guild member link');
  }
}
