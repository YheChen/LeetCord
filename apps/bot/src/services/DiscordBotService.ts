import { REST } from '@discordjs/rest';
import { getPrismaClient } from '@leetcord/database';
import {
  GuildMembershipService,
  GuildSettingsService,
  LeaderboardService,
  LinkService,
} from '@leetcord/core';
import {
  DISCORD_COMMANDS,
  LeetCodeDailyProblem,
  LeetCodeProfileStats,
  WeeklyLeaderboardSnapshotPayload,
  createLogger,
  toDateOnly,
} from '@leetcord/shared';
import { Routes } from 'discord-api-types/v10';
import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Collection,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import type { BotEnv } from '../config/env';
import { buildDailyProblemEmbed, buildUserStatsEmbed } from '../embeds';

type BotDatabaseClient = ReturnType<typeof getPrismaClient>;

interface BotCommandServices {
  db: BotDatabaseClient;
  linkService: LinkService;
  guildMembershipService: GuildMembershipService;
  guildSettingsService: GuildSettingsService;
  leaderboardService: LeaderboardService;
}

export interface SlashCommand {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export class DiscordBotService {
  private readonly client: Client;
  private readonly rest: REST;
  private readonly logger = createLogger({ name: 'bot' });
  private readonly commands = new Collection<string, SlashCommand>();

  constructor(
    private readonly env: BotEnv,
    commands: SlashCommand[],
  ) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds],
    });
    this.rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

    commands.forEach((command) => {
      this.commands.set(command.data.name, command);
    });

    this.registerEventHandlers();
  }

  async registerSlashCommands(): Promise<void> {
    const body = this.commands.map((command) => command.data.toJSON());

    const route =
      this.env.DISCORD_GUILD_ID !== undefined
        ? Routes.applicationGuildCommands(this.env.DISCORD_CLIENT_ID, this.env.DISCORD_GUILD_ID)
        : Routes.applicationCommands(this.env.DISCORD_CLIENT_ID);

    await this.rest.put(route, { body });
    this.logger.info(
      { count: body.length, guildId: this.env.DISCORD_GUILD_ID ?? 'global' },
      'Registered slash commands',
    );
  }

  async start(): Promise<void> {
    await this.client.login(this.env.DISCORD_TOKEN);
  }

  private registerEventHandlers(): void {
    this.client.once(Events.ClientReady, (client) => {
      this.logger.info({ tag: client.user.tag }, 'Bot ready');
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) {
        return;
      }

      const command = this.commands.get(interaction.commandName);
      if (!command) {
        this.logger.warn({ commandName: interaction.commandName }, 'Unknown command');
        await interaction.reply({
          content: 'Unknown command.',
          ephemeral: true,
        });
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        this.logger.error(
          { err: error instanceof Error ? error.message : error },
          'Command execution failed',
        );
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({
            content: 'Something went wrong while executing that command.',
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: 'Something went wrong while executing that command.',
            ephemeral: true,
          });
        }
      }
    });
  }
}

