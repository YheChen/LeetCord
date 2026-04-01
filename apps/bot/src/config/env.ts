import { z } from 'zod';
import { BaseEnvSchema, createEnvLoader } from '@leetcord/shared';

const BotEnvSchema = BaseEnvSchema.extend({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  DISCORD_GUILD_IDS: z.string().optional(),
  BOT_PUBLIC_URL: z.string().url()
});

export type BotEnv = z.infer<typeof BotEnvSchema>;

export const loadBotEnv = createEnvLoader(BotEnvSchema);
