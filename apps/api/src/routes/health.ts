import { FastifyInstance } from 'fastify';

export const registerHealthRoutes = async (app: FastifyInstance): Promise<void> => {
  app.get('/health', async () => {
    return { status: 'ok' };
  });
};

