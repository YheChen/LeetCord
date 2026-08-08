/**
 * Dumps every table from the Supabase Postgres database to a single JSON file.
 *
 * Safe to run repeatedly and safe to run while the bot is live — it only reads.
 * Run it once to rehearse the migration, then again at cutover to capture
 * whatever the Pi collected in the meantime.
 *
 *   POSTGRES_EXPORT_URL="postgresql://..." pnpm --filter @leetcord/database migrate:export
 *
 * Reads POSTGRES_EXPORT_URL rather than DATABASE_URL on purpose: after the cutover
 * DATABASE_URL points at the SQLite file, and this script still needs the old server.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '../generated/postgres-client';
import { ExportPayload, TABLES, delegateFor, resolveOutputPath } from './tables';

const DEFAULT_FILE = resolve(__dirname, '../../../leetcord-export.json');

const main = async (): Promise<void> => {
  if (!process.env.POSTGRES_EXPORT_URL) {
    throw new Error(
      'POSTGRES_EXPORT_URL is not set. Set it to the Supabase connection string, e.g.\n' +
        '  POSTGRES_EXPORT_URL="postgresql://user:pass@host:5432/postgres?sslmode=require"',
    );
  }

  const outputPath = resolveOutputPath(process.argv.slice(2), DEFAULT_FILE);
  const prisma = new PrismaClient();

  try {
    const tables: Record<string, Record<string, unknown>[]> = {};
    let total = 0;

    for (const spec of TABLES) {
      const rows = await delegateFor(prisma, spec).findMany();
      tables[spec.model] = rows;
      total += rows.length;
      console.log(`  ${spec.model.padEnd(26)} ${String(rows.length).padStart(6)} rows`);
    }

    const payload: ExportPayload = {
      exportedAt: new Date().toISOString(),
      source: 'postgresql',
      tables,
    };

    // Dates serialize to ISO strings here; import-sqlite.ts revives them.
    writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');

    console.log(`\nExported ${total} rows across ${TABLES.length} tables`);
    console.log(`Written to ${outputPath}`);
    console.log('\nThis file contains real user data (Discord IDs, LeetCode usernames).');
    console.log('It is gitignored — keep it off shared storage and delete it after cutover.');
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error: unknown) => {
  console.error('\nExport failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
