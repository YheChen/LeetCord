import { EmbedBuilder } from 'discord.js';
import { LeetCodeProfileStats } from '@leetcord/shared';

const LEETCODE_COLOR = 0xffa116;

export const buildUserStatsEmbed = (stats: LeetCodeProfileStats): EmbedBuilder => {
  const profileUrl = `https://leetcode.com/u/${encodeURIComponent(stats.username)}/`;

  const embed = new EmbedBuilder()
    .setTitle(`📊 ${stats.username}`)
    .setURL(profileUrl)
    .setColor(LEETCODE_COLOR)
    .setDescription(
      [
        `**${stats.totalSolved}** problems solved`,
        '',
        `🟢 Easy: **${stats.easySolved}**`,
        `🟡 Medium: **${stats.mediumSolved}**`,
        `🔴 Hard: **${stats.hardSolved}**`,
      ].join('\n'),
    )
    .setFooter({
      text: `Last synced ${stats.fetchedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    });

  const extraFields: Array<{ name: string; value: string; inline: boolean }> = [];

  if (stats.streakCount !== null) {
    const emoji = stats.streakCount >= 7 ? '🔥' : stats.streakCount >= 3 ? '👏' : '📅';
    extraFields.push({
      name: `${emoji} Streak`,
      value: `**${stats.streakCount}** day${stats.streakCount !== 1 ? 's' : ''}`,
      inline: true,
    });
  }

  if (stats.contestRating !== null) {
    extraFields.push({
      name: '🏆 Contest Rating',
      value: `**${stats.contestRating.toFixed(0)}**`,
      inline: true,
    });
  }

  if (extraFields.length > 0) {
    embed.addFields(extraFields);
  }

  return embed;
};
