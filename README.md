## LeetCord

LeetCord is a Discord bot and backend stack for discord communities. It lets users link their LeetCode accounts, view cached stats, track the daily problem, compete on leaderboards, track streaks, and post automated daily updates inside Discord servers.

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

- Link a Discord user to a LeetCode account using a verification code placed in the README section of the user’s LeetCode profile.
- View cached LeetCode profile stats, including total solved, difficulty breakdown, streak, contest rating, and today’s daily status.
- Cache the current LeetCode daily problem in the database and let `/daily` backfill it on demand if it is missing.
- Track daily completion status for linked users, and refresh the caller's completion state on demand when `/daily` runs.
- Show server leaderboards for total solved, daily completions, and weekly progress snapshots.
- Post the daily problem into a configured server channel.
- Post automatic completion-feed updates when a linked user newly completes today’s daily.
- Let each user opt out of being pinged in automatic completion-feed posts from their own `/me` response.

### Slash commands

#### User commands

| Command | Description |
| ------- | ----------- |
| `/ping` | Check if the bot is alive. |
| `/link username:<your_username>` | Start linking your LeetCode account and generate a verification code to place in the README section of your LeetCode profile. |
| `/verify` | Complete the link verification by checking the README section of your LeetCode profile. |
| `/unlink` | Unlink your LeetCode account. |
| `/me [user]` | Show cached LeetCode stats for yourself or another linked user. On your own `/me`, a button lets you enable or disable completion-feed pings. |
| `/daily` | Show today’s LeetCode daily problem, attempt to cache it on demand if it is missing, and refresh your completion status if you are linked. |
| `/streak [user]` | Show current streak, longest streak, and total completed dailies. |
| `/leaderboard mode:<total\|weekly\|daily>` | Show the server leaderboard for all-time solved, this week’s progress, or today’s completions. |
| `/help` | Show setup instructions and the command list. |

### Command cooldowns

- `/daily`: 60 seconds
- `/link`, `/verify`: 15 seconds
- `/me`, `/streak`, `/leaderboard`: 10 seconds
- All other commands: no cooldown

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

#### Scheduled jobs

| Job | Schedule | Description |
| --- | -------- | ----------- |
| Fetch and post daily problem | `00:05 UTC` daily | Refreshes the cached daily problem and posts it to configured channels at a fixed UTC time. |
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
| `DISCORD_GUILD_ID` | Optional. If set, slash commands are registered to that one guild for fast development updates. |
| `DISCORD_GUILD_IDS` | Optional. Comma-separated guild IDs for fast multi-server development registration. |
| `DATABASE_URL` | SQLite database file, e.g. `file:/data/leetcord.db`. |
| `API_PORT` | Port for the Fastify API. |
| `BOT_PUBLIC_URL` | Base URL the bot uses to reach the API for verification and on-demand daily completion refreshes. |
| `LEETCODE_FETCH_USER_AGENT` | User-agent string for LeetCode HTTP requests. |
| `LOG_LEVEL` | Pino log level. |

#### Command registration behavior

- If `DISCORD_GUILD_IDS` is set, the bot registers slash commands to each guild in that comma-separated list.
- If `DISCORD_GUILD_IDS` is empty but `DISCORD_GUILD_ID` is set, the bot registers slash commands to that one guild.
- If neither is set, the bot registers commands globally for all servers. Global command propagation can take a little while.
- For fast development across multiple servers, prefer `DISCORD_GUILD_IDS`.

Example:

```env
DISCORD_GUILD_IDS=123456789012345678,987654321098765432
```

#### `DATABASE_URL` examples

LeetCord uses SQLite. The entire database is one file — there is no database server
to run, and nothing to host.

- Under Docker Compose, `docker-compose.yml` sets this for you and its value wins over
  anything in `.env`:

```env
DATABASE_URL=file:/data/leetcord.db
```

- Outside Docker, prefer an absolute path:

```env
DATABASE_URL=file:/home/you/LeetCord/data/leetcord.db
```

> **Relative paths are resolved against `packages/database/prisma/`**, the directory
> containing `schema.prisma` — not against your current working directory. So
> `file:./data/leetcord.db` creates `packages/database/prisma/data/leetcord.db`, which
> is rarely what you want. Use an absolute path unless you have a reason not to.

