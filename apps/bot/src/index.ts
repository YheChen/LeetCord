import 'dotenv/config';
import { getPrismaClient } from '@leetcord/database';
import {
  GuildMembershipService,
  GuildSettingsService,
  LeaderboardService,
  LeetCodeService,
  LinkService
} from '@leetcord/core';
import { createLeetCodeClient } from '@leetcord/leetcode-client';
import { createLogger } from '@leetcord/shared';
import { loadBotEnv } from './config/env';
import {
  createCoreButtonHandlers,
  createCoreSlashCommands,
  DiscordBotService,
} from './services/DiscordBotService';

const logger = createLogger({ name: 'bot-main' });

const main = async (): Promise<void> => {
  const env = loadBotEnv();
  const db = getPrismaClient();
  const leetCodeClient = createLeetCodeClient(env.LEETCODE_FETCH_USER_AGENT);
  const leetCodeService = new LeetCodeService(leetCodeClient);
  const linkService = new LinkService(db, leetCodeService);
  const guildMembershipService = new GuildMembershipService(db);
  const guildSettingsService = new GuildSettingsService(db);
  const leaderboardService = new LeaderboardService(db);

  const commands = createCoreSlashCommands({
    db,
    linkService,
    guildMembershipService,
    guildSettingsService,
    leaderboardService
  });
  const buttonHandlers = createCoreButtonHandlers({
    db,
    linkService,
    guildMembershipService,
    guildSettingsService,
    leaderboardService
  });
  const bot = new DiscordBotService(env, commands, buttonHandlers);

  await bot.registerSlashCommands();
  await bot.start();
};

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Bot failed to start');
  process.exit(1);
});
