import { LeetCodeDailyProblem, LeetCodeProfileStats } from '@leetcord/shared';

export interface LeetCodeClient {
  getProfile(username: string): Promise<LeetCodeProfileStats>;
  getDailyProblem(): Promise<LeetCodeDailyProblem>;
  checkVerificationCode(username: string, code: string): Promise<boolean>;
  checkDailyCompletion(username: string, dailySlug: string): Promise<boolean>;
  getRecentStats(username: string): Promise<LeetCodeProfileStats>;
}

