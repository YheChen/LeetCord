## LeetCord

LeetCord is a Discord bot and backend stack for LeetCode communities. It lets users link their LeetCode accounts, view cached stats, track the daily problem, compete on leaderboards, track streaks, and post automated daily updates inside Discord servers.

This repository is a `pnpm`-powered TypeScript monorepo with separate apps for the Discord bot, HTTP API, and worker, plus shared packages for database access, domain services, and LeetCode integration.

### Monorepo layout

- **apps/bot**: Discord bot (`discord.js`) with slash commands and interactive buttons.
- **apps/api**: Fastify HTTP API for health checks and verification endpoints.
- **apps/worker**: Cron-based worker for polling LeetCode, caching data, posting daily updates, and refreshing completion state.
- **packages/shared**: Shared types, constants, utilities, and Zod schemas.
- **packages/leetcode-client**: LeetCode adapter interface and HTTP-based implementation.
- **packages/database**: Prisma schema, migrations, and database client.
- **packages/core**: Core domain services for linking, stats sync, guild settings, leaderboards, and LeetCode integration.

### Features

- Link a Discord user to a LeetCode account using a verification code placed in the user’s LeetCode bio.
- View cached LeetCode profile stats, including total solved, difficulty breakdown, streak, contest rating, and today’s daily status.
- Cache the current LeetCode daily problem in the database and show it through slash commands.
- Track daily completion status for linked users.
- Show server leaderboards for total solved, daily completions, and weekly progress snapshots.
- Post the daily problem into a configured server channel.
- Post automatic completion-feed updates when a linked user newly completes today’s daily.
- Let each user opt out of being pinged in automatic completion-feed posts from their own `/me` response.

### Slash commands

#### User commands

| Command | Description |
| ------- | ----------- |
| `/ping` | Check if the bot is alive. |
| `/link username:<your_username>` | Start linking your LeetCode account and generate a verification code. |
| `/verify` | Complete the link verification by checking your LeetCode bio. |
| `/unlink` | Unlink your LeetCode account. |
| `/me [user]` | Show cached LeetCode stats for yourself or another linked user. On your own `/me`, a button lets you enable or disable completion-feed pings. |
| `/daily` | Show today’s cached LeetCode daily problem and your completion status if you are linked. |
| `/streak [user]` | Show current streak, longest streak, and total completed dailies. |
| `/leaderboard mode:<total\|weekly\|daily>` | Show the server leaderboard for all-time solved, this week’s progress, or today’s completions. |
| `/help` | Show setup instructions and the command list. |

#### Admin commands

These commands require the `Administrator` permission in the Discord server.

| Command | Description |
| ------- | ----------- |
| `/setup-daily-channel channel:<channel>` | Set the channel used for daily problem posts and completion-feed updates. |
| `/setup-timezone timezone:<IANA timezone>` | Store a guild timezone such as `America/Toronto`. |
| `/setup-leaderboard enabled:<true\|false>` | Enable or disable leaderboard commands in the server. |

### Automated worker behavior

#### Startup behavior

When the worker starts, it immediately:

- fetches and caches today’s daily problem
- refreshes cached stats for linked users
- refreshes daily completion state for linked users
- computes weekly leaderboard snapshots
- posts the daily problem if a configured guild channel exists and it has not already been posted

#### Scheduled jobs

| Job | Schedule | Description |
| --- | -------- | ----------- |
| Fetch and post daily problem | `00:05 UTC` daily | Refreshes the cached daily problem and posts it to configured channels. |
| Daily completion refresh | Every 10 minutes | Checks linked users for new daily completions. |
| Completion feed | Every 10 minutes, when new completions are found | Posts `@user just completed today's daily` into configured daily channels. If a user disables completion pings, the post uses their LeetCode username instead of pinging them. |
| Stats refresh | Every 60 minutes | Pulls fresh LeetCode stats for all verified users. |
| Weekly leaderboard snapshot | Monday `01:00 UTC` | Computes weekly leaderboard snapshots for all guilds with settings rows. |

#### Current implementation note

A daily recap job exists in the codebase, but it is **not currently wired into startup or any scheduler**, so it does not run automatically right now.

### Quick start

#### Requirements

- Node.js `>= 20`
- `pnpm >= 9`

#### 1. Install dependencies

```bash
pnpm install
```

#### 2. Create `.env`

Copy the example file:

```bash
cp .env.example .env
```

