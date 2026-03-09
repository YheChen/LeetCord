import { EmbedBuilder } from 'discord.js';
import { LeetCodeDailyProblem } from '@leetcord/shared';

export const buildDailyProblemEmbed = (
  problem: LeetCodeDailyProblem,
  completionStatus?: string
): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setTitle(problem.title)
    .setURL(problem.url)
    .addFields(
      { name: 'Difficulty', value: problem.difficulty, inline: true },
      { name: 'Date', value: problem.date.toISOString().slice(0, 10), inline: true }
    );

  if (completionStatus) {
    embed.addFields({
      name: 'Your Status',
      value: completionStatus,
      inline: true
    });
  }

  return embed;
};
