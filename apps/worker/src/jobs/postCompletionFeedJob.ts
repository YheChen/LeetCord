import { REST } from '@discordjs/rest';
import type { NewDailyCompletion } from '@leetcord/core';
import { getPrismaClient } from '@leetcord/database';
import { createLogger } from '@leetcord/shared';
import { RESTPostAPIChannelMessageJSONBody, Routes } from 'discord-api-types/v10';

const logger = createLogger({ name: 'job-post-completion-feed' });

type WorkerDatabaseClient = ReturnType<typeof getPrismaClient>;

export const runPostCompletionFeedJob = async (
  db: WorkerDatabaseClient,
  rest: REST,
  newCompletions: NewDailyCompletion[],
): Promise<void> => {
  if (newCompletions.length === 0) {
    return;
  }

  try {
    const guildSettings = await db.guildSettings.findMany({
      where: { dailyChannelId: { not: null } },
      select: { guildId: true, dailyChannelId: true },
    });

    for (const setting of guildSettings) {
      const channelId = setting.dailyChannelId;
      if (!channelId) continue;

      // Find which newly-completed users are members of this guild
      const guildCompletions: Array<
        NewDailyCompletion & { completionFeedMentionsEnabled: boolean }
      > = [];

      for (const completion of newCompletions) {
        const membership = await db.guildMemberLink.findFirst({
          where: {
            guildId: setting.guildId,
            userLinkId: completion.userLinkId,
          },
          select: {
            userLink: {
              select: {
                completionFeedMentionsEnabled: true,
              },
            },
          },
        });

        if (membership) {
          guildCompletions.push({
            ...completion,
            completionFeedMentionsEnabled: membership.userLink.completionFeedMentionsEnabled,
          });
        }
      }

      if (guildCompletions.length === 0) continue;

      for (const completion of guildCompletions) {
        try {
          const payload: RESTPostAPIChannelMessageJSONBody = {
            embeds: [
              {
                color: 0x00b8a3,
                description: completion.completionFeedMentionsEnabled
                  ? `✅ <@${completion.discordUserId}> just completed today's daily!`
                  : `✅ ${completion.leetcodeUsername} just completed today's daily!`,
              },
            ],
          };

          await rest.post(Routes.channelMessages(channelId), { body: payload });
        } catch (error) {
          logger.warn(
            {
              err: error instanceof Error ? error.message : error,
              guildId: setting.guildId,
              discordUserId: completion.discordUserId,
            },
            'Failed to post completion feed message',
          );
        }
      }
    }

    logger.info(
      { completionCount: newCompletions.length },
      'Posted daily completion feed messages',
    );
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      'Failed completion feed job',
    );
  }
};