export const createCoreSlashCommands = (services: BotCommandServices): SlashCommand[] => {
  const commandLogger = createLogger({ name: 'bot-commands' });

  const ensureGuildMembership = async (
    interaction: ChatInputCommandInteraction,
    discordUserId: string,
  ): Promise<void> => {
    if (!interaction.guildId) {
      return;
    }

    try {
      await services.guildMembershipService.ensureMembershipForDiscordUser(
        discordUserId,
        interaction.guildId,
      );
    } catch (error) {
      commandLogger.warn(
        {
          err: error instanceof Error ? error.message : error,
          guildId: interaction.guildId,
          discordUserId,
        },
        'Failed to ensure guild membership mapping',
      );
    }
  };

  const ping = new SlashCommandBuilder()
    .setName(DISCORD_COMMANDS.PING)
    .setDescription('Check if the bot is alive');

  const link = new SlashCommandBuilder()
    .setName(DISCORD_COMMANDS.LINK)
    .setDescription('Link your LeetCode account')
    .addStringOption((option) =>
      option.setName('username').setDescription('Your LeetCode username').setRequired(true),
    );

  const verify = new SlashCommandBuilder()
    .setName(DISCORD_COMMANDS.VERIFY)
    .setDescription('Verify your linked LeetCode account');

  const unlink = new SlashCommandBuilder()
    .setName(DISCORD_COMMANDS.UNLINK)
    .setDescription('Unlink your LeetCode account');

  const me = new SlashCommandBuilder()
    .setName(DISCORD_COMMANDS.ME)
    .setDescription('Show LeetCode stats')
    .addUserOption((option) =>
      option.setName('user').setDescription('User to inspect (defaults to yourself)'),
    );

  const daily = new SlashCommandBuilder()
    .setName(DISCORD_COMMANDS.DAILY)
    .setDescription("Show today's LeetCode daily problem");

  const leaderboard = new SlashCommandBuilder()
    .setName(DISCORD_COMMANDS.LEADERBOARD)
    .setDescription('Show leaderboard')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Leaderboard mode')
        .setRequired(true)
        .addChoices(
          { name: 'Total solved', value: 'total' },
          { name: 'Weekly delta', value: 'weekly' },
          { name: 'Daily completion', value: 'daily' },
        ),
    );

  const setupDailyChannel = new SlashCommandBuilder()
    .setName(DISCORD_COMMANDS.SETUP_DAILY_CHANNEL)
    .setDescription('Set the daily problem channel')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Channel to post daily problems')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    );

  const setupTimezone = new SlashCommandBuilder()
    .setName(DISCORD_COMMANDS.SETUP_TIMEZONE)
    .setDescription('Set timezone for guild schedules')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName('timezone')
        .setDescription('IANA timezone, e.g. America/Toronto')
        .setRequired(true),
    );

  const streak = new SlashCommandBuilder()
    .setName(DISCORD_COMMANDS.STREAK)
    .setDescription('Show your daily problem completion streak')
    .addUserOption((option) =>
      option.setName('user').setDescription('User to inspect (defaults to yourself)'),
    );

  const setupLeaderboard = new SlashCommandBuilder()
    .setName(DISCORD_COMMANDS.SETUP_LEADERBOARD)
    .setDescription('Enable or disable leaderboard commands')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addBooleanOption((option) =>
      option.setName('enabled').setDescription('Whether leaderboard is enabled').setRequired(true),
    );

  const commands: SlashCommand[] = [
    {
      data: ping,
      execute: async (interaction) => {
        await interaction.reply({ content: 'Pong!', ephemeral: true });
      },
    },
    {
      data: link,
      execute: async (interaction) => {
        const username = interaction.options.getString('username', true).trim();
        const { verificationCode, expiresAt } = await services.linkService.createVerification(
          interaction.user.id,
          username,
        );
        const expiresUnix = Math.floor(expiresAt.getTime() / 1000);

        await interaction.reply({
          content: [
            `Linking started for \`${username}\`.`,
            `1. Put this code in your LeetCode profile bio: \`${verificationCode}\``,
            '2. Save your profile bio.',
            `3. Run \`/${DISCORD_COMMANDS.VERIFY}\` before <t:${expiresUnix}:F>.`,
          ].join('\n'),
          ephemeral: true,
        });
      },
    },
    {
      data: verify,
      execute: async (interaction) => {
        const verified = await services.linkService.verifyUser(interaction.user.id);
        if (verified) {
          await ensureGuildMembership(interaction, interaction.user.id);
          await interaction.reply({
            content: 'Verification successful. Your Discord account is now linked to LeetCode.',
            ephemeral: true,
          });
          return;
        }

        const linkRow = await services.db.userLink.findUnique({
          where: { discordUserId: interaction.user.id },
        });

        if (!linkRow) {
          await interaction.reply({
            content: `No pending link found. Start with \`/${DISCORD_COMMANDS.LINK} username:<your_username>\`.`,
            ephemeral: true,
          });
          return;
        }

        if (linkRow.verificationExpiresAt && linkRow.verificationExpiresAt.getTime() < Date.now()) {
          await interaction.reply({
            content: `Your verification code expired. Run \`/${DISCORD_COMMANDS.LINK}\` again to generate a new one.`,
            ephemeral: true,
          });
          return;
        }

        await interaction.reply({
          content:
            'Verification failed. Make sure the code is in your LeetCode bio, then try again in a minute.',
          ephemeral: true,
        });
      },
    },
    {
      data: unlink,
      execute: async (interaction) => {
        const existing = await services.db.userLink.findUnique({
          where: { discordUserId: interaction.user.id },
        });
        if (!existing) {
          await interaction.reply({
            content: 'You do not have a linked LeetCode account.',
            ephemeral: true,
          });
          return;
        }

        await services.linkService.unlinkUser(interaction.user.id);
        await interaction.reply({
          content: `Unlinked \`${existing.leetcodeUsername}\` from your Discord account.`,
          ephemeral: true,
        });
      },
    },
    {
      data: me,
      execute: async (interaction) => {
        const targetUser = interaction.options.getUser('user') ?? interaction.user;
        const userLink = await services.db.userLink.findUnique({
          where: { discordUserId: targetUser.id },
        });

        if (!userLink?.verified) {
          await interaction.reply({
            content:
              targetUser.id === interaction.user.id
                ? `You are not linked yet. Run \`/${DISCORD_COMMANDS.LINK}\` first.`
                : `${targetUser.username} is not linked yet.`,
            ephemeral: true,
          });
          return;
        }

        const latestSnapshot = await services.db.userStatsSnapshot.findFirst({
          where: { userLinkId: userLink.id },
          orderBy: { fetchedAt: 'desc' },
        });

        if (!latestSnapshot) {
          await interaction.reply({
            content: 'No cached stats found yet. Try again after the worker refreshes stats.',
            ephemeral: true,
          });
          return;
        }

        await ensureGuildMembership(interaction, targetUser.id);

        const stats: LeetCodeProfileStats = {
          username: userLink.leetcodeUsername,
          totalSolved: latestSnapshot.totalSolved,
          easySolved: latestSnapshot.easySolved,
          mediumSolved: latestSnapshot.mediumSolved,
          hardSolved: latestSnapshot.hardSolved,
          streakCount: latestSnapshot.streakCount ?? null,
          contestRating: latestSnapshot.contestRating ?? null,
          lastSubmissionAt: latestSnapshot.lastSubmissionAt ?? null,
          fetchedAt: latestSnapshot.fetchedAt,
        };

        const embed = buildUserStatsEmbed(stats);
        const todayDaily = await services.db.dailyProblem.findUnique({
          where: { date: toDateOnly(new Date()) },
        });

        if (todayDaily) {
          const completion = await services.db.dailyCompletion.findUnique({
            where: {
              userLinkId_dailyProblemId: {
                userLinkId: userLink.id,
                dailyProblemId: todayDaily.id,
              },
            },
          });

          embed.addFields({
            name: "Today's Daily",
            value: completion?.completed ? 'Completed' : 'Not completed',
            inline: true,
          });
        }

        await interaction.reply({
          embeds: [embed],
          ephemeral: targetUser.id === interaction.user.id,
        });
      },
    },
    {
      data: daily,
      execute: async (interaction) => {
        const today = toDateOnly(new Date());
        const dailyProblem = await services.db.dailyProblem.findUnique({
          where: { date: today },
        });

        if (!dailyProblem) {
          await interaction.reply({
            content: "Today's daily problem is not cached yet. Try again shortly.",
            ephemeral: true,
          });
          return;
        }

        let completionText = 'Not linked';
        const callerLink = await services.db.userLink.findUnique({
          where: { discordUserId: interaction.user.id },
        });

        if (callerLink?.verified) {
          await ensureGuildMembership(interaction, interaction.user.id);
          const completion = await services.db.dailyCompletion.findUnique({
            where: {
              userLinkId_dailyProblemId: {
                userLinkId: callerLink.id,
                dailyProblemId: dailyProblem.id,
              },
            },
          });
          completionText = completion?.completed ? 'Completed' : 'Not completed';
        }

        const mappedDailyProblem: LeetCodeDailyProblem = {
          date: dailyProblem.date,
          title: dailyProblem.title,
          slug: dailyProblem.slug,
          difficulty: normalizeDifficulty(dailyProblem.difficulty),
          url: dailyProblem.url,
          fetchedAt: dailyProblem.fetchedAt,
        };

        const embed = buildDailyProblemEmbed(mappedDailyProblem, completionText);

        await interaction.reply({
          embeds: [embed],
        });
      },
    },
    {
      data: leaderboard,
      execute: async (interaction) => {
        if (!interaction.guildId) {
          await interaction.reply({
            content: 'This command can only be used in a server.',
            ephemeral: true,
          });
          return;
        }

        const guildSettings = await services.guildSettingsService.getOrCreateGuildSettings(
          interaction.guildId,
        );
        if (!guildSettings.leaderboardEnabled) {
          await interaction.reply({
            content:
              'Leaderboard is disabled in this server. An admin can re-enable it with `/setup-leaderboard`.',
            ephemeral: true,
          });
          return;
        }

        const mode = interaction.options.getString('mode', true);
        await ensureGuildMembership(interaction, interaction.user.id);

        if (mode === 'total') {
          const entries = await services.leaderboardService.getTotalSolvedLeaderboardForGuild(
            interaction.guildId,
          );
          if (entries.length === 0) {
            await interaction.reply({ content: 'No leaderboard data yet.' });
            return;
          }

          const embed = new EmbedBuilder().setTitle('Total Solved Leaderboard').setDescription(
            entries
              .slice(0, 15)
              .map(
                (entry, index) =>
                  `${index + 1}. <@${entry.discordUserId}> (\`${entry.leetcodeUsername}\`) - **${entry.totalSolved}** solved`,
              )
              .join('\n'),
          );
          await interaction.reply({ embeds: [embed] });
          return;
        }

        if (mode === 'daily') {
          const entries = await services.leaderboardService.getDailyCompletionLeaderboardForGuild(
            interaction.guildId,
          );
          if (entries.length === 0) {
            await interaction.reply({ content: 'No daily completions recorded yet for today.' });
            return;
          }

          const embed = new EmbedBuilder()
            .setTitle("Today's Daily Completion Leaderboard")
            .setDescription(
              entries
                .slice(0, 25)
                .map(
                  (entry, index) =>
                    `${index + 1}. <@${entry.discordUserId}> (\`${entry.leetcodeUsername}\`)`,
                )
                .join('\n'),
            );
          await interaction.reply({ embeds: [embed] });
          return;
        }

        const snapshot = await services.leaderboardService.getWeeklyLeaderboardFromSnapshot(
          interaction.guildId,
        );
        if (!snapshot) {
          await interaction.reply({
            content: 'No weekly snapshot available yet. Wait for the weekly worker job to run.',
          });
          return;
        }

        await interaction.reply({
          embeds: [buildWeeklyLeaderboardEmbed(snapshot)],
        });
      },
    },
    {
      data: setupDailyChannel,
      execute: async (interaction) => {
        if (!interaction.guildId) {
          await interaction.reply({
            content: 'This command can only be used in a server.',
            ephemeral: true,
          });
          return;
        }

        const channel = interaction.options.getChannel('channel', true);
        if (
          channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildAnnouncement
        ) {
          await interaction.reply({
            content: 'Please select a text or announcement channel.',
            ephemeral: true,
          });
          return;
        }

        await services.guildSettingsService.updateDailyChannel(interaction.guildId, channel.id);
        await interaction.reply({
          content: `Daily problem channel set to <#${channel.id}>.`,
          ephemeral: true,
        });
      },
    },
    {
      data: setupTimezone,
      execute: async (interaction) => {
        if (!interaction.guildId) {
          await interaction.reply({
            content: 'This command can only be used in a server.',
            ephemeral: true,
          });
          return;
        }

        const timezone = interaction.options.getString('timezone', true).trim();
        if (!isValidIanaTimezone(timezone)) {
          await interaction.reply({
            content:
              'Invalid timezone. Use a valid IANA timezone like `America/Toronto` or `Asia/Tokyo`.',
            ephemeral: true,
          });
          return;
        }

        await services.guildSettingsService.updateTimezone(interaction.guildId, timezone);
        await interaction.reply({
          content: `Timezone set to \`${timezone}\`.`,
          ephemeral: true,
        });
      },
    },
    {
      data: streak,
      execute: async (interaction) => {
        const targetUser = interaction.options.getUser('user') ?? interaction.user;
        const userLink = await services.db.userLink.findUnique({
          where: { discordUserId: targetUser.id },
        });

        if (!userLink?.verified) {
          await interaction.reply({
            content:
              targetUser.id === interaction.user.id
                ? `You are not linked yet. Run \`/${DISCORD_COMMANDS.LINK}\` first.`
                : `${targetUser.username} is not linked yet.`,
            ephemeral: true,
          });
          return;
        }

        await ensureGuildMembership(interaction, targetUser.id);

        // Fetch all daily completions for this user, ordered by date
        const completions = await services.db.dailyCompletion.findMany({
          where: {
            userLinkId: userLink.id,
            completed: true,
          },
          include: { dailyProblem: { select: { date: true } } },
          orderBy: { dailyProblem: { date: 'desc' } },
        });

        const completedDates = completions
          .map((c) => toDateOnly(c.dailyProblem.date).getTime())
          .sort((a, b) => b - a); // newest first

        // Remove duplicates
        const uniqueDates = [...new Set(completedDates)];

        // Compute current streak (consecutive days ending today or yesterday)
        const today = toDateOnly(new Date()).getTime();
        const oneDay = 86400000;
        let currentStreak = 0;
        // Allow streak to start from today or yesterday
        let cursor =
          uniqueDates.length > 0 && (uniqueDates[0] === today || uniqueDates[0] === today - oneDay)
            ? uniqueDates[0]
            : -1;

        if (cursor !== -1) {
          for (const dateMs of uniqueDates) {
            if (dateMs === cursor) {
              currentStreak++;
              cursor -= oneDay;
            } else if (dateMs < cursor) {
              break;
            }
          }
        }

        // Compute longest streak ever
        let longestStreak = 0;
        let runningStreak = 0;
        let prevDate = -1;
        // Walk dates oldest-first for longest streak
        const oldestFirst = [...uniqueDates].reverse();
        for (const dateMs of oldestFirst) {
          if (prevDate === -1 || dateMs === prevDate + oneDay) {
            runningStreak++;
          } else {
            runningStreak = 1;
          }
          if (runningStreak > longestStreak) {
            longestStreak = runningStreak;
          }
          prevDate = dateMs;
        }

        const totalCompleted = uniqueDates.length;

        const streakEmoji = currentStreak >= 7 ? '🔥' : currentStreak >= 3 ? '👏' : '📊';

        const embed = new EmbedBuilder()
          .setTitle(`Daily Streak for ${userLink.leetcodeUsername}`)
          .addFields(
            {
              name: 'Current Streak',
              value: `${currentStreak} day${currentStreak !== 1 ? 's' : ''} ${streakEmoji}`,
              inline: true,
            },
            {
              name: 'Longest Streak',
              value: `${longestStreak} day${longestStreak !== 1 ? 's' : ''}`,
              inline: true,
            },
            { name: 'Total Dailies Completed', value: `${totalCompleted}`, inline: true },
          );

        await interaction.reply({
          embeds: [embed],
          ephemeral: targetUser.id === interaction.user.id,
        });
      },
    },
    {
      data: setupLeaderboard,
      execute: async (interaction) => {
        if (!interaction.guildId) {
          await interaction.reply({
            content: 'This command can only be used in a server.',
            ephemeral: true,
          });
          return;
        }

        const enabled = interaction.options.getBoolean('enabled', true);
        await services.guildSettingsService.setLeaderboardEnabled(interaction.guildId, enabled);
        await interaction.reply({
          content: `Leaderboard is now ${enabled ? 'enabled' : 'disabled'} for this server.`,
          ephemeral: true,
        });
      },
    },
  ];

  return commands;
};

const buildWeeklyLeaderboardEmbed = (snapshot: WeeklyLeaderboardSnapshotPayload): EmbedBuilder => {
  const weekStart = snapshot.weekStart.slice(0, 10);
  const entries = snapshot.entries.slice(0, 15);

  const description =
    entries.length > 0
      ? entries
          .map(
            (entry, index) =>
              `${index + 1}. <@${entry.discordUserId}> (\`${entry.leetcodeUsername}\`) - **+${
                entry.solvedDelta
              }** this week`,
          )
          .join('\n')
      : 'No progress captured yet this week.';

  return new EmbedBuilder()
    .setTitle('Weekly Leaderboard')
    .setDescription(description)
    .setFooter({ text: `Week start (UTC): ${weekStart}` });
};

const isValidIanaTimezone = (timezone: string): boolean => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return formatter.resolvedOptions().timeZone === timezone;
  } catch {
    return false;
  }
};

const normalizeDifficulty = (difficulty: string): 'Easy' | 'Medium' | 'Hard' => {
  if (difficulty === 'Easy' || difficulty === 'Medium' || difficulty === 'Hard') {
    return difficulty;
  }
  return 'Medium';
};
