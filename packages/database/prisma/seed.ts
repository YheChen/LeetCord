import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const main = async (): Promise<void> => {
  // Minimal seed for local development. Safe to delete in real environments.
  // TODO: Extend with realistic seed data if needed.
  await prisma.guildSettings.upsert({
    where: { guildId: 'dev-guild' },
    update: {},
    create: {
      guildId: 'dev-guild',
      leaderboardEnabled: true
    }
  });
};

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

