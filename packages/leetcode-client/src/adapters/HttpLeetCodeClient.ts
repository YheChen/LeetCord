import fetch, { Response } from 'node-fetch';
import { z } from 'zod';
import {
  LeetCodeDailyProblem,
  LeetCodeDailyProblemSchema,
  LeetCodeProfileStats,
  LeetCodeProfileStatsSchema,
  createLogger,
  toDateOnly
} from '@leetcord/shared';
import { LeetCodeClient } from './LeetCodeClient';

const LEETCODE_BASE_URL = 'https://leetcode.com';
const LEETCODE_GRAPHQL_URL = `${LEETCODE_BASE_URL}/graphql`;
const GRAPHQL_RETRY_ATTEMPTS = 3;
const GRAPHQL_RETRY_BASE_DELAY_MS = 300;
const GRAPHQL_TIMEOUT_MS = 10_000;
const REQUEST_INTERVAL_MS = 400;

const logger = createLogger({ name: 'leetcode-http-client' });

const GraphQLErrorSchema = z.object({
  message: z.string()
});

const GraphQLResponseSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(GraphQLErrorSchema).optional()
});

const SubmissionCountEntrySchema = z.object({
  difficulty: z.string(),
  count: z.union([z.number(), z.string()])
});

const ProfileQueryDataSchema = z.object({
  matchedUser: z
    .object({
      username: z.string(),
      profile: z
        .object({
          aboutMe: z.string().nullable().optional()
        })
        .nullable()
        .optional(),
      submitStatsGlobal: z
        .object({
          acSubmissionNum: z.array(SubmissionCountEntrySchema)
        })
        .nullable()
        .optional(),
      userCalendar: z
        .object({
          streak: z.union([z.number(), z.string()]).nullable().optional()
        })
        .nullable()
        .optional()
    })
    .nullable(),
  userContestRanking: z
    .object({
      rating: z.union([z.number(), z.string()]).nullable().optional()
    })
    .nullable()
    .optional(),
  recentSubmissionList: z
    .array(
      z.object({
        titleSlug: z.string().nullable().optional(),
        timestamp: z.union([z.number(), z.string()]).nullable().optional(),
        statusDisplay: z.string().nullable().optional()
      })
    )
    .nullable()
    .optional()
});

const DailyProblemQueryDataSchema = z.object({
  activeDailyCodingChallengeQuestion: z
    .object({
      date: z.string(),
      link: z.string(),
      question: z
        .object({
          title: z.string(),
          titleSlug: z.string(),
          difficulty: z.string()
        })
        .nullable()
    })
    .nullable()
});

const AboutMeQueryDataSchema = z.object({
  matchedUser: z
    .object({
      profile: z
        .object({
          aboutMe: z.string().nullable().optional()
        })
        .nullable()
        .optional()
    })
    .nullable()
});

const CompletionQueryDataSchema = z.object({
  recentSubmissionList: z
    .array(
      z.object({
        titleSlug: z.string().nullable().optional(),
        statusDisplay: z.string().nullable().optional()
      })
    )
    .nullable()
    .optional()
});

const PROFILE_QUERY = `
  query getUserProfile($username: String!) {
    matchedUser(username: $username) {
      username
      profile {
        aboutMe
      }
      submitStatsGlobal {
        acSubmissionNum {
          difficulty
          count
        }
      }
      userCalendar {
        streak
      }
    }
    userContestRanking(username: $username) {
      rating
    }
    recentSubmissionList(username: $username, limit: 20) {
      titleSlug
      timestamp
      statusDisplay
    }
  }
`;

const DAILY_PROBLEM_QUERY = `
  query questionOfToday {
    activeDailyCodingChallengeQuestion {
      date
      link
      question {
        title
        titleSlug
        difficulty
      }
    }
  }
`;

const ABOUT_ME_QUERY = `
  query getUserBio($username: String!) {
    matchedUser(username: $username) {
      profile {
        aboutMe
      }
    }
  }
`;

const RECENT_SUBMISSIONS_QUERY = `
  query recentAcSubmissions($username: String!, $limit: Int!) {
    recentSubmissionList(username: $username, limit: $limit) {
      titleSlug
      statusDisplay
    }
  }
`;

