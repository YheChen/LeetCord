# LeetCord – Context for Codex

Use this document as context when continuing work on the LeetCord MVP. It describes the project, what exists, what’s left, and how to work in this codebase.

---

## 0. What needs to be done for a working, deployable Discord bot

To have a bot you can **invite to a server and actually use**, everything below must be done. Order is roughly by dependency.

| # | What | Why |
|---|------|-----|
| 1 | **LeetCode client** – Real fetching in `HttpLeetCodeClient` (profile, daily problem, bio check, daily completion). | Without this, linking and stats are fake; `/me` and `/daily` are useless. |
| 2 | **Bot: inject services** – In `apps/bot`, create Prisma + LeetCode client + core services and pass them into command creation. | Handlers need LinkService, LeaderboardService, etc. to do anything real. |
| 3 | **Bot: wire `/link`** – Call `LinkService.createVerification`, reply with the verification code and clear instructions. | Users must be able to start linking. |
| 4 | **Bot: wire `/verify`** – Call `LinkService.verifyUser`, reply success/failure. | Linking must complete or users stay “pending” forever. |
| 5 | **Bot: wire `/me`** – Load UserLink + latest UserStatsSnapshot (and daily completion) for target user; reply with embed or “not linked”. | Core value: see your stats. |
| 6 | **Bot: wire `/daily`** – Load today’s DailyProblem from DB + caller’s completion; reply with embed. | Core value: see today’s problem and whether you did it. |
| 7 | **Bot: add `/unlink`** – Call `LinkService.unlinkUser`; confirm. | Users need a way to disconnect. |
| 8 | **Bot: add `/leaderboard`** (mode: total \| weekly \| daily) – Use LeaderboardService, respect `leaderboardEnabled`, reply with embed. | Server engagement feature. |
| 9 | **Bot: add `/setup` commands** – daily-channel, timezone, leaderboard enabled; admin-only, call GuildSettingsService. | Admins need to configure the server. |
| 10 | **Worker: wire jobs to services** – Fetch daily, refresh stats, refresh daily completion, compute weekly snapshot; worker instantiates Prisma + LeetCode + StatsSyncService. | Data stays up to date; weekly leaderboard works. |
| 11 | **Worker: daily posts** – postDailyProblemJob loads guilds with dailyChannelId, gets today’s problem, posts to each channel (worker needs a way to send Discord messages, e.g. shared bot client or internal API). | Daily channel feature actually works. |
| 12 | **Core: weekly leaderboard** – Implement real delta logic in `StatsSyncService.computeWeeklyLeaderboardSnapshotForGuild`. | Weekly leaderboard shows real “solved this week”. |
| 13 | **API: verification routes** (optional for bot-only deploy) – Wire start/complete to LinkService if you use API for verification; otherwise bot-only flow is enough. | Needed only if verification is done via web instead of Discord. |
| 14 | **Deploy** – Production env (DATABASE_URL, DISCORD_TOKEN, etc.), run migrations, run bot (+ optional API + worker). Use a process manager (e.g. systemd, PM2) or host (e.g. Railway, Fly.io) that restarts on crash. | Bot stays online and connected. |

**Minimum for “working in one server”:** 1–9 (LeetCode client + all bot commands wired and added). Then 10–12 for fresh data and leaderboards; 11 for daily channel; 14 for deploy.

---

## 1. Project goal

**LeetCord** is a Discord bot + backend for LeetCode communities. Users can:

- Link Discord ↔ LeetCode (verify via code in LeetCode profile bio).
- View cached LeetCode stats and daily completion via slash commands.
- See server-scoped leaderboards (total solved, weekly delta, daily completion).
- Admins configure a daily channel; the bot posts the daily problem on a schedule.

**MVP scope:** account linking with verification, `/me` and `/daily`, leaderboards, daily channel setup, worker that syncs stats and posts daily. All external LeetCode access is behind an adapter interface.

---

## 2. Repo structure and tech stack

- **Monorepo:** pnpm workspaces. Root `package.json` has scripts like `pnpm dev:bot`, `pnpm dev:api`, `pnpm dev:worker`, `pnpm prisma:migrate`, `pnpm prisma:generate`.
- **Apps:**
  - `apps/bot` – Discord bot (discord.js v14), slash commands only. Entry: `src/index.ts`.
  - `apps/api` – Fastify HTTP API (health, verification/link endpoints). Entry: `src/index.ts`.
  - `apps/worker` – node-cron jobs (fetch daily, refresh stats, refresh daily completion, post daily, weekly leaderboard). Entry: `src/index.ts`.
