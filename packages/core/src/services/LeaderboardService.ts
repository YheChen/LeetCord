import { PrismaClient } from '@prisma/client';
import {
  DailyCompletionStatus,
  LeaderboardEntry,
  WeeklyLeaderboardSnapshotPayload,
  createLogger,
  startOfWeekUtc,
  toDateOnly
} from '@leetcord/shared';

const logger = createLogger({ name: 'core-leaderboard-service' });

export class LeaderboardService {
  constructor(private readonly db: PrismaClient) {}

  async getTotalSolvedLeaderboardForGuild(guildId: string, limit = 25): Promise<LeaderboardEntry[]> {
    const guildMemberLinks = await this.db.guildMemberLink.findMany({
      where: {
        guildId,
        userLink: {
          verified: true
        }
      },
      include: {
        userLink: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    const result: LeaderboardEntry[] = [];

    for (const memberLink of guildMemberLinks) {
      const link = memberLink.userLink;
      const latestStats = await this.db.userStatsSnapshot.findFirst({
        where: { userLinkId: link.id },
        orderBy: { fetchedAt: 'desc' }
      });

      if (!latestStats) {
        continue;
      }

      result.push({
        discordUserId: link.discordUserId,
        leetcodeUsername: link.leetcodeUsername,
        totalSolved: latestStats.totalSolved,
        easySolved: latestStats.easySolved,
        mediumSolved: latestStats.mediumSolved,
        hardSolved: latestStats.hardSolved
      });
    }

    result.sort((a, b) => b.totalSolved - a.totalSolved);

    logger.debug({ guildId, count: result.length }, 'Computed total leaderboard');

    return result.slice(0, limit);
  }

  async getDailyCompletionLeaderboardForGuild(
    guildId: string,
    limit = 25
  ): Promise<DailyCompletionStatus[]> {
    const today = toDateOnly(new Date());

    const daily = await this.db.dailyProblem.findUnique({
      where: { date: today }
    });

    if (!daily) {
      return [];
    }

    const completions = await this.db.dailyCompletion.findMany({
      where: {
        dailyProblemId: daily.id,
        completed: true,
        userLink: {
          guildMemberships: {
            some: {
              guildId
            }
          }
        }
      },
      take: limit,
      orderBy: { detectedAt: 'asc' },
      include: {
        userLink: true
      }
    });

    return completions.map((completion) => ({
      discordUserId: completion.userLink.discordUserId,
      leetcodeUsername: completion.userLink.leetcodeUsername,
      completed: completion.completed,
      detectedAt: completion.detectedAt
    }));
  }

  async getWeeklyLeaderboardFromSnapshot(
    guildId: string
  ): Promise<WeeklyLeaderboardSnapshotPayload | null> {
    const weekStart = startOfWeekUtc(new Date());

    const snapshot = await this.db.weeklyLeaderboardSnapshot.findFirst({
      where: { guildId, weekStart },
      orderBy: { createdAt: 'desc' }
    });

    if (!snapshot) {
      return null;
    }

    const payload = snapshot.payloadJson;
    if (!isWeeklyLeaderboardSnapshotPayload(payload)) {
      logger.warn({ guildId }, 'Weekly snapshot payload has unexpected shape');
      return null;
    }

    return payload;
  }
}

const isWeeklyLeaderboardSnapshotPayload = (
  payload: unknown
): payload is WeeklyLeaderboardSnapshotPayload => {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const typedPayload = payload as Record<string, unknown>;
  if (
    typeof typedPayload.guildId !== 'string' ||
    typeof typedPayload.weekStart !== 'string' ||
    typeof typedPayload.generatedAt !== 'string' ||
    !Array.isArray(typedPayload.entries)
  ) {
    return false;
  }

  return typedPayload.entries.every((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    const typedEntry = entry as Record<string, unknown>;
    return (
      typeof typedEntry.discordUserId === 'string' &&
      typeof typedEntry.leetcodeUsername === 'string' &&
      typeof typedEntry.solvedDelta === 'number' &&
      typeof typedEntry.baselineTotalSolved === 'number' &&
      typeof typedEntry.latestTotalSolved === 'number'
    );
  });
};
