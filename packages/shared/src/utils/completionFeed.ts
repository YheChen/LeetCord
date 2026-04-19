export interface DailyCompletionAnnouncementInput {
  discordUserId: string;
  leetcodeUsername: string;
  mentionDiscordUser?: boolean;
}

export const formatDailyCompletionAnnouncement = ({
  discordUserId,
  leetcodeUsername,
  mentionDiscordUser = true,
}: DailyCompletionAnnouncementInput): string =>
  mentionDiscordUser
    ? `✅ <@${discordUserId}> (\`${leetcodeUsername}\`) has just completed today's daily!`
    : `✅ ${leetcodeUsername} has just completed today's daily!`;
