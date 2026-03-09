import { REST } from '@discordjs/rest';
import { getPrismaClient } from '@leetcord/database';
import { createLogger, toDateOnly } from '@leetcord/shared';
import { RESTPostAPIChannelMessageJSONBody, Routes } from 'discord-api-types/v10';

const logger = createLogger({ name: 'job-post-daily-recap' });

type WorkerDatabaseClient = ReturnType<typeof getPrismaClient>;

export const runPostDailyRecapJob = async (
  db: WorkerDatabaseClient,
  rest: REST
): Promise<void> => {
  try {
    const yesterday = toDateOnly(new Date());
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const yesterdayProblem = await db.dailyProblem.findUnique({
      where: { date: yesterday }
    });

    if (!yesterdayProblem) {
      logger.info('No daily problem found for yesterday, skipping recap');
      return;
    }

    const guildSettings = await db.guildSettings.findMany({
      where: { dailyChannelId: { not: null } },
      select: { guildId: true, dailyChannelId: true }
    });

    for (const setting of guildSettings) {
      const channelId = setting.dailyChannelId;
      if (!channelId) continue;

      try {
        const completions = await db.dailyCompletion.findMany({
          where: {
            dailyProblemId: yesterdayProblem.id,
            completed: true,
            userLink: {
              verified: true,
              guildMemberships: { some: { guildId: setting.guildId } }
            }
          },
          orderBy: { detectedAt: 'asc' },
          include: { userLink: true }
        });

        const streak = await computeGuildStreak(db, setting.guildId, yesterday);

        const payload = buildRecapPayload(
          yesterdayProblem.title,
          yesterdayProblem.url,
          completions.map((c) => ({
            discordUserId: c.userLink.discordUserId,
            leetcodeUsername: c.userLink.leetcodeUsername
          })),
          streak
        );

        await rest.post(Routes.channelMessages(channelId), { body: payload });
      } catch (error) {
        logger.warn(
          {
            err: error instanceof Error ? error.message : error,
            guildId: setting.guildId,
            channelId
          },
          'Failed to post daily recap to guild channel'
        );
      }
    }

    logger.info({ guildCount: guildSettings.length }, 'Posted daily recaps');
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : error },
      'Failed daily recap job'
    );
  }
};

/**
 * Count consecutive days (ending on `endDate`) where at least one guild member
 * completed the daily problem.
 */
const computeGuildStreak = async (
  db: WorkerDatabaseClient,
  guildId: string,
  endDate: Date
): Promise<number> => {
  let streak = 0;
  const checkDate = new Date(endDate);

  // Look back up to 365 days to find the streak
  for (let i = 0; i < 365; i++) {
    const dateOnly = toDateOnly(checkDate);

    const daily = await db.dailyProblem.findUnique({
      where: { date: dateOnly },
      select: { id: true }
    });

    if (!daily) break;

    const completionCount = await db.dailyCompletion.count({
      where: {
        dailyProblemId: daily.id,
        completed: true,
        userLink: {
          verified: true,
          guildMemberships: { some: { guildId } }
        }
      }
    });

    if (completionCount === 0) break;

    streak++;
    checkDate.setUTCDate(checkDate.getUTCDate() - 1);
  }

  return streak;
};

const buildRecapPayload = (
  problemTitle: string,
  problemUrl: string,
  completedUsers: Array<{ discordUserId: string; leetcodeUsername: string }>,
  streak: number
): RESTPostAPIChannelMessageJSONBody => {
  const streakEmoji = streak >= 7 ? '🔥' : streak >= 3 ? '👏' : '📊';
  const header = `**Your group is on a ${streak} day streak!** ${streakEmoji}`;

  let resultLines: string;
  if (completedUsers.length === 0) {
    resultLines = 'No one completed the daily challenge yesterday.';
  } else {
    resultLines = completedUsers
      .map((u) => `✅ <@${u.discordUserId}> (${u.leetcodeUsername})`)
      .join('\n');
  }

  return {
    content: header,
    embeds: [
      {
        title: `Yesterday's Daily: ${problemTitle}`,
        url: problemUrl,
        description: `**Results:**\n${resultLines}`,
        footer: {
          text: `${completedUsers.length} member${completedUsers.length !== 1 ? 's' : ''} completed the daily`
        }
      }
    ]
  };
};