- **Packages:**
  - `packages/shared` – Types (`LeetCodeProfileStats`, `LeetCodeDailyProblem`, `LeaderboardEntry`, etc.), Zod schemas (env, LeetCode responses), `createLogger` (pino), time helpers (`toDateOnly`, `startOfWeekUtc`), `DISCORD_COMMANDS` and cron constants.
  - `packages/leetcode-client` – `LeetCodeClient` interface and `HttpLeetCodeClient` implementation. Factory: `createLeetCodeClient(userAgent)`. **Implement real fetching/scraping here; keep interface stable.**
  - `packages/database` – Prisma schema + `getPrismaClient()`. Run migrations from this package (`pnpm --filter @leetcord/database prisma:migrate:dev`).
  - `packages/core` – Domain services: `LeetCodeService`, `LinkService`, `StatsSyncService`, `GuildSettingsService`, `LeaderboardService`. All take injected deps (PrismaClient, LeetCodeClient/LeetCodeService). **Business logic lives here, not in command handlers or API controllers.**

**Stack:** TypeScript (strict, no `any`), Node.js, discord.js, Fastify, Prisma, PostgreSQL, Zod, pino, dotenv, node-cron, pnpm. Docker/docker-compose for local dev.

---

## 3. Data model (Prisma)

- **UserLink** – `discordUserId` (unique), `leetcodeUsername`, `verified`, `verificationCode`, `verificationExpiresAt`. Relations: `UserStatsSnapshot[]`, `DailyCompletion[]`.
- **GuildSettings** – `guildId` (unique), `dailyChannelId`, `timezone`, `leaderboardEnabled`.
- **UserStatsSnapshot** – `userLinkId`, counts (total/easy/medium/hard), `streakCount`, `contestRating`, `lastSubmissionAt`, `fetchedAt`.
- **DailyProblem** – `date` (unique), `title`, `slug` (unique), `difficulty`, `url`, `fetchedAt`. Relations: `DailyCompletion[]`, `GuildDailyPost[]`.
- **DailyCompletion** – `userLinkId`, `dailyProblemId`, `completed`, `detectedAt`, `source`. Unique on `(userLinkId, dailyProblemId)`.
- **GuildDailyPost** – `guildId`, `dailyProblemId`, `messageId`, `postedAt`.
- **WeeklyLeaderboardSnapshot** – `guildId`, `weekStart`, `payloadJson` (Json), indexed on `(guildId, weekStart)`.

Schema path: `packages/database/prisma/schema.prisma`.

---

## 4. Key conventions

- **No `any`.** Use proper types or `unknown` with guards.
- **Zod** for env (see `packages/shared/src/schemas/env.ts` and app-specific `config/env.ts`) and for validating external/API responses.
- **Pino** for logging via `createLogger({ name: '...' })` from `@leetcord/shared`.
- **Thin handlers:** Discord command handlers and Fastify route handlers should only parse input, call one or more services, and format the response. No business logic in handlers.
- **Dependency injection:** Services receive Prisma and LeetCode client/service in constructors. Apps (bot, api, worker) should instantiate these once and pass them into commands or jobs.
- **LeetCode behind interface:** All LeetCode access goes through `LeetCodeClient` in `packages/leetcode-client`. The HTTP implementation can change (scraping, GraphQL, etc.); the interface and types in `@leetcord/shared` stay the contract.

---

## 5. What’s already implemented

- Monorepo, workspace config, root and per-package `package.json` and `tsconfig`.
- Prisma schema and migrations; `getPrismaClient()` in `packages/database`.
- Shared types, Zod schemas, logger, time utils, `DISCORD_COMMANDS` and cron constants.
- `LeetCodeClient` interface; `HttpLeetCodeClient` with **placeholder** implementations (returns stub data / false). File: `packages/leetcode-client/src/adapters/HttpLeetCodeClient.ts`.
- Core services in `packages/core`: `LinkService` (createVerification, verifyUser, unlinkUser), `LeetCodeService` (wraps client, normalizes dates, safe fallbacks), `GuildSettingsService`, `StatsSyncService` (refresh stats/daily problem/daily completion, weekly snapshot placeholder), `LeaderboardService` (total, daily completion, weekly from snapshot).
- Bot: `DiscordBotService` registers and dispatches slash commands. **Registered today:** `/ping`, `/link`, `/verify`, `/me`, `/daily`. Handlers are stubs (reply with text; TODOs for calling services). Embed helpers: `buildUserStatsEmbed`, `buildDailyProblemEmbed` in `apps/bot/src/embeds/`.
- API: Fastify app with `/health`, `/link/verification/start`, `/link/verification/complete`. Verification controllers are placeholders (TODOs for LinkService).
- Worker: Cron schedulers registered; job functions only log (TODOs for calling StatsSyncService / posting to Discord).
- Env: `.env.example` lists all variables. Each app has a Zod-validated env loader in `src/config/env.ts`.
- Docker: `docker-compose.yml` (db, api, bot, worker) and Dockerfiles under `docker/`.
- README with layout, quick start, env vars, and TODOs.

