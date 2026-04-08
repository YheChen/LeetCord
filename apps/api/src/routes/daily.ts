import { StatsSyncService } from '@leetcord/core';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  createEnsureTodayDailyProblemCachedHandler,
  createRefreshDailyCompletionHandler,
} from '../controllers/dailyController';

export interface DailyRoutesOptions extends FastifyPluginOptions {
  statsSyncService: StatsSyncService;
}

export const registerDailyRoutes = async (
  app: FastifyInstance,
  options: DailyRoutesOptions,
): Promise<void> => {
  app.post('/ensure-cached', createEnsureTodayDailyProblemCachedHandler(options.statsSyncService));
  app.post('/refresh-completion', createRefreshDailyCompletionHandler(options.statsSyncService));
};
