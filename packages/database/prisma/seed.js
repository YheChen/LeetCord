"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const main = async () => {
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
    .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map