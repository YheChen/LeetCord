export interface DiscordUserIdentity {
  discordUserId: string;
  username?: string;
  discriminator?: string;
}

export interface DiscordGuildIdentity {
  guildId: string;
  name?: string;
}

