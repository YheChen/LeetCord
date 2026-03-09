export interface LeaderboardEntry {
  discordUserId: string;
  leetcodeUsername: string;
  totalSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
}

export interface DailyCompletionStatus {
  discordUserId: string;
  leetcodeUsername: string;
  completed: boolean;
  detectedAt: Date | null;
}

export interface WeeklyLeaderboardEntry {
  discordUserId: string;
  leetcodeUsername: string;
  solvedDelta: number;
  baselineTotalSolved: number;
  latestTotalSolved: number;
}

export interface WeeklyLeaderboardSnapshotPayload {
  guildId: string;
  weekStart: string;
  generatedAt: string;
  entries: WeeklyLeaderboardEntry[];
}