Then fill in the required values.

### Environment variables

| Variable | Description |
| -------- | ----------- |
| `DISCORD_TOKEN` | Discord bot token from the Discord Developer Portal. |
| `DISCORD_CLIENT_ID` | Discord application client ID. |
| `DISCORD_GUILD_ID` | Optional. If set, slash commands are registered only to that guild. If omitted, commands are registered globally. |
| `DATABASE_URL` | PostgreSQL connection string. |
| `API_PORT` | Port for the Fastify API. |
| `BOT_PUBLIC_URL` | Public URL reserved for callback/verification flows. |
| `LEETCODE_FETCH_USER_AGENT` | User-agent string for LeetCode HTTP requests. |
| `LOG_LEVEL` | Pino log level. |

#### Important `DISCORD_GUILD_ID` behavior

- If `DISCORD_GUILD_ID` is set, the bot registers slash commands only for that one server.
- If you invite the bot to a different server, update `DISCORD_GUILD_ID` to that server’s ID and restart the bot.
- If you want the commands available in every server, remove `DISCORD_GUILD_ID` and restart the bot. Global command propagation can take a little while.

#### `DATABASE_URL` examples

- Docker Compose Postgres:

```env
DATABASE_URL=postgresql://postgres:postgres@db:5432/leetcord?schema=public
```

- Local Postgres outside Docker:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/leetcord?schema=public
```

- Hosted Postgres or Supabase:
  Use the exact connection string from your provider.

#### 3. Generate Prisma client and run migrations

```bash
pnpm prisma:generate
pnpm prisma:migrate
```

#### 4. Run the services in development

##### Option A: three terminals

Run each service in its own terminal from the repo root:

```bash
pnpm dev:api
```

```bash
pnpm dev:bot
```

```bash
pnpm dev:worker
```

##### Option B: one terminal

Run all three long-lived dev processes in one terminal:

```bash
pnpm -r --parallel --stream \
  --filter @leetcord/api \
  --filter @leetcord/bot \
  --filter @leetcord/worker \
  dev
```

Stop everything with `Ctrl+C`.

#### 5. Build if shared packages changed

If you changed shared package code and dev output looks stale, rebuild the workspace:

```bash
pnpm build
```

#### 6. Run with Docker

```bash
docker-compose up --build
```

### Expected startup logs

Healthy startup usually includes logs like:

- API: `API listening`
- Bot: `Registered slash commands` and `Bot ready`
- Worker: `Fetched and stored today daily problem`

### Add the bot to a Discord server

1. Open the Discord Developer Portal for your application.
2. Go to `OAuth2` -> `URL Generator`.
3. Select scopes:
   - `bot`
   - `applications.commands`
4. Select permissions for the bot.
   - Easiest for development: `Administrator`
   - Minimum practical set: `View Channels`, `Send Messages`, `Embed Links`
5. Open the generated invite URL, choose your server, and authorize the bot.
6. Make sure `.env` is configured for that server:
   - set `DISCORD_GUILD_ID=<that_server_id>` for guild-scoped development commands
   - or remove `DISCORD_GUILD_ID` for global commands
7. Restart the bot so it re-registers slash commands.

### API endpoints

The API app exposes:

- `GET /health`
- `POST /link/verification/start`
- `POST /link/verification/complete`

### Troubleshooting

#### Slash commands do not appear in Discord

- Make sure the bot was invited with the `applications.commands` scope.
- Check whether `DISCORD_GUILD_ID` is pointing at a different server.
- Restart the bot after changing `.env`.
- If using global commands, give Discord some time to propagate them.

#### The worker did not cache the daily problem on startup

The worker fetches the daily problem once during startup, then again on the next scheduled daily run. If your database was paused or unavailable during startup, the worker may miss that startup cache write and continue running.

In that case:

1. wait for the database to become available
2. restart the worker, or rerun the one-terminal command

#### Completion-feed posts are pinging users who do not want pings

Users can run `/me` and use the button on their own stats response to disable completion-feed pings. After that, automated completion-feed posts use their LeetCode username instead of a Discord mention.

### Development notes

- All code is written in TypeScript with `strict` mode enabled.
- Prisma is used for the PostgreSQL schema and client.
- Zod is used for environment validation and external response validation.
- `discord.js` powers the bot and only slash commands are used.
- Fastify is used for the HTTP API.
- `node-cron` is used for scheduled worker jobs.
