import { EmbedBuilder } from 'discord.js';
import { LeetCodeDailyProblem } from '@leetcord/shared';

const DIFFICULTY_CONFIG: Record<string, { color: number; emoji: string }> = {
  Easy: { color: 0x00b8a3, emoji: '🟢' },
  Medium: { color: 0xffc01e, emoji: '🟡' },
  Hard: { color: 0xff375f, emoji: '🔴' },
};

export const buildDailyProblemEmbed = (
  problem: LeetCodeDailyProblem,
  completionStatus?: string,
): EmbedBuilder => {
  const config = DIFFICULTY_CONFIG[problem.difficulty] ?? DIFFICULTY_CONFIG.Medium;
  const statusEmoji =
    completionStatus === 'Completed' ? '✅' : completionStatus === 'Not linked' ? '🔗' : '⬜';

  const embed = new EmbedBuilder()
    .setTitle(`📋 ${problem.title}`)
    .setURL(problem.url)
    .setColor(config.color)
    .setDescription(
      [
        `${config.emoji} **${problem.difficulty}** · ${problem.date.toISOString().slice(0, 10)}`,
        '',
        completionStatus ? `${statusEmoji} ${completionStatus}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: 'LeetCode Daily Challenge' });

  return embed;
};
