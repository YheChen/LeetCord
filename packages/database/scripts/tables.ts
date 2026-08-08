/**
 * Shared table manifest for the one-off Supabase Postgres -> SQLite migration.
 *
 * Order matters: rows are imported top to bottom so a child row is never written
 * before the parent it references. SQLite enforces foreign keys, so getting this
 * wrong surfaces as a constraint failure rather than silent corruption.
 */

export interface TableSpec {
  /** Model name as it appears in schema.prisma, used for logging and the export payload. */
  model: string;
  /** Property name on the Prisma client (camelCased model). */
  delegate: string;
  /** Fields that come back as Date and must be revived from ISO strings on import. */
  dateFields: string[];
  /** Fields that are Json in Postgres but String in SQLite; stringified on import. */
  jsonFields: string[];
}

export const TABLES: TableSpec[] = [
  // --- No foreign keys; must land first ---
  {
    model: 'UserLink',
    delegate: 'userLink',
    dateFields: ['verificationExpiresAt', 'createdAt', 'updatedAt'],
    jsonFields: [],
  },
  {
    model: 'GuildSettings',
    delegate: 'guildSettings',
    dateFields: ['createdAt', 'updatedAt'],
    jsonFields: [],
  },
  {
    model: 'DailyProblem',
    delegate: 'dailyProblem',
    dateFields: ['date', 'fetchedAt'],
    jsonFields: [],
  },
  {
    model: 'WeeklyLeaderboardSnapshot',
    delegate: 'weeklyLeaderboardSnapshot',
    dateFields: ['weekStart', 'createdAt'],
    jsonFields: ['payloadJson'],
  },

  // --- Reference UserLink and/or DailyProblem ---
  {
    model: 'GuildMemberLink',
    delegate: 'guildMemberLink',
    dateFields: ['createdAt'],
    jsonFields: [],
  },
  {
    model: 'UserStatsSnapshot',
    delegate: 'userStatsSnapshot',
    dateFields: ['lastSubmissionAt', 'fetchedAt'],
    jsonFields: [],
  },
  {
    model: 'DailyCompletion',
    delegate: 'dailyCompletion',
    dateFields: ['detectedAt'],
    jsonFields: [],
  },
  {
    model: 'GuildDailyPost',
    delegate: 'guildDailyPost',
    dateFields: ['postedAt'],
    jsonFields: [],
  },
];

export type Row = Record<string, unknown>;

export interface ExportPayload {
  exportedAt: string;
  source: string;
  tables: Record<string, Row[]>;
}

/**
 * Minimal shape we need from a Prisma delegate. Avoids depending on either
 * generated client's types, since this file is shared by both scripts.
 */
export interface MinimalDelegate {
  findMany(args?: unknown): Promise<Row[]>;
  upsert(args: unknown): Promise<unknown>;
  count(): Promise<number>;
}

export const delegateFor = (client: unknown, spec: TableSpec): MinimalDelegate => {
  const delegate = (client as Record<string, MinimalDelegate | undefined>)[spec.delegate];
  if (!delegate) {
    throw new Error(`Prisma client has no delegate "${spec.delegate}" for model ${spec.model}`);
  }
  return delegate;
};

export const resolveOutputPath = (argv: string[], fallback: string): string => {
  const flagIndex = argv.indexOf('--file');
  if (flagIndex !== -1) {
    const value = argv[flagIndex + 1];
    if (!value) {
      throw new Error('--file requires a path argument');
    }
    return value;
  }
  return process.env.MIGRATION_FILE ?? fallback;
};
