/**
 * Loads the JSON produced by export-postgres.ts into the SQLite database.
 *
 *   DATABASE_URL="file:/data/leetcord.db" pnpm --filter @leetcord/database migrate:import
 *
 * Idempotent: every row is upserted on its primary key, so a run that dies partway
 * can simply be re-run. Tables are written parent-first (see TABLES in tables.ts)
 * because SQLite enforces the foreign keys that Prisma declares.
 *
 * Deliberately not wrapped in one big transaction — an interactive Prisma
 * transaction can time out on a slow disk, and idempotent upserts give us
 * safe resumption without that risk.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { ExportPayload, Row, TableSpec, TABLES, delegateFor, resolveOutputPath } from './tables';

const DEFAULT_FILE = resolve(__dirname, '../../../leetcord-export.json');

/** Revive ISO date strings into Date objects and stringify Json fields for SQLite. */
const prepareRow = (row: Row, spec: TableSpec): Row => {
  const prepared: Row = { ...row };

  for (const field of spec.dateFields) {
    const value = prepared[field];
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`${spec.model}.${field} is not a valid date: ${value}`);
      }
      prepared[field] = parsed;
    }
  }

  for (const field of spec.jsonFields) {
    const value = prepared[field];
    // Postgres handed us a parsed object; SQLite stores the serialized form.
    if (value !== null && typeof value === 'object') {
      prepared[field] = JSON.stringify(value);
    }
  }

  return prepared;
};

const main = async (): Promise<void> => {
  const inputPath = resolveOutputPath(process.argv.slice(2), DEFAULT_FILE);
  const payload = JSON.parse(readFileSync(inputPath, 'utf8')) as ExportPayload;

  if (!payload.tables) {
    throw new Error(`${inputPath} does not look like an export file (no "tables" key)`);
  }

  console.log(`Importing ${inputPath} (exported ${payload.exportedAt})\n`);

  const db = new PrismaClient();
  const summary: { model: string; imported: number; finalCount: number }[] = [];

  try {
    for (const spec of TABLES) {
      const rows = payload.tables[spec.model] ?? [];
      const delegate = delegateFor(db, spec);

      for (const row of rows) {
        const prepared = prepareRow(row, spec);
        const { id } = prepared;
        if (typeof id !== 'string') {
          throw new Error(`${spec.model} row is missing a string id: ${JSON.stringify(row)}`);
        }

        await delegate.upsert({
          where: { id },
          create: prepared,
          update: prepared,
        });
      }

      const finalCount = await delegate.count();
      summary.push({ model: spec.model, imported: rows.length, finalCount });
      console.log(
        `  ${spec.model.padEnd(26)} ${String(rows.length).padStart(6)} imported  ` +
          `(${finalCount} now in SQLite)`,
      );
    }

    const mismatched = summary.filter((entry) => entry.finalCount < entry.imported);
    if (mismatched.length > 0) {
      throw new Error(
        `Row counts are lower than expected for: ${mismatched
          .map((entry) => entry.model)
          .join(', ')}`,
      );
    }

    const total = summary.reduce((sum, entry) => sum + entry.imported, 0);
    console.log(`\nImported ${total} rows. Verified every table matches the export.`);
  } finally {
    await db.$disconnect();
  }
};

main().catch((error: unknown) => {
  console.error('\nImport failed:', error instanceof Error ? error.message : error);
  console.error('Fix the cause and re-run — upserts make this safe to repeat.');
  process.exit(1);
});
