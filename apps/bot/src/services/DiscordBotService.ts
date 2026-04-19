import { REST } from '@discordjs/rest';
import { getPrismaClient } from '@leetcord/database';
import {
  AlreadyLinkedError,
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
  formatDailyCompletionAnnouncement,
  toDateOnly,
} from '@leetcord/shared';
import { Routes } from 'discord-api-types/v10';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
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
  botPublicUrl: string;
  linkService: LinkService;
  guildMembershipService: GuildMembershipService;
  guildSettingsService: GuildSettingsService;
  leaderboardService: LeaderboardService;
}

export interface SlashCommand {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface ButtonHandler {
  customIdPrefix: string;
  execute: (interaction: ButtonInteraction) => Promise<void>;
}

/** Per-user command cooldowns (in seconds). Unlisted commands have no cooldown. */
const COMMAND_COOLDOWNS: Partial<Record<string, number>> = {
  [DISCORD_COMMANDS.ME]: 10,
  [DISCORD_COMMANDS.DAILY]: 60,
  [DISCORD_COMMANDS.STREAK]: 10,
  [DISCORD_COMMANDS.LEADERBOARD]: 10,
  [DISCORD_COMMANDS.LINK]: 15,
  [DISCORD_COMMANDS.VERIFY]: 15,
};

const TOGGLE_COMPLETION_FEED_MENTIONS_PREFIX = 'toggle-completion-feed-mentions';

const buildCompletionFeedMentionsToggleRow = (
  discordUserId: string,
  enabled: boolean,
): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TOGGLE_COMPLETION_FEED_MENTIONS_PREFIX}:${discordUserId}`)
      .setLabel(enabled ? 'Disable completion pings' : 'Enable completion pings')
      .setStyle(enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
  );

interface DailyCompletionRefreshApiResponse {
  status: 'refreshed' | 'not-linked' | 'daily-not-cached';
  completed: boolean | null;
  isNewCompletion?: boolean;
}

interface DailyProblemCacheApiResponse {
  status: 'cached' | 'already-cached';
}

interface DailyCompletionRefreshOutcome {
  completed: boolean;
  isNewCompletion: boolean;
}

const buildApiUrl = (baseUrl: string, path: string): string => {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\//, '');

  return new URL(normalizedPath, normalizedBaseUrl).toString();
};

const buildDailyCompletionAnnouncementEmbed = (description: string): EmbedBuilder =>
  new EmbedBuilder().setColor(0x00b8a3).setDescription(description);

export class DiscordBotService {
  private readonly client: Client;
  private readonly rest: REST;
  private readonly logger = createLogger({ name: 'bot' });
  private readonly commands = new Collection<string, SlashCommand>();
  private readonly buttonHandlers: ButtonHandler[];
  /** Map<"userId:commandName", expiry timestamp (ms)> */
  private readonly cooldowns = new Map<string, number>();

  constructor(
    private readonly env: BotEnv,
    commands: SlashCommand[],
    buttonHandlers: ButtonHandler[] = [],
  ) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds],
    });
    this.rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
    this.buttonHandlers = buttonHandlers;

    commands.forEach((command) => {
      this.commands.set(command.data.name, command);
    });

    this.registerEventHandlers();
  }

  async registerSlashCommands(): Promise<void> {
    const body = this.commands.map((command) => command.data.toJSON());
    const guildIds = this.getCommandRegistrationGuildIds();

    if (guildIds.length === 0) {
      const route = Routes.applicationCommands(this.env.DISCORD_CLIENT_ID);
      this.logger.info({ count: body.length, scope: 'global' }, 'Registering slash commands');
      await this.rest.put(route, { body });
      this.logger.info({ count: body.length, scope: 'global' }, 'Registered slash commands');
      return;
    }

    for (const guildId of guildIds) {
      try {
        const route = Routes.applicationGuildCommands(this.env.DISCORD_CLIENT_ID, guildId);
        this.logger.info({ count: body.length, guildId }, 'Registering slash commands for guild');
        await this.rest.put(route, { body });
        this.logger.info(
          { count: body.length, guildId },
          'Registered slash commands for guild',
        );
      } catch (error) {
        this.logger.error(
          { err: error instanceof Error ? error.message : error, guildId },
          'Failed to register slash commands for guild',
        );
        throw error;
      }
    }

    this.logger.info({ count: body.length, guildIds }, 'Registered slash commands');
  }

  async start(): Promise<void> {
    await this.client.login(this.env.DISCORD_TOKEN);
  }

  private getCommandRegistrationGuildIds(): string[] {
    const guildIds = new Set<string>();

    const addGuildIds = (value?: string): void => {
      if (!value) {
        return;
      }

      value
        .split(',')
        .map((guildId) => guildId.trim())
        .filter(Boolean)
        .forEach((guildId) => guildIds.add(guildId));
    };

    addGuildIds(this.env.DISCORD_GUILD_ID);
    addGuildIds(this.env.DISCORD_GUILD_IDS);

    return [...guildIds];
  }

  private registerEventHandlers(): void {
    this.client.once(Events.ClientReady, (client) => {
      this.logger.info({ tag: client.user.tag }, 'Bot ready');
    });

    this.client.on('error', (error) => {
      this.logger.error({ err: error.message }, 'Discord client error');
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (interaction.isButton()) {
        const handler = this.buttonHandlers.find((entry) =>
          interaction.customId.startsWith(entry.customIdPrefix),
        );

        if (!handler) {
          return;
        }

        try {
          await handler.execute(interaction);
        } catch (error) {
          this.logger.error(
            { err: error instanceof Error ? error.message : error, customId: interaction.customId },
            'Button interaction failed',
          );
          try {
            if (interaction.replied || interaction.deferred) {
              await interaction.followUp({
                content: 'Something went wrong while updating that setting.',
                ephemeral: true,
              });
            } else {
              await interaction.reply({
                content: 'Something went wrong while updating that setting.',
                ephemeral: true,
              });
            }
          } catch (replyError) {
            this.logger.warn(
              { err: replyError instanceof Error ? replyError.message : replyError },
              'Failed to send button interaction error response',
            );
          }
        }
        return;
      }

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

      // Per-user cooldown check
      const cooldownSeconds = COMMAND_COOLDOWNS[interaction.commandName];
      if (cooldownSeconds) {
        const key = `${interaction.user.id}:${interaction.commandName}`;
        const now = Date.now();
        const expiresAt = this.cooldowns.get(key);
        if (expiresAt && now < expiresAt) {
          const remaining = Math.ceil((expiresAt - now) / 1000);
          await interaction.reply({
            content: `⏳ Please wait **${remaining}s** before using \`/${interaction.commandName}\` again.`,
            ephemeral: true,
          });
          return;
        }
        this.cooldowns.set(key, now + cooldownSeconds * 1000);
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        this.logger.error(
          { err: error instanceof Error ? error.message : error },
          'Command execution failed',
        );
        try {
          if (interaction.deferred && !interaction.replied) {
            await interaction.editReply({
              content: 'Something went wrong while executing that command.',
            });
          } else if (interaction.replied || interaction.deferred) {
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
        } catch (replyError) {
          this.logger.warn(
            { err: replyError instanceof Error ? replyError.message : replyError },
            'Failed to send error response to interaction',
          );
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

  const refreshDailyCompletionFromApi = async (
    discordUserId: string,
  ): Promise<DailyCompletionRefreshOutcome | null> => {
    const url = buildApiUrl(services.botPublicUrl, '/daily/refresh-completion');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ discordUserId }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        throw new Error(`Daily refresh API responded with ${response.status}`);
      }

      const payload = (await response.json()) as Partial<DailyCompletionRefreshApiResponse>;

      if (payload.status === 'refreshed' && typeof payload.completed === 'boolean') {
        return {
          completed: payload.completed,
          isNewCompletion: payload.isNewCompletion === true,
        };
      }

      return null;
    } catch (error) {
      commandLogger.warn(
        {
          err: error instanceof Error ? error.message : error,
          discordUserId,
          url,
        },
        'Failed to refresh daily completion from API',
      );

      return null;
    }
  };

  const ensureTodayDailyProblemCachedFromApi = async (): Promise<boolean> => {
    const url = buildApiUrl(services.botPublicUrl, '/daily/ensure-cached');

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        throw new Error(`Daily ensure-cached API responded with ${response.status}`);
      }

      const payload = (await response.json()) as Partial<DailyProblemCacheApiResponse>;

      return payload.status === 'cached' || payload.status === 'already-cached';
    } catch (error) {
      commandLogger.warn(
        {
          err: error instanceof Error ? error.message : error,
          url,
        },
        'Failed to ensure today daily problem is cached from API',
      );

      return false;
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
    .setDescription("Show today's LeetCode daily problem and refresh your completion status");

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

  const help = new SlashCommandBuilder()
    .setName(DISCORD_COMMANDS.HELP)
    .setDescription('Show how to get started and a list of all commands');

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
        let verificationCode: string;
        let expiresAt: Date;

        try {
          ({ verificationCode, expiresAt } = await services.linkService.createVerification(
            interaction.user.id,
            username,
          ));
        } catch (error) {
          if (error instanceof AlreadyLinkedError) {
            await interaction.reply({
              content: [
                `You are already linked to \`${error.leetcodeUsername}\`.`,
                `Run \`/${DISCORD_COMMANDS.UNLINK}\` first if you want to switch accounts.`,
              ].join('\n'),
              ephemeral: true,
            });
            return;
          }

          throw error;
        }

        const expiresUnix = Math.floor(expiresAt.getTime() / 1000);

        await interaction.reply({
          content: [
            `Linking started for \`${username}\`.`,
            `1. Put this code in the README section of your LeetCode profile: \`${verificationCode}\``,
            '2. Save your LeetCode profile README.',
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

        if (linkRow.verified) {
          await interaction.reply({
            content: `You are already linked to \`${linkRow.leetcodeUsername}\`.`,
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
            'Verification failed. Make sure the code is in the README section of your LeetCode profile, then try again in a minute.',
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
            content:
              targetUser.id === interaction.user.id
                ? [
                    'No cached stats found yet. Try again after the worker refreshes stats.',
                    'You can still use the button below to control automatic completion-feed pings.',
                  ].join('\n')
                : 'No cached stats found yet. Try again after the worker refreshes stats.',
            components:
              targetUser.id === interaction.user.id
                ? [
                    buildCompletionFeedMentionsToggleRow(
                      interaction.user.id,
                      userLink.completionFeedMentionsEnabled,
                    ),
                  ]
                : undefined,
            ephemeral: targetUser.id === interaction.user.id,
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
          components:
            targetUser.id === interaction.user.id
              ? [
                  buildCompletionFeedMentionsToggleRow(
                    interaction.user.id,
                    userLink.completionFeedMentionsEnabled,
                  ),
                ]
              : undefined,
          ephemeral: targetUser.id === interaction.user.id,
        });
      },
    },
    {
      data: daily,
      execute: async (interaction) => {
        await interaction.deferReply();

        const today = toDateOnly(new Date());
        let [dailyProblem, callerLink] = await Promise.all([
          services.db.dailyProblem.findUnique({
            where: { date: today },
          }),
          services.db.userLink.findUnique({
            where: { discordUserId: interaction.user.id },
          }),
        ]);

        if (!dailyProblem) {
          const cached = await ensureTodayDailyProblemCachedFromApi();
          if (cached) {
            dailyProblem = await services.db.dailyProblem.findUnique({
              where: { date: today },
            });
          }

          if (!dailyProblem) {
            await interaction.editReply({
              content:
                "Today's daily problem isn't cached yet, and the on-demand refresh failed. Try again shortly.",
            });
            return;
          }
        }

        let completionText = 'Not linked';
        let announceNewCompletion = false;

        if (callerLink?.verified) {
          await ensureGuildMembership(interaction, interaction.user.id);

          const existingCompletion = await services.db.dailyCompletion.findUnique({
            where: {
              userLinkId_dailyProblemId: {
                userLinkId: callerLink.id,
                dailyProblemId: dailyProblem.id,
              },
            },
          });

          if (existingCompletion?.completed) {
            completionText = 'Completed';
          } else {
            const refreshedCompletion = await refreshDailyCompletionFromApi(interaction.user.id);

            if (refreshedCompletion) {
              completionText = refreshedCompletion.completed ? 'Completed' : 'Not completed';
              announceNewCompletion =
                refreshedCompletion.completed && refreshedCompletion.isNewCompletion;
            } else {
              completionText = existingCompletion?.completed ? 'Completed' : 'Not completed';
            }
          }
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

        await interaction.editReply({
          embeds: [embed],
        });

        if (announceNewCompletion && callerLink) {
          try {
            await interaction.followUp({
              embeds: [
                buildDailyCompletionAnnouncementEmbed(
                  formatDailyCompletionAnnouncement({
                    discordUserId: interaction.user.id,
                    leetcodeUsername: callerLink.leetcodeUsername,
                    mentionDiscordUser: callerLink.completionFeedMentionsEnabled,
                  }),
                ),
              ],
            });
          } catch (error) {
            commandLogger.warn(
              {
                err: error instanceof Error ? error.message : error,
                discordUserId: interaction.user.id,
              },
              'Failed to send immediate daily completion announcement',
            );
          }
        }
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

          const medals = ['🥇', '🥈', '🥉'];
          const embed = new EmbedBuilder()
            .setTitle('🏆 Total Solved Leaderboard')
            .setColor(0xffa116)
            .setDescription(
              entries
                .slice(0, 15)
                .map(
                  (entry, index) =>
                    `${medals[index] ?? `**${index + 1}.**`} <@${entry.discordUserId}> (\`${entry.leetcodeUsername}\`) · **${entry.totalSolved}** solved (🟢${entry.easySolved} 🟡${entry.mediumSolved} 🔴${entry.hardSolved})`,
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

          const medals = ['🥇', '🥈', '🥉'];
          const embed = new EmbedBuilder()
            .setTitle('✅ Daily Completion Leaderboard')
            .setColor(0x00b8a3)
            .setDescription(
              entries
                .slice(0, 25)
                .map(
                  (entry, index) =>
                    `${medals[index] ?? `**${index + 1}.**`} <@${entry.discordUserId}> (\`${entry.leetcodeUsername}\`)`,
                )
                .join('\n'),
            )
            .setFooter({
              text: `${entries.length} member${entries.length !== 1 ? 's' : ''} completed today`,
            });
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
        const streakColor =
          currentStreak >= 7 ? 0xff6b35 : currentStreak >= 3 ? 0xffa116 : 0x5865f2;

        const embed = new EmbedBuilder()
          .setTitle(`📅 Daily Streak · ${userLink.leetcodeUsername}`)
          .setColor(streakColor)
          .addFields(
            {
              name: `${streakEmoji} Current Streak`,
              value: `**${currentStreak}** day${currentStreak !== 1 ? 's' : ''}`,
              inline: true,
            },
            {
              name: '🏅 Longest Streak',
              value: `**${longestStreak}** day${longestStreak !== 1 ? 's' : ''}`,
              inline: true,
            },
            {
              name: '✅ Total Completed',
              value: `**${totalCompleted}**`,
              inline: true,
            },
          );

        await interaction.reply({
          embeds: [embed],
          ephemeral: targetUser.id === interaction.user.id,
        });
      },
    },
    {
      data: help,
      execute: async (interaction) => {
        const embed = new EmbedBuilder()
          .setTitle('📚 LeetCord Help')
          .setColor(0xffa116)
          .addFields(
            {
              name: '🚀 Getting Started',
              value: [
                `1\. Run \`/${DISCORD_COMMANDS.LINK} username:<your_username>\``,
                '2\. Paste the code into the README section of your [LeetCode profile](https://leetcode.com/profile/)',
                `3\. Run \`/${DISCORD_COMMANDS.VERIFY}\` to finish linking`,
              ].join('\n'),
            },
            {
              name: '\u200b',
              value: '\u200b',
            },
            {
              name: '📊 Commands',
              value: [
                `\`/${DISCORD_COMMANDS.PING}\` — Check if the bot is alive`,
                `\`/${DISCORD_COMMANDS.LINK} username:<your_username>\` — Start linking your account`,
                `\`/${DISCORD_COMMANDS.VERIFY}\` — Finish linking your account`,
                `\`/${DISCORD_COMMANDS.UNLINK}\` — Unlink your account`,
                `\`/${DISCORD_COMMANDS.ME}\` — Your LeetCode stats`,
                `\`/${DISCORD_COMMANDS.DAILY}\` — Today's daily problem, cached on demand, and refreshed completion status`,
                `\`/${DISCORD_COMMANDS.STREAK}\` — Your completion streak`,
                `\`/${DISCORD_COMMANDS.LEADERBOARD}\` — Server leaderboard`,
                `\`/${DISCORD_COMMANDS.HELP}\` — Show this help message`,
              ].join('\n'),
              inline: true,
            },
            {
              name: '⚙️ Admin',
              value: [
                `\`/${DISCORD_COMMANDS.SETUP_DAILY_CHANNEL}\` — Set the daily post channel`,
                `\`/${DISCORD_COMMANDS.SETUP_TIMEZONE}\` — Set the guild timezone`,
                `\`/${DISCORD_COMMANDS.SETUP_LEADERBOARD}\` — Enable or disable leaderboards`,
              ].join('\n'),
              inline: true,
            },
            {
              name: '⏱ Cooldowns',
              value: [
                `\`/${DISCORD_COMMANDS.DAILY}\` — 60s`,
                `\`/${DISCORD_COMMANDS.LINK}\`, \`/${DISCORD_COMMANDS.VERIFY}\` — 15s`,
                `\`/${DISCORD_COMMANDS.ME}\`, \`/${DISCORD_COMMANDS.STREAK}\`, \`/${DISCORD_COMMANDS.LEADERBOARD}\` — 10s`,
                'All other commands — none',
              ].join('\n'),
            },
            {
              name: '🔔 Mentions',
              value: `Run \`/${DISCORD_COMMANDS.ME}\` and use the button to control whether automatic completion posts ping you.`,
            },
          );

        await interaction.reply({ embeds: [embed], ephemeral: true });
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

export const createCoreButtonHandlers = (services: BotCommandServices): ButtonHandler[] => [
  {
    customIdPrefix: TOGGLE_COMPLETION_FEED_MENTIONS_PREFIX,
    execute: async (interaction) => {
      const targetDiscordUserId = interaction.customId.slice(
        `${TOGGLE_COMPLETION_FEED_MENTIONS_PREFIX}:`.length,
      );

      if (targetDiscordUserId !== interaction.user.id) {
        await interaction.reply({
          content: 'This settings button only works for your own account.',
          ephemeral: true,
        });
        return;
      }

      const userLink = await services.db.userLink.findUnique({
        where: { discordUserId: interaction.user.id },
        select: {
          completionFeedMentionsEnabled: true,
          verified: true,
        },
      });

      if (!userLink?.verified) {
        await interaction.reply({
          content: `Link your account with \`/${DISCORD_COMMANDS.LINK}\` before changing this setting.`,
          ephemeral: true,
        });
        return;
      }

      const nextEnabled = !userLink.completionFeedMentionsEnabled;
      await services.db.userLink.update({
        where: { discordUserId: interaction.user.id },
        data: {
          completionFeedMentionsEnabled: nextEnabled,
        },
      });

      await interaction.update({
        components: [buildCompletionFeedMentionsToggleRow(interaction.user.id, nextEnabled)],
      });

      await interaction.followUp({
        content: nextEnabled
          ? 'Daily problem completion posts can ping you again.'
          : 'Daily problem completion posts will use your LeetCode username instead of pinging you.',
        ephemeral: true,
      });
    },
  },
];

const buildWeeklyLeaderboardEmbed = (snapshot: WeeklyLeaderboardSnapshotPayload): EmbedBuilder => {
  const weekStart = snapshot.weekStart.slice(0, 10);
  const entries = snapshot.entries.slice(0, 15);

  const medals = ['🥇', '🥈', '🥉'];
  const description =
    entries.length > 0
      ? entries
          .map(
            (entry, index) =>
              `${medals[index] ?? `**${index + 1}.**`} <@${entry.discordUserId}> (\`${entry.leetcodeUsername}\`) · **+${
                entry.solvedDelta
              }** this week`,
          )
          .join('\n')
      : 'No progress captured yet this week.';

  return new EmbedBuilder()
    .setTitle('📈 Weekly Leaderboard')
    .setColor(0x5865f2)
    .setDescription(description)
    .setFooter({ text: `Week of ${weekStart}` });
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