---

## 6. What still needs to be done

### 6.1 LeetCode client (packages/leetcode-client)

- In `HttpLeetCodeClient`, replace placeholders with real logic:
  - **getProfile(username)** – Fetch public profile (e.g. leetcode.com/username or GraphQL), parse total/easy/medium/hard solved, streak, contest rating, last submission; return typed `LeetCodeProfileStats` (validate with Zod).
  - **getDailyProblem()** – Fetch today’s daily challenge (title, slug, difficulty, URL).
  - **checkVerificationCode(username, code)** – Fetch profile/bio and return whether the string `code` appears in bio.
  - **checkDailyCompletion(username, dailySlug)** – Determine if user solved that problem (e.g. recent submissions or activity).
- Add retries, rate limiting, and graceful handling of failures (no uncaught throws).
- Keep the public `LeetCodeClient` interface unchanged; all changes inside the adapter.

### 6.2 Bot: wire commands to services

- **Bootstrap:** In `apps/bot`, create Prisma client, LeetCode client, and core services (LeetCodeService, LinkService, GuildSettingsService, LeaderboardService). Pass them into `createCoreSlashCommands(services)` or equivalent so handlers can call them.
- **/link** – Call `LinkService.createVerification(interaction.user.id, username)`. Reply with the verification code and instructions (put code in LeetCode bio, then run /verify).
- **/verify** – Call `LinkService.verifyUser(interaction.user.id)`. Reply success or failure.
- **/me [user]** – Resolve target user (option or self). Load UserLink by discord user id; get latest UserStatsSnapshot; optionally today’s DailyCompletion. Reply with `buildUserStatsEmbed` or “not linked” / error.
- **/daily** – Load today’s DailyProblem from DB (by date); for caller’s UserLink load DailyCompletion for that problem. Reply with `buildDailyProblemEmbed` and whether the user completed it.

### 6.3 Bot: add missing commands

- **/unlink** – Call `LinkService.unlinkUser(interaction.user.id)`; confirm or “not linked.”
- **/leaderboard mode:total|weekly|daily** – Check guild’s `leaderboardEnabled`; call `LeaderboardService.getTotalSolvedLeaderboardForGuild(guildId)`, or weekly snapshot, or daily completion list; reply with an embed (server-scoped only).
- **/setup daily-channel #channel** – Admin-only. Call `GuildSettingsService.updateDailyChannel(guildId, channel.id)`.
- **/setup timezone <string>** – Admin-only. Call `GuildSettingsService.updateTimezone(guildId, timezone)` (validate IANA timezone if possible).
- **/setup leaderboard enabled:true|false** – Admin-only. Call `GuildSettingsService.setLeaderboardEnabled(guildId, enabled)`.

Command names are in `packages/shared/src/constants/index.ts` (`DISCORD_COMMANDS`). Register these new commands in `DiscordBotService` the same way as existing ones.

### 6.4 Worker: call real services

- **Instantiate:** Worker needs Prisma, LeetCode client, LeetCodeService, StatsSyncService, GuildSettingsService (and a way to post to Discord for daily posts – see below).
- **fetchDailyProblemJob** – Call `StatsSyncService.refreshTodayDailyProblem()`.
- **refreshUserStatsJob** – Call `StatsSyncService.refreshUserStatsForAllLinkedUsers()`.
- **refreshDailyCompletionJob** – Call `StatsSyncService.refreshDailyCompletionForAllUsers()`.
- **computeWeeklyLeaderboardJob** – For each guild (e.g. from `GuildSettings` table), call `StatsSyncService.computeWeeklyLeaderboardSnapshotForGuild(guildId)`.
- **postDailyProblemJob** – Load guilds with `dailyChannelId` set; load today’s DailyProblem; post embed to each channel. This requires the worker to send Discord messages (e.g. shared Discord client, or bot exposing an internal API that the worker calls). Prefer reusing the same bot token/client if feasible.

