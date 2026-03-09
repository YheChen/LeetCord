import { REST } from '@discordjs/rest';
import { getPrismaClient } from '@leetcord/database';
import { createLogger, toDateOnly } from '@leetcord/shared';
import { RESTPostAPIChannelMessageJSONBody, Routes } from 'discord-api-types/v10';

const logger = createLogger({ name: 'job-post-daily' });

type WorkerDatabaseClient = ReturnType<typeof getPrismaClient>;

export const runPostDailyProblemJob = async (
  db: WorkerDatabaseClient,
  rest: REST
): Promise<void> => {
  try {
    const today = toDateOnly(new Date());
    const dailyProblem = await db.dailyProblem.findUnique({
      where: { date: today }
    });

    if (!dailyProblem) {
      logger.warn('No daily problem found for today, skipping daily posts');
      return;
    }

    const guildSettings = await db.guildSettings.findMany({
      where: {
        dailyChannelId: {
          not: null
        }
      },
      select: {
        guildId: true,
        dailyChannelId: true
      }
    });

    for (const setting of guildSettings) {
      const channelId = setting.dailyChannelId;
      if (!channelId) {
        continue;
      }

      const existingPost = await db.guildDailyPost.findFirst({
        where: {
          guildId: setting.guildId,
          dailyProblemId: dailyProblem.id
        },
        orderBy: { postedAt: 'desc' }
      });

      if (existingPost) {
        continue;
      }

      try {
        const payload = buildDailyMessagePayload({
          title: dailyProblem.title,
          url: dailyProblem.url,
          difficulty: dailyProblem.difficulty,
          date: dailyProblem.date
        });

        const response = await rest.post(Routes.channelMessages(channelId), {
          body: payload
        });
        const messageId = getMessageId(response);

        if (!messageId) {
          logger.warn({ guildId: setting.guildId, channelId }, 'Daily post sent but no message id found');
          continue;
        }

        await db.guildDailyPost.create({
          data: {
            guildId: setting.guildId,
            dailyProblemId: dailyProblem.id,
            messageId
          }
        });
      } catch (error) {
        logger.warn(
          {
            err: error instanceof Error ? error.message : error,
            guildId: setting.guildId,
            channelId
          },
          'Failed to post daily problem to guild channel'
        );
      }
    }
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      'Failed daily posting job'
    );
  }
};

const buildDailyMessagePayload = (problem: {
  title: string;
  url: string;
  difficulty: string;
  date: Date;
}): RESTPostAPIChannelMessageJSONBody => {
  return {
    content: `LeetCode daily challenge for ${problem.date.toISOString().slice(0, 10)}`,
    embeds: [
      {
        title: problem.title,
        url: problem.url,
        fields: [
          {
            name: 'Difficulty',
            value: problem.difficulty,
            inline: true
          },
          {
            name: 'Date',
            value: problem.date.toISOString().slice(0, 10),
            inline: true
          }
        ]
      }
    ]
  };
};

const getMessageId = (response: unknown): string | null => {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const typedResponse = response as Record<string, unknown>;
  return typeof typedResponse.id === 'string' ? typedResponse.id : null;
};
