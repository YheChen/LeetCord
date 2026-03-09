## LeetCord

LeetCord is a Discord bot and backend stack for LeetCode communities. It lets users link their LeetCode accounts, view cached stats, track daily problems, and see leaderboards within their Discord servers.

This repository is structured as a pnpm-powered TypeScript monorepo with separate apps for the Discord bot, HTTP API, and worker, plus shared packages for database access, domain services, and LeetCode integration.

### Monorepo layout

- **apps/bot**: Discord bot (`discord.js`) with slash commands.
- **apps/api**: Fastify HTTP API for health checks and link/verification endpoints.
- **apps/worker**: Cron-based worker for polling LeetCode and posting daily updates.
- **packages/shared**: Shared types, constants, utilities, and Zod schemas.
- **packages/leetcode-client**: LeetCode adapter interface and HTTP-based implementation.
- **packages/database**: Prisma schema and database client.
- **packages/core**: Core domain services (linking, stats sync, guild settings, leaderboards, LeetCode service wrapper).

### Quick start

1. **Install dependencies**

```bash
pnpm install
```

2. **Set up environment**

Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

3. **Run database migrations**

```bash
pnpm prisma:migrate
```

4. **Run services in development**

In three terminals (or with a process manager):

```bash
pnpm dev:api
pnpm dev:bot
pnpm dev:worker
```

5. **Run with Docker**

```bash
docker-compose up --build
```

### Environment variables

See `.env.example` for all required variables:

- **DISCORD_TOKEN**: Discord bot token.
- **DISCORD_CLIENT_ID**: Discord application client ID.
- **DISCORD_GUILD_ID**: Development guild ID for command registration (optional in production).
- **DATABASE_URL**: PostgreSQL connection string.
- **API_PORT**: Port for the Fastify API.
- **BOT_PUBLIC_URL**: Public URL used for callbacks and verification.
- **LEETCODE_FETCH_USER_AGENT**: User-agent string for LeetCode HTTP requests.
- **LOG_LEVEL**: Pino log level.

### Development notes

- All code is written in **TypeScript** with `strict` mode enabled.
- **Prisma** is used for the PostgreSQL schema and client.
- **Zod** is used for environment validation and external response validation.
- **discord.js** powers the bot; only **slash commands** are used.
- **Fastify** is used for the HTTP API.
- **node-cron** is used for scheduled worker jobs.

### TODOs and assumptions

- TODO: Implement real `LeetCodeClient` HTTP/scraping logic behind the adapter interface.
- TODO: Implement full linking/verification, stats sync, leaderboards, and daily completion logic in the bot and worker.
- TODO: Add unit tests for services and integration tests for core commands.

