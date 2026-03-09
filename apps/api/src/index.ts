import 'dotenv/config';
import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { getPrismaClient } from '@leetcord/database';
import { LeetCodeService, LinkService } from '@leetcord/core';
import { createLeetCodeClient } from '@leetcord/leetcode-client';
import { createLogger } from '@leetcord/shared';
import { loadApiEnv } from './config/env';
import { registerErrorHandler } from './middleware/errorHandler';
import { registerHealthRoutes } from './routes/health';
import { registerVerificationRoutes } from './routes/verification';

const logger = createLogger({ name: 'api-main' });

const buildServer = (linkService: LinkService) => {
  const app = fastify({
    logger: false
  });

  void app.register(cors);
  void app.register(helmet);

  registerErrorHandler(app);

  void app.register(registerHealthRoutes);
  void app.register(registerVerificationRoutes, { prefix: '/link', linkService });

  return app;
};

const main = async (): Promise<void> => {
  const env = loadApiEnv();
  const db = getPrismaClient();
  const leetCodeClient = createLeetCodeClient(env.LEETCODE_FETCH_USER_AGENT);
  const leetCodeService = new LeetCodeService(leetCodeClient);
  const linkService = new LinkService(db, leetCodeService);
  const app = buildServer(linkService);

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  logger.info({ port: env.API_PORT }, 'API listening');
};

main().catch((error: unknown) => {
  logger.error({ err: error }, 'API failed to start');
  process.exit(1);
});
