import { LinkService } from '@leetcord/core';
import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const StartVerificationBodySchema = z.object({
  discordUserId: z.string().min(1),
  leetcodeUsername: z.string().min(1)
});

const CompleteVerificationBodySchema = z.object({
  discordUserId: z.string().min(1)
});

export const createStartVerificationHandler =
  (linkService: LinkService) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const parsedBody = StartVerificationBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      void reply.status(400).send({
        error: 'Invalid request body',
        details: parsedBody.error.flatten()
      });
      return;
    }

    const { discordUserId, leetcodeUsername } = parsedBody.data;
    const result = await linkService.createVerification(discordUserId, leetcodeUsername);
    void reply.status(200).send({
      status: 'pending',
      verificationCode: result.verificationCode,
      expiresAt: result.expiresAt.toISOString()
    });
  };

export const createCompleteVerificationHandler =
  (linkService: LinkService) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const parsedBody = CompleteVerificationBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      void reply.status(400).send({
        error: 'Invalid request body',
        details: parsedBody.error.flatten()
      });
      return;
    }

    const { discordUserId } = parsedBody.data;
    const verified = await linkService.verifyUser(discordUserId);
    void reply.status(200).send({
      status: verified ? 'verified' : 'unverified',
      verified
    });
  };
