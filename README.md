## LeetCord

LeetCord is a Discord bot and backend stack for LeetCode communities. It lets users link their LeetCode accounts, view cached stats, track daily problems, compete on leaderboards, and track completion streaks within their Discord servers.

This repository is structured as a pnpm-powered TypeScript monorepo with separate apps for the Discord bot, HTTP API, and worker, plus shared packages for database access, domain services, and LeetCode integration.

### Monorepo layout

- **apps/bot**: Discord bot (`discord.js`) with slash commands.
- **apps/api**: Fastify HTTP API for health checks and link/verification endpoints.
- **apps/worker**: Cron-based worker for polling LeetCode, posting daily updates, recaps, and real-time completion feed.
- **packages/shared**: Shared types, constants, utilities, and Zod schemas.
- **packages/leetcode-client**: LeetCode adapter interface and HTTP-based implementation.
- **packages/database**: Prisma schema and database client.
- **packages/core**: Core domain services (linking, stats sync, guild settings, leaderboards, LeetCode service wrapper).

### Slash commands

#### User commands

| Command               | Description                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `/ping`               | Check if the bot is alive                                                                                           |
| `/link <username>`    | Start linking your LeetCode account (generates a verification code)                                                 |
| `/verify`             | Complete the link verification by checking your LeetCode bio                                                        |
| `/unlink`             | Unlink your LeetCode account                                                                                        |
| `/me [user]`          | Show LeetCode stats (total/easy/medium/hard solved, streak, contest rating, today's daily status)                   |
| `/daily`              | Show today's LeetCode daily problem with your completion status                                                     |
| `/streak [user]`      | Show your daily problem completion streak (current, longest, total completed)                                       |
| `/leaderboard <mode>` | Show leaderboard — modes: `total` (all-time solved), `weekly` (this week's progress), `daily` (today's completions) |

#### Admin commands (require Administrator permission)

| Command                          | Description                                                 |
| -------------------------------- | ----------------------------------------------------------- |
| `/setup-daily-channel <channel>` | Set the channel for daily problem posts and completion feed |
| `/setup-timezone <timezone>`     | Set the guild's IANA timezone (e.g. `America/Toronto`)      |
| `/setup-leaderboard <enabled>`   | Enable or disable leaderboard commands                      |

### Automated worker jobs

| Job                       | Schedule         | Description                                                   |
| ------------------------- | ---------------- | ------------------------------------------------------------- |
| Fetch daily problem       | 00:05 UTC daily  | Fetches today's LeetCode daily and stores it                  |
| Post daily problem        | 00:05 UTC daily  | Posts the new daily problem to configured guild channels      |
| Daily recap               | 00:05 UTC daily  | Posts yesterday's completion results and the group's streak   |
| Daily completion refresh  | Every 10 minutes | Checks if users completed today's daily problem               |
| Real-time completion feed | Every 10 minutes | Posts to guild channels when a user newly completes the daily |
| Stats refresh             | Every 60 minutes | Pulls fresh LeetCode stats for all verified users             |
| Weekly leaderboard        | Monday 01:00 UTC | Computes weekly leaderboard snapshots for all guilds          |

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
- Rebuild shared packages (`pnpm --filter @leetcord/shared build && pnpm --filter @leetcord/core build`) after modifying their source, since downstream apps resolve via `dist/`.
