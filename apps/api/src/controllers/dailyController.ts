import { StatsSyncService } from '@leetcord/core';
import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const RefreshDailyCompletionBodySchema = z.object({
  discordUserId: z.string().min(1),
});

export const createRefreshDailyCompletionHandler =
  (statsSyncService: StatsSyncService) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const parsedBody = RefreshDailyCompletionBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      void reply.status(400).send({
        error: 'Invalid request body',
        details: parsedBody.error.flatten(),
      });
      return;
    }

    const result = await statsSyncService.refreshDailyCompletionForDiscordUser(
      parsedBody.data.discordUserId,
    );

    void reply.status(200).send(result);
  };
