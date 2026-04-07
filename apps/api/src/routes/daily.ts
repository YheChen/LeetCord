import { StatsSyncService } from '@leetcord/core';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { createRefreshDailyCompletionHandler } from '../controllers/dailyController';

export interface DailyRoutesOptions extends FastifyPluginOptions {
  statsSyncService: StatsSyncService;
}

export const registerDailyRoutes = async (
  app: FastifyInstance,
  options: DailyRoutesOptions,
): Promise<void> => {
  app.post('/refresh-completion', createRefreshDailyCompletionHandler(options.statsSyncService));
};
