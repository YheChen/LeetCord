import { z } from 'zod';

export const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().url(),
  LEETCODE_FETCH_USER_AGENT: z.string().min(1)
});

export type BaseEnv = z.infer<typeof BaseEnvSchema>;

export const createEnvLoader = <TSchema extends z.ZodTypeAny>(schema: TSchema) => {
  return (): z.infer<TSchema> => {
    const result = schema.safeParse(process.env);
    if (!result.success) {
      // eslint-disable-next-line no-console
      console.error('Invalid environment variables', result.error.format());
      throw new Error('Invalid environment variables');
    }
    return result.data;
  };
};

