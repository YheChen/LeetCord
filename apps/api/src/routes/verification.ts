import { LinkService } from '@leetcord/core';
import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  createCompleteVerificationHandler,
  createStartVerificationHandler
} from '../controllers/verificationController';

export interface VerificationRoutesOptions extends FastifyPluginOptions {
  linkService: LinkService;
}

export const registerVerificationRoutes = async (
  app: FastifyInstance,
  options: VerificationRoutesOptions
): Promise<void> => {
  app.post('/verification/start', createStartVerificationHandler(options.linkService));
  app.post('/verification/complete', createCompleteVerificationHandler(options.linkService));
};
