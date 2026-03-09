import { z } from 'zod';
import { BaseEnvSchema, createEnvLoader } from '@leetcord/shared';

const ApiEnvSchema = BaseEnvSchema.extend({
  API_PORT: z.coerce.number().int().positive().default(3000)
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

export const loadApiEnv = createEnvLoader(ApiEnvSchema);