The database file is gitignored, along with its `-wal` and `-shm` sidecars. It holds
real user data, so keep it out of version control and back it up (see
[Backups](#backups)).

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
pnpm dev
```

Stop everything with `Ctrl+C`.

#### 5. Build if workspace packages changed

The app `dev` scripts import workspace packages from their built `dist/` outputs. If you changed or pulled updates in `packages/*` and `ts-node` reports missing methods or stale types, rebuild the workspace:

```bash
pnpm build
```

#### 6. Run with Docker

```bash
docker compose up --build -d
```

This starts four services. `migrate` runs `prisma migrate deploy` and exits; `api`,
`bot` and `worker` wait for it to succeed, then stay up with `restart: unless-stopped`
so they survive both crashes and host reboots.

All four bind-mount `./data` from the host, which is where `leetcord.db` lives. Because
it is a bind mount rather than a named volume, you can point `sqlite3`, backups and `cp`
straight at `./data/leetcord.db` without going through Docker.

Follow logs with:

```bash
docker compose logs -f bot worker
```

### Deployment

#### Requirements on the host

- Docker Engine with the Compose v2 plugin
- `sqlite3` (for backups) — `sudo dnf install sqlite` on Fedora, `sudo apt install
  sqlite3` on Debian/Ubuntu. Note the differing package names; both provide
  `/usr/bin/sqlite3`.
- A cron daemon. Fedora does not always install one — see
  [Fedora host setup](#fedora-host-setup).

Node.js and pnpm are **not** needed on the host. `docker/Dockerfile` installs and
builds everything inside the image, so the host only needs Docker.

All four services share one image, built once from `docker/Dockerfile` and differing
only in the command they run. Only the `migrate` service declares a `build:` block, so
`docker compose build` produces exactly one image rather than four near-identical ones.

#### Fedora host setup

Fedora differs from Debian/Ubuntu in three ways that will each break a deployment
silently if missed.

**1. SELinux.** Fedora runs SELinux in enforcing mode, and containers cannot write to
an unlabeled bind mount. `docker-compose.yml` already mounts `./data` with the `:z`
shared-label suffix, which handles this — but if you edit the volume lines, keep it.
Symptom if lost: Prisma fails to open the database with a permission error even though
the file's Unix permissions look fine. Confirm with `getenforce` (`Enforcing`) and
check denials with `sudo ausearch -m avc -ts recent`.

**2. Docker is not preinstalled.** Fedora ships Podman. `podman-compose` handles this
file's `depends_on: condition: service_completed_successfully` unreliably, so install
Docker CE:

```bash
sudo dnf -y install dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

On Fedora 41+ (dnf5) the repo line is instead:

```bash
sudo dnf config-manager addrepo --from-repofile=https://download.docker.com/linux/fedora/docker-ce.repo
```

Optionally avoid `sudo` for docker commands (log out and back in afterwards):

```bash
sudo usermod -aG docker $USER
```

**3. cron may be absent.** Fedora minimal and Server installs often ship without
`cronie`, so a crontab entry silently never runs:

```bash
sudo dnf -y install cronie
sudo systemctl enable --now crond
```

#### Running a laptop as a server

A ThinkPad suspends when you close the lid, which takes the bot offline. To keep it
running with the lid shut, edit `/etc/systemd/logind.conf` and set:

```ini
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
```

Then `sudo systemctl restart systemd-logind`. Beware that this restarts your login
session on some desktops — do it before you have anything unsaved.

Also stop the machine idling into suspend:

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

The API binds to `127.0.0.1:3000`, so no firewall changes are needed and nothing is
exposed to your LAN.

#### Moving to a new machine

The database is a file, so relocating LeetCord is: clone, copy `.env`, copy the `.db`
file, bring it up.

```bash
git clone <your-remote> LeetCord
cd LeetCord
cp /path/to/old/.env .env
mkdir -p data
scp you@oldhost:/path/to/LeetCord/data/leetcord.db data/
docker compose up --build -d
```

> **Do not copy `node_modules/`, `dist/`, or a generated Prisma client between machines
> of different architectures.** The Prisma query engine is a native binary — an arm64
> build from a Raspberry Pi will not run on an x86_64 host. The Dockerfile runs
> `prisma generate` during the image build for exactly this reason, so a clean
> `docker compose up --build` always produces the right binary.

Stop the old host only after the new one is confirmed healthy.

### Backups

Supabase took care of this invisibly. A SQLite file on a single machine does not, so
back it up.

`scripts/backup-db.sh` snapshots the database with `sqlite3 .backup`, verifies the
snapshot with `PRAGMA integrity_check`, compresses it, and prunes anything older than
the retention window. It uses the online backup API rather than `cp`, which matters
because the worker writes on a schedule and copying a live SQLite file can capture a
torn page or miss the WAL.

Run it by hand:

```bash
./scripts/backup-db.sh
```

Install it as a daily cron job at 03:30. The database file is root-owned because the
containers run as root, so install this under root's crontab (`sudo crontab -e`) —
a user crontab will fail with a permissions error:

```cron
30 3 * * * /home/you/LeetCord/scripts/backup-db.sh >> /var/log/leetcord-backup.log 2>&1
```

Configure with environment variables if the defaults do not suit:

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `LEETCORD_DB_PATH` | `<repo>/data/leetcord.db` | Database to back up. |
| `LEETCORD_BACKUP_DIR` | `$HOME/leetcord-backups` | Where snapshots are written. |
| `LEETCORD_BACKUP_RETAIN_DAYS` | `30` | Snapshots older than this are pruned. |

Backups default to outside the repo so `git clean` cannot destroy them. Copying them
periodically to a second machine or external disk is worth doing — a backup on the same
disk as the database does not survive that disk failing.

To restore, see the header comment in `scripts/backup-db.sh`.

### Migrating from Supabase Postgres to SQLite

One-off procedure, only relevant if you are moving an existing deployment. Everything
runs inside Docker, so the host needs no Node or pnpm. The export only reads from
Postgres and the import upserts on primary key, so the whole sequence is safe to
rehearse and safe to repeat while the old deployment keeps running.

Note that Supabase is reachable from anywhere with the connection string — if the old
host has died, your data is still fine and this procedure still works.

1. Add the old connection string to `.env`. Keep it separate from `DATABASE_URL`, which
   now points at SQLite:

```env
POSTGRES_EXPORT_URL=postgresql://user:password@host:5432/postgres?sslmode=require
```

2. Build the images:

```bash
docker compose build
```

3. Create the SQLite database and its tables:

```bash
docker compose run --rm migrate
```

4. Export from Supabase. This generates the frozen Postgres client, then dumps every
   table to `./data/leetcord-export.json` on the host (it lands in `./data` because that
   directory is already bind-mounted into the container):

```bash
docker compose run --rm -e MIGRATION_FILE=/data/leetcord-export.json api sh -c "pnpm --filter @leetcord/database migrate:generate-pg-client && pnpm --filter @leetcord/database migrate:export"
```

5. Import the dump into SQLite:

```bash
docker compose run --rm -e MIGRATION_FILE=/data/leetcord-export.json api pnpm --filter @leetcord/database migrate:import
```

6. Verify the row counts look like your real data, then start everything:

```bash
sqlite3 data/leetcord.db "SELECT COUNT(*) FROM UserLink;"
```

```bash
docker compose up -d
```

`MIGRATION_FILE` is used instead of the `--file` flag purely to avoid ambiguity over
whether pnpm forwards the argument to the script or consumes it itself.

If the old deployment is still live, re-run steps 4 and 5 at final cutover to pick up
anything it recorded in the meantime — repeating the import will not duplicate rows.

Afterwards, delete `data/leetcord-export.json` (it contains user data) and remove
`POSTGRES_EXPORT_URL` from `.env`.

Afterwards: delete `leetcord-export.json` (it contains user data), and keep the Supabase
project paused rather than deleted for a week or so in case you need to roll back. Once
you are confident, `packages/database/prisma/postgres-export.prisma`,
`packages/database/scripts/` and the `POSTGRES_EXPORT_URL` entry in `.env` can all go.

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
   - set `DISCORD_GUILD_ID=<that_server_id>` for one fast dev guild
   - or set `DISCORD_GUILD_IDS=<guild_1>,<guild_2>` for multiple fast dev guilds
   - or remove both to use global commands
7. Restart the bot so it re-registers slash commands.

### API endpoints

The API app exposes:

- `GET /health`
- `POST /daily/ensure-cached`
- `POST /daily/refresh-completion`
- `POST /link/verification/start`
- `POST /link/verification/complete`

### Troubleshooting

#### Slash commands do not appear in Discord

- Make sure the bot was invited with the `applications.commands` scope.
- Check whether `DISCORD_GUILD_ID` or `DISCORD_GUILD_IDS` is pointing at different servers.
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
- Prisma is used for the SQLite schema and client.
- Zod is used for environment validation and external response validation.
- `discord.js` powers the bot and only slash commands are used.
- Keep this README in sync with user-facing feature and command changes.
- Fastify is used for the HTTP API.
- `node-cron` is used for scheduled worker jobs.
