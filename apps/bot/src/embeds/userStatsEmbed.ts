import { EmbedBuilder } from 'discord.js';
import { LeetCodeProfileStats } from '@leetcord/shared';

export const buildUserStatsEmbed = (stats: LeetCodeProfileStats): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setTitle(`LeetCode stats for ${stats.username}`)
    .addFields(
      { name: 'Total solved', value: stats.totalSolved.toString(), inline: true },
      { name: 'Easy', value: stats.easySolved.toString(), inline: true },
      { name: 'Medium', value: stats.mediumSolved.toString(), inline: true },
      { name: 'Hard', value: stats.hardSolved.toString(), inline: true }
    )
    .setFooter({
      text: `Last sync: ${stats.fetchedAt.toISOString()}`
    });

  if (stats.streakCount !== null) {
    embed.addFields({
      name: 'Streak',
      value: `${stats.streakCount} day(s)`,
      inline: true
    });
  }

  if (stats.contestRating !== null) {
    embed.addFields({
      name: 'Contest rating',
      value: stats.contestRating.toFixed(2),
      inline: true
    });
  }

  return embed;
};

