import { DailyProblem, Prisma, PrismaClient, UserLink } from '@prisma/client';
import {
  WeeklyLeaderboardEntry,
  WeeklyLeaderboardSnapshotPayload,
  createLogger,
  startOfWeekUtc,
  toDateOnly,
} from '@leetcord/shared';
import { LeetCodeService } from './LeetCodeService';

const logger = createLogger({ name: 'core-stats-sync-service' });

export interface NewDailyCompletion {
  userLinkId: string;
  discordUserId: string;
  leetcodeUsername: string;
}

export interface DailyCompletionRefreshResult {
  status: 'refreshed' | 'not-linked' | 'daily-not-cached';
  completed: boolean | null;
}

export interface DailyProblemCacheResult {
  status: 'cached' | 'already-cached';
}

export class StatsSyncService {
  private refreshTodayDailyProblemInFlight: Promise<void> | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly leetCodeService: LeetCodeService,
  ) {}

  async refreshUserStatsForAllLinkedUsers(): Promise<void> {
    const links = await this.db.userLink.findMany({
      where: { verified: true },
    });

    for (const link of links) {
      try {
        const stats = await this.leetCodeService.getRecentStats(link.leetcodeUsername);
        await this.db.userStatsSnapshot.create({
          data: {
            userLinkId: link.id,
            totalSolved: stats.totalSolved,
            easySolved: stats.easySolved,
            mediumSolved: stats.mediumSolved,
            hardSolved: stats.hardSolved,
            streakCount: stats.streakCount ?? undefined,
            contestRating: stats.contestRating ?? undefined,
            lastSubmissionAt: stats.lastSubmissionAt ?? undefined,
            fetchedAt: stats.fetchedAt,
          },
        });
      } catch (error) {
        logger.warn(
          {
            err: error instanceof Error ? error.message : error,
            discordUserId: link.discordUserId,
          },
          'Failed to refresh user stats',
        );
      }
    }
  }

  async refreshTodayDailyProblem(): Promise<void> {
    const daily = await this.leetCodeService.getDailyProblem();
    const date = toDateOnly(daily.date);

    await this.db.dailyProblem.upsert({
      where: { date },
      update: {
        title: daily.title,
        slug: daily.slug,
        difficulty: daily.difficulty,
        url: daily.url,
        fetchedAt: daily.fetchedAt,
      },
      create: {
        date,
        title: daily.title,
        slug: daily.slug,
        difficulty: daily.difficulty,
        url: daily.url,
        fetchedAt: daily.fetchedAt,
      },
    });
  }

  async ensureTodayDailyProblemCached(): Promise<DailyProblemCacheResult> {
    const today = toDateOnly(new Date());
    const existing = await this.db.dailyProblem.findUnique({
      where: { date: today },
    });

    if (existing) {
      return {
        status: 'already-cached',
      };
    }

    await this.refreshTodayDailyProblemDeduped();

    return {
      status: 'cached',
    };
  }

  async refreshDailyCompletionForAllUsers(): Promise<NewDailyCompletion[]> {
    const newlyCompleted: NewDailyCompletion[] = [];
    const today = toDateOnly(new Date());
    const daily = await this.db.dailyProblem.findUnique({
      where: { date: today },
    });

    if (!daily) {
      return newlyCompleted;
    }

    const links = await this.db.userLink.findMany({
      where: { verified: true },
    });

    for (const link of links) {
      try {
        const { isNewCompletion } = await this.refreshDailyCompletionForLink(link, daily, 'worker');

        if (isNewCompletion) {
          newlyCompleted.push({
            userLinkId: link.id,
            discordUserId: link.discordUserId,
            leetcodeUsername: link.leetcodeUsername,
          });
        }
      } catch (error) {
        logger.warn(
          {
            err: error instanceof Error ? error.message : error,
            discordUserId: link.discordUserId,
          },
          'Failed to refresh daily completion',
        );
      }
    }

    return newlyCompleted;
  }

  async refreshDailyCompletionForDiscordUser(
    discordUserId: string,
  ): Promise<DailyCompletionRefreshResult> {
    const today = toDateOnly(new Date());
    const [daily, link] = await Promise.all([
      this.db.dailyProblem.findUnique({
        where: { date: today },
      }),
      this.db.userLink.findUnique({
        where: { discordUserId },
      }),
    ]);

    if (!daily) {
      return {
        status: 'daily-not-cached',
        completed: null,
      };
    }

    if (!link?.verified) {
      return {
        status: 'not-linked',
        completed: null,
      };
    }

    const { completed } = await this.refreshDailyCompletionForLink(link, daily, 'api');

    return {
      status: 'refreshed',
      completed,
    };
  }

  async computeWeeklyLeaderboardSnapshotForGuild(guildId: string): Promise<void> {
    const weekStart = startOfWeekUtc(new Date());
    const guildMemberLinks = await this.db.guildMemberLink.findMany({
      where: {
        guildId,
        userLink: {
          verified: true,
        },
      },
      include: {
        userLink: true,
      },
    });

    const entries: WeeklyLeaderboardEntry[] = [];

    for (const memberLink of guildMemberLinks) {
      const link = memberLink.userLink;
      const [baselineSnapshot, latestSnapshot] = await Promise.all([
        this.db.userStatsSnapshot.findFirst({
          where: {
            userLinkId: link.id,
            fetchedAt: {
              lte: weekStart,
            },
          },
          orderBy: { fetchedAt: 'desc' },
        }),
        this.db.userStatsSnapshot.findFirst({
          where: { userLinkId: link.id },
          orderBy: { fetchedAt: 'desc' },
        }),
      ]);

      if (!latestSnapshot) {
        continue;
      }

      const baselineTotalSolved = baselineSnapshot?.totalSolved ?? 0;
      const solvedDelta = Math.max(0, latestSnapshot.totalSolved - baselineTotalSolved);

      entries.push({
        discordUserId: link.discordUserId,
        leetcodeUsername: link.leetcodeUsername,
        solvedDelta,
        baselineTotalSolved,
        latestTotalSolved: latestSnapshot.totalSolved,
      });
    }

    entries.sort((a, b) => {
      if (b.solvedDelta !== a.solvedDelta) {
        return b.solvedDelta - a.solvedDelta;
      }
      return b.latestTotalSolved - a.latestTotalSolved;
    });

    const payload: WeeklyLeaderboardSnapshotPayload = {
      guildId,
      weekStart: weekStart.toISOString(),
      generatedAt: new Date().toISOString(),
      entries,
    };

    await this.db.weeklyLeaderboardSnapshot.create({
      data: {
        guildId,
        weekStart,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
      },
    });
  }

  private async refreshDailyCompletionForLink(
    link: UserLink,
    daily: DailyProblem,
    source: string,
  ): Promise<{ completed: boolean; isNewCompletion: boolean }> {
    const completed = await this.leetCodeService.checkDailyCompletion(
      link.leetcodeUsername,
      daily.slug,
    );

    const existing = await this.db.dailyCompletion.findUnique({
      where: {
        userLinkId_dailyProblemId: {
          userLinkId: link.id,
          dailyProblemId: daily.id,
        },
      },
    });

    const detectedAt = new Date();
    const isNewCompletion = completed && (!existing || !existing.completed);

    await this.db.dailyCompletion.upsert({
      where: {
        userLinkId_dailyProblemId: {
          userLinkId: link.id,
          dailyProblemId: daily.id,
        },
      },
      update: {
        completed,
        detectedAt,
        source,
      },
      create: {
        userLinkId: link.id,
        dailyProblemId: daily.id,
        completed,
        detectedAt,
        source,
      },
    });

    return {
      completed,
      isNewCompletion,
    };
  }

  private async refreshTodayDailyProblemDeduped(): Promise<void> {
    if (!this.refreshTodayDailyProblemInFlight) {
      this.refreshTodayDailyProblemInFlight = this.refreshTodayDailyProblem().finally(() => {
        this.refreshTodayDailyProblemInFlight = null;
      });
    }

    await this.refreshTodayDailyProblemInFlight;
  }
}
