export type LeetCodeDifficulty = 'Easy' | 'Medium' | 'Hard';

export interface LeetCodeProfileStats {
  username: string;
  totalSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  streakCount: number | null;
  contestRating: number | null;
  lastSubmissionAt: Date | null;
  fetchedAt: Date;
}

export interface LeetCodeDailyProblem {
  date: Date;
  title: string;
  slug: string;
  difficulty: LeetCodeDifficulty;
  url: string;
  fetchedAt: Date;
}

