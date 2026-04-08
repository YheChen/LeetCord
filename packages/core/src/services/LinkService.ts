import { randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '@leetcord/shared';
import { LeetCodeService } from './LeetCodeService';

const logger = createLogger({ name: 'core-link-service' });

export interface CreateVerificationResult {
  verificationCode: string;
  expiresAt: Date;
}

export class AlreadyLinkedError extends Error {
  constructor(public readonly leetcodeUsername: string) {
    super(`Discord account is already linked to ${leetcodeUsername}`)
    this.name = 'AlreadyLinkedError'
  }
}

export class LinkService {
  constructor(
    private readonly db: PrismaClient,
    private readonly leetCodeService: LeetCodeService
  ) {}

  async createVerification(discordUserId: string, leetcodeUsername: string): Promise<CreateVerificationResult> {
    const existingLink = await this.db.userLink.findUnique({
      where: { discordUserId }
    });

    if (existingLink?.verified) {
      throw new AlreadyLinkedError(existingLink.leetcodeUsername);
    }

    const verificationCode = this.generateVerificationCode();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30);

    await this.db.userLink.upsert({
      where: { discordUserId },
      update: {
        leetcodeUsername,
        verificationCode,
        verificationExpiresAt: expiresAt,
        verified: false
      },
      create: {
        discordUserId,
        leetcodeUsername,
        verificationCode,
        verificationExpiresAt: expiresAt,
        verified: false
      }
    });

    logger.info({ discordUserId, leetcodeUsername }, 'Created verification code for user');

    return { verificationCode, expiresAt };
  }

  async verifyUser(discordUserId: string): Promise<boolean> {
    const link = await this.db.userLink.findUnique({
      where: { discordUserId }
    });

    if (!link || !link.verificationCode || !link.verificationExpiresAt) {
      return false;
    }

    if (link.verificationExpiresAt.getTime() < Date.now()) {
      return false;
    }

    const isPresent = await this.leetCodeService.checkVerificationCode(
      link.leetcodeUsername,
      link.verificationCode
    );

    if (!isPresent) {
      return false;
    }

    await this.db.userLink.update({
      where: { discordUserId },
      data: {
        verified: true,
        verificationCode: null,
        verificationExpiresAt: null
      }
    });

    logger.info({ discordUserId }, 'User link verified');
    return true;
  }

  async unlinkUser(discordUserId: string): Promise<void> {
    await this.db.userLink.deleteMany({
      where: { discordUserId }
    });
    logger.info({ discordUserId }, 'User unlinked');
  }

  private generateVerificationCode(): string {
    return randomBytes(4).toString('hex');
  }
}
