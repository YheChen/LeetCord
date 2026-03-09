import { z } from 'zod';
import { BaseEnvSchema, createEnvLoader } from '@leetcord/shared';

const WorkerEnvSchema = BaseEnvSchema.extend({
  DISCORD_TOKEN: z.string().min(1)
});

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export const loadWorkerEnv = createEnvLoader(WorkerEnvSchema);