const ensureOk = async (response: Response): Promise<Response> => {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LeetCode request failed: ${response.status} ${text}`);
  }
  return response;
};

export class HttpLeetCodeClient implements LeetCodeClient {
  private readonly userAgent: string;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(userAgent: string) {
    this.userAgent = userAgent;
  }

  async getProfile(username: string): Promise<LeetCodeProfileStats> {
    try {
      const rawData = await this.executeGraphQL(PROFILE_QUERY, { username }, 'getProfile');
      const data = ProfileQueryDataSchema.parse(rawData);
      const submissionCounts = this.toSolvedCounts(
        data.matchedUser?.submitStatsGlobal?.acSubmissionNum ?? []
      );

      const profile: LeetCodeProfileStats = {
        username: data.matchedUser?.username ?? username,
        totalSolved: submissionCounts.All,
        easySolved: submissionCounts.Easy,
        mediumSolved: submissionCounts.Medium,
        hardSolved: submissionCounts.Hard,
        streakCount: this.toNullableInteger(data.matchedUser?.userCalendar?.streak),
        contestRating: this.toNullableNumber(data.userContestRanking?.rating),
        lastSubmissionAt: this.getLastAcceptedSubmissionDate(data.recentSubmissionList ?? []),
        fetchedAt: new Date()
      };

      return LeetCodeProfileStatsSchema.parse(profile);
    } catch (error) {
      logger.warn(
        {
          err: error instanceof Error ? error.message : error,
          username
        },
        'Failed to fetch profile; returning fallback stats'
      );
      return this.buildFallbackProfile(username);
    }
  }

  async getDailyProblem(): Promise<LeetCodeDailyProblem> {
    try {
      const rawData = await this.executeGraphQL(
        DAILY_PROBLEM_QUERY,
        {},
        'getDailyProblem'
      );
      const data = DailyProblemQueryDataSchema.parse(rawData);
      const activeDaily = data.activeDailyCodingChallengeQuestion;

      if (!activeDaily?.question) {
        throw new Error('Daily problem payload missing question');
      }

      const normalizedDate = this.parseDailyDate(activeDaily.date);
      const difficulty = this.normalizeDifficulty(activeDaily.question.difficulty);
      const url = this.normalizeLeetCodeUrl(activeDaily.link);

      return LeetCodeDailyProblemSchema.parse({
        date: normalizedDate,
        title: activeDaily.question.title,
        slug: activeDaily.question.titleSlug,
        difficulty,
        url,
        fetchedAt: new Date()
      });
    } catch (error) {
      logger.warn(
        {
          err: error instanceof Error ? error.message : error
        },
        'Failed to fetch daily problem; returning fallback'
      );
      return this.buildFallbackDailyProblem();
    }
  }

  async checkVerificationCode(username: string, code: string): Promise<boolean> {
    try {
      const rawData = await this.executeGraphQL(
        ABOUT_ME_QUERY,
        { username },
        'checkVerificationCode'
      );
      const data = AboutMeQueryDataSchema.parse(rawData);
      const aboutMe = data.matchedUser?.profile?.aboutMe ?? '';
      return aboutMe.toLowerCase().includes(code.toLowerCase());
    } catch (error) {
      logger.warn(
        {
          err: error instanceof Error ? error.message : error,
          username
        },
        'Failed to check verification code'
      );
      return false;
    }
  }

  async checkDailyCompletion(username: string, dailySlug: string): Promise<boolean> {
    try {
      const rawData = await this.executeGraphQL(
        RECENT_SUBMISSIONS_QUERY,
        { username, limit: 50 },
        'checkDailyCompletion'
      );
      const data = CompletionQueryDataSchema.parse(rawData);
      const submissions = data.recentSubmissionList ?? [];
      return submissions.some((submission) => {
        const titleSlug = submission.titleSlug ?? '';
        const statusDisplay = submission.statusDisplay ?? '';
        return titleSlug === dailySlug && statusDisplay.toLowerCase().includes('accepted');
      });
    } catch (error) {
      logger.warn(
        {
          err: error instanceof Error ? error.message : error,
          username,
          dailySlug
        },
        'Failed to check daily completion'
      );
      return false;
    }
  }

  async getRecentStats(username: string): Promise<LeetCodeProfileStats> {
    return this.getProfile(username);
  }

  private async executeGraphQL(
    query: string,
    variables: Record<string, unknown>,
    operationName: string
  ): Promise<unknown> {
    return this.withRetry(operationName, async () => {
      const response = await this.rateLimitedRequest(() =>
        this.performGraphQLRequest(query, variables)
      );
      const parsed = GraphQLResponseSchema.parse(response);
      if (parsed.errors && parsed.errors.length > 0) {
        throw new Error(parsed.errors.map((error) => error.message).join('; '));
      }
      if (parsed.data === undefined) {
        throw new Error('GraphQL response missing data field');
      }
      return parsed.data;
    });
  }

  private async performGraphQLRequest(
    query: string,
    variables: Record<string, unknown>
  ): Promise<unknown> {
    const body = JSON.stringify({ query, variables });
    const init: Parameters<typeof fetch>[1] = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': this.userAgent,
        Referer: LEETCODE_BASE_URL
      },
      body
    };

    const response = await this.fetchWithTimeout(LEETCODE_GRAPHQL_URL, init, GRAPHQL_TIMEOUT_MS);
    const okResponse = await ensureOk(response);
    const payload = (await okResponse.json()) as unknown;
    return payload;
  }

  private async fetchWithTimeout(
    input: string,
    init: Parameters<typeof fetch>[1],
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async withRetry<T>(operationName: string, fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt < GRAPHQL_RETRY_ATTEMPTS) {
      try {
        return await fn();
      } catch (error) {
        attempt += 1;
        lastError = error;

        if (attempt >= GRAPHQL_RETRY_ATTEMPTS) {
          break;
        }

        const delayMs = GRAPHQL_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        logger.debug(
          {
            operationName,
            attempt,
            delayMs,
            err: error instanceof Error ? error.message : error
          },
          'LeetCode request failed, retrying'
        );
        await this.sleep(delayMs);
      }
    }

    throw new Error(
      `LeetCode operation "${operationName}" failed after ${GRAPHQL_RETRY_ATTEMPTS} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  private rateLimitedRequest<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      const elapsed = Date.now() - this.lastRequestAt;
      const waitMs = Math.max(0, REQUEST_INTERVAL_MS - elapsed);
      if (waitMs > 0) {
        await this.sleep(waitMs);
      }
      this.lastRequestAt = Date.now();
      return fn();
    });

    this.queue = task.then(
      () => undefined,
      () => undefined
    );

    return task;
  }

  private toSolvedCounts(
    counts: Array<{
      difficulty: string;
      count: number | string;
    }>
  ): Record<'All' | 'Easy' | 'Medium' | 'Hard', number> {
    const result: Record<'All' | 'Easy' | 'Medium' | 'Hard', number> = {
      All: 0,
      Easy: 0,
      Medium: 0,
      Hard: 0
    };

    for (const countEntry of counts) {
      const parsedCount = this.toNullableInteger(countEntry.count) ?? 0;
      if (countEntry.difficulty === 'All') {
        result.All = parsedCount;
      }
      if (countEntry.difficulty === 'Easy') {
        result.Easy = parsedCount;
      }
      if (countEntry.difficulty === 'Medium') {
        result.Medium = parsedCount;
      }
      if (countEntry.difficulty === 'Hard') {
        result.Hard = parsedCount;
      }
    }

    return result;
  }

  private getLastAcceptedSubmissionDate(
    submissions: Array<{
      timestamp?: number | string | null;
      statusDisplay?: string | null;
    }>
  ): Date | null {
    for (const submission of submissions) {
      const statusDisplay = submission.statusDisplay ?? '';
      if (!statusDisplay.toLowerCase().includes('accepted')) {
        continue;
      }
      const parsedDate = this.parseUnixTimestamp(submission.timestamp ?? null);
      if (parsedDate) {
        return parsedDate;
      }
    }
    return null;
  }

  private parseUnixTimestamp(timestamp: number | string | null): Date | null {
    if (timestamp === null) {
      return null;
    }

    const numeric = this.toNullableNumber(timestamp);
    if (numeric === null) {
      return null;
    }

    const seconds = numeric > 1_000_000_000_000 ? numeric / 1000 : numeric;
    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date;
  }

  private parseDailyDate(rawDate: string): Date {
    const parsed = new Date(rawDate);
    if (Number.isNaN(parsed.getTime())) {
      return toDateOnly(new Date());
    }
    return toDateOnly(parsed);
  }

  private normalizeDifficulty(rawDifficulty: string): 'Easy' | 'Medium' | 'Hard' {
    if (rawDifficulty === 'Easy' || rawDifficulty === 'Medium' || rawDifficulty === 'Hard') {
      return rawDifficulty;
    }
    return 'Medium';
  }

  private normalizeLeetCodeUrl(link: string): string {
    if (link.startsWith('http://') || link.startsWith('https://')) {
      return link;
    }
    if (link.startsWith('/')) {
      return `${LEETCODE_BASE_URL}${link}`;
    }
    return `${LEETCODE_BASE_URL}/${link}`;
  }

  private toNullableNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private toNullableInteger(value: unknown): number | null {
    const numeric = this.toNullableNumber(value);
    if (numeric === null) {
      return null;
    }
    return Math.max(0, Math.floor(numeric));
  }

  private buildFallbackProfile(username: string): LeetCodeProfileStats {
    const fallback: LeetCodeProfileStats = {
      username,
      totalSolved: 0,
      easySolved: 0,
      mediumSolved: 0,
      hardSolved: 0,
      streakCount: null,
      contestRating: null,
      lastSubmissionAt: null,
      fetchedAt: new Date()
    };
    return LeetCodeProfileStatsSchema.parse(fallback);
  }

  private buildFallbackDailyProblem(): LeetCodeDailyProblem {
    const date = toDateOnly(new Date());
    const isoDate = date.toISOString().slice(0, 10);
    const fallback: LeetCodeDailyProblem = {
      date,
      title: 'Daily problem unavailable',
      slug: `daily-unavailable-${isoDate}`,
      difficulty: 'Medium',
      url: `${LEETCODE_BASE_URL}/problemset/`,
      fetchedAt: new Date()
    };
    return LeetCodeDailyProblemSchema.parse(fallback);
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
