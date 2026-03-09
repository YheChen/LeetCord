import { z } from 'zod';

export const LeetCodeProfileStatsSchema = z.object({
  username: z.string(),
  totalSolved: z.number().int().nonnegative(),
  easySolved: z.number().int().nonnegative(),
  mediumSolved: z.number().int().nonnegative(),
  hardSolved: z.number().int().nonnegative(),
  streakCount: z.number().int().nonnegative().nullable(),
  contestRating: z.number().nonnegative().nullable(),
  lastSubmissionAt: z.date().nullable(),
  fetchedAt: z.date()
});

export const LeetCodeDailyProblemSchema = z.object({
  date: z.date(),
  title: z.string(),
  slug: z.string(),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  url: z.string().url(),
  fetchedAt: z.date()
});