### 6.5 Weekly leaderboard computation (packages/core)

- In `StatsSyncService.computeWeeklyLeaderboardSnapshotForGuild`, replace the placeholder payload with real logic: e.g. for each linked user in scope, compare UserStatsSnapshot at week start vs latest, compute delta (solved this week), sort, store as `payloadJson`. Define a typed shape for the payload if helpful (e.g. in shared types).

### 6.6 API verification routes (apps/api)

- **POST /link/verification/start** – Body: `{ discordUserId, leetcodeUsername }`. Validate with Zod. Call `LinkService.createVerification(...)`. Return verification code (or instructions) in response.
- **POST /link/verification/complete** – Body: `{ discordUserId }`. Call `LinkService.verifyUser(discordUserId)`. Return success/failure.

API needs to construct Prisma + LeetCodeService + LinkService (e.g. in a small factory or request-scoped container) so controllers can call them.

### 6.7 Testing

- Unit tests for core services (mock Prisma and LeetCode client).
- Parsing tests for LeetCode client responses.
- Integration tests for critical commands and API routes (test DB, optional Discord/API mocks).

---

## 7. File locations quick reference

| Concern | Location |
|--------|----------|
| Prisma schema | `packages/database/prisma/schema.prisma` |
| LeetCode interface | `packages/leetcode-client/src/adapters/LeetCodeClient.ts` |
| LeetCode HTTP impl | `packages/leetcode-client/src/adapters/HttpLeetCodeClient.ts` |
| Shared types/schemas | `packages/shared/src/types/`, `packages/shared/src/schemas/` |
| Command names & crons | `packages/shared/src/constants/index.ts` |
| Core services | `packages/core/src/services/*.ts` |
| Bot entry & commands | `apps/bot/src/index.ts`, `apps/bot/src/services/DiscordBotService.ts` |
| Bot embeds | `apps/bot/src/embeds/` |
| API routes & controllers | `apps/api/src/routes/`, `apps/api/src/controllers/` |
| Worker jobs & schedulers | `apps/worker/src/jobs/`, `apps/worker/src/schedulers/` |
| Env example | `.env.example` |

---

## 8. How to run (for Codex or a human)

```bash
pnpm install
cp .env.example .env   # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, DATABASE_URL, etc.
pnpm prisma:generate
pnpm prisma:migrate
pnpm dev:api    # terminal 1
pnpm dev:bot    # terminal 2
pnpm dev:worker # terminal 3
```

Or: `docker-compose up --build` (uses `.env` and starts db, api, bot, worker).

---

## 9. Deploying to a real Discord server

To invite and run the bot in a server:

1. **Discord Developer Portal** – Create an application, create a bot, copy token. Set redirect/callback URLs if you use OAuth. Under “OAuth2 → URL Generator”, enable scopes `bot` and (if needed) `applications.commands`. Invite the bot with the generated URL (manage server permission if admins will use `/setup`).
2. **Database** – Provision PostgreSQL (e.g. Neon, Supabase, Railway). Set `DATABASE_URL` in production env. Run `pnpm prisma:migrate` (or `prisma migrate deploy`) once against that DB.
3. **Environment** – In production, set at least: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_URL`, `LEETCODE_FETCH_USER_AGENT`. Optional: `DISCORD_GUILD_ID` (leave unset to register commands globally). `API_PORT` and `BOT_PUBLIC_URL` only if you run the API or need callbacks.
4. **What to run** – Minimum: the **bot** process (`pnpm --filter @leetcord/bot start` or `node apps/bot/dist/index.js` after build). For full features: also **worker** (cron jobs for sync and daily posts). API is optional unless you use verification via HTTP.
5. **Process management** – Use systemd, PM2, or your host’s process manager so the bot (and worker) restart on crash. Ensure Node version matches (e.g. 20+).
6. **Slash commands** – On first run the bot registers commands (guild if `DISCORD_GUILD_ID` is set, else global). New servers will see commands after invite if registered globally; guild-only registration is faster for dev.

Once 1–12 from section 0 are done and the bot process is running with a valid token and DB, the bot will be usable in any server it’s invited to.

---

When implementing, follow the existing patterns: thin handlers, logic in `@leetcord/core`, typed interfaces, Zod where input/output is external, and keep the LeetCode adapter behind the existing interface so it can be swapped or fixed without changing the rest of the app.
