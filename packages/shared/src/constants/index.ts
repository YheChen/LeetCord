export const DISCORD_COMMANDS = {
  PING: 'ping',
  LINK: 'link',
  VERIFY: 'verify',
  UNLINK: 'unlink',
  ME: 'me',
  DAILY: 'daily',
  LEADERBOARD: 'leaderboard',
  SETUP_DAILY_CHANNEL: 'setup-daily-channel',
  SETUP_TIMEZONE: 'setup-timezone',
  SETUP_LEADERBOARD: 'setup-leaderboard'
} as const;

export const DAILY_POST_CRON_UTC = '5 0 * * *';
export const STATS_REFRESH_CRON = '*/60 * * * *';
export const DAILY_COMPLETION_REFRESH_CRON = '*/10 * * * *';
export const WEEKLY_LEADERBOARD_CRON = '0 1 * * 1';

