import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createLogger } from '@leetcord/shared';

const logger = createLogger({ name: 'api-error' });

export const registerErrorHandler = (app: FastifyInstance): void => {
  app.setErrorHandler(
    async (error: Error, _request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      logger.error({ err: error.message }, 'Request failed');
      if (!reply.raw.headersSent) {
        void reply.status(500).send({ error: 'Internal Server Error' });
      }
    }
  );
};

