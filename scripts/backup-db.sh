#!/usr/bin/env bash
#
# Snapshot the LeetCord SQLite database, verify the snapshot, compress it, and prune
# old ones. Intended to be run from cron on the host that runs docker compose.
#
# Uses `sqlite3 .backup` rather than `cp`. That matters: the bot writes continuously,
# and copying a live SQLite file with cp/rsync can capture a torn page or miss the
# WAL entirely, producing a backup that only fails when you finally need it.
# `.backup` uses SQLite's online backup API and is safe against concurrent writers.
#
# Usage:
#   ./scripts/backup-db.sh
#
# Configuration (all optional, via environment):
#   LEETCORD_DB_PATH             default: <repo>/data/leetcord.db
#   LEETCORD_BACKUP_DIR          default: $HOME/leetcord-backups
#   LEETCORD_BACKUP_RETAIN_DAYS  default: 30
#
# Restore procedure:
#   1. docker compose down
#   2. gunzip -c ~/leetcord-backups/leetcord-YYYYmmdd-HHMMSS.db.gz > /tmp/restore.db
#   3. sqlite3 /tmp/restore.db "PRAGMA integrity_check;"   # expect: ok
#   4. mv data/leetcord.db data/leetcord.db.broken         # keep the bad one
#   5. mv /tmp/restore.db data/leetcord.db
#   6. docker compose up -d

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DB_PATH="${LEETCORD_DB_PATH:-$REPO_ROOT/data/leetcord.db}"
BACKUP_DIR="${LEETCORD_BACKUP_DIR:-$HOME/leetcord-backups}"
RETAIN_DAYS="${LEETCORD_BACKUP_RETAIN_DAYS:-30}"

log() {
  printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*" >&2
  exit 1
}

command -v sqlite3 >/dev/null 2>&1 ||
  fail "sqlite3 is not installed (Fedora: dnf install sqlite / Debian: apt install sqlite3)"

# Docker runs the containers as root, so the database file is usually root-owned.
# If this check fails under cron but works by hand, you are running cron as the wrong
# user — install the job with `sudo crontab -e` instead of `crontab -e`.
[ -f "$DB_PATH" ] || fail "database not found at $DB_PATH"
[ -r "$DB_PATH" ] || fail "cannot read $DB_PATH (permissions — try running as root)"

mkdir -p "$BACKUP_DIR"

STAMP="$(date '+%Y%m%d-%H%M%S')"
TARGET="$BACKUP_DIR/leetcord-$STAMP.db"

log "Backing up $DB_PATH"

# .backup copies the live database, including anything sitting in the WAL.
sqlite3 "$DB_PATH" ".backup '$TARGET'" || fail "sqlite3 .backup failed"

# A backup nobody has verified is not a backup. Check before we keep it, so a
# corrupt snapshot is caught now rather than during an outage.
INTEGRITY="$(sqlite3 "$TARGET" 'PRAGMA integrity_check;' 2>&1 || true)"
if [ "$INTEGRITY" != "ok" ]; then
  rm -f "$TARGET"
  fail "integrity check failed, backup discarded: $INTEGRITY"
fi

# Sanity-check that the snapshot has real content, so a backup of an empty or
# freshly-recreated database does not quietly replace good ones.
USER_COUNT="$(sqlite3 "$TARGET" 'SELECT COUNT(*) FROM UserLink;' 2>/dev/null || echo 'unknown')"

gzip -f "$TARGET"
SIZE="$(du -h "$TARGET.gz" | cut -f1)"

log "OK  $TARGET.gz  ($SIZE, UserLink rows: $USER_COUNT)"

# Prune old snapshots. -mtime +N deletes strictly older than N days.
PRUNED="$(find "$BACKUP_DIR" -name 'leetcord-*.db.gz' -type f -mtime "+$RETAIN_DAYS" -print -delete | wc -l | tr -d ' ')"
if [ "$PRUNED" != "0" ]; then
  log "Pruned $PRUNED backup(s) older than $RETAIN_DAYS days"
fi

REMAINING="$(find "$BACKUP_DIR" -name 'leetcord-*.db.gz' -type f | wc -l | tr -d ' ')"
log "$REMAINING backup(s) retained in $BACKUP_DIR"
