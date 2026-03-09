import { LeetCodeClient } from '@leetcord/leetcode-client';
import {
  LeetCodeDailyProblem,
  LeetCodeProfileStats,
  createLogger,
  toDateOnly
} from '@leetcord/shared';

const logger = createLogger({ name: 'core-leetcode-service' });

export class LeetCodeService {
  constructor(private readonly client: LeetCodeClient) {}

  async getProfile(username: string): Promise<LeetCodeProfileStats> {
    const profile = await this.client.getProfile(username);
    return profile;
  }

  async getDailyProblem(): Promise<LeetCodeDailyProblem> {
    const daily = await this.client.getDailyProblem();
    const normalizedDate = toDateOnly(daily.date);
    return { ...daily, date: normalizedDate };
  }

  async checkVerificationCode(username: string, code: string): Promise<boolean> {
    try {
      return await this.client.checkVerificationCode(username, code);
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : error, username },
        'Failed to check verification code; treating as not verified'
      );
      return false;
    }
  }

  async checkDailyCompletion(username: string, dailySlug: string): Promise<boolean> {
    try {
      return await this.client.checkDailyCompletion(username, dailySlug);
    } catch (error) {
      logger.warn(
        { err: error instanceof Error ? error.message : error, username, dailySlug },
        'Failed to check daily completion; treating as not completed'
      );
      return false;
    }
  }

  async getRecentStats(username: string): Promise<LeetCodeProfileStats> {
    return this.client.getRecentStats(username);
  }
}

