import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';
import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { getPrismaClient } from '@leetcord/database';
import { LeetCodeService, LinkService, StatsSyncService } from '@leetcord/core';
import { createLeetCodeClient } from '@leetcord/leetcode-client';
import { createLogger } from '@leetcord/shared';
import { loadApiEnv } from './config/env';
import { registerErrorHandler } from './middleware/errorHandler';
import { registerDailyRoutes } from './routes/daily';
import { registerHealthRoutes } from './routes/health';
import { registerVerificationRoutes } from './routes/verification';

loadDotenv({ path: resolve(__dirname, '../../../.env') });

const logger = createLogger({ name: 'api-main' });

const buildServer = (linkService: LinkService, statsSyncService: StatsSyncService) => {
  const app = fastify({
    logger: false
  });

  void app.register(cors);
  void app.register(helmet);

  registerErrorHandler(app);

  void app.register(registerHealthRoutes);
  void app.register(registerDailyRoutes, { prefix: '/daily', statsSyncService });
  void app.register(registerVerificationRoutes, { prefix: '/link', linkService });

  return app;
};

const main = async (): Promise<void> => {
  const env = loadApiEnv();
  const db = getPrismaClient();
  const leetCodeClient = createLeetCodeClient(env.LEETCODE_FETCH_USER_AGENT);
  const leetCodeService = new LeetCodeService(leetCodeClient);
  const linkService = new LinkService(db, leetCodeService);
  const statsSyncService = new StatsSyncService(db, leetCodeService);
  const app = buildServer(linkService, statsSyncService);

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  logger.info({ port: env.API_PORT }, 'API listening');
};

main().catch((error: unknown) => {
  logger.error({ err: error }, 'API failed to start');
  process.exit(1);
});
