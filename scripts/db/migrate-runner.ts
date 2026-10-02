/** The part of a `pg` client the runner uses, so tests can pass a fake. */
export interface MigrationClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface RunOptions {
  /** Run every pending file in one transaction that is rolled back at the end, and apply nothing. */
  dryRun?: boolean;
  /** Reads a migration file's SQL by file name. */
  read: (file: string) => string;
  log?: (line: string) => void;
}

export interface RunResult {
  applied: string[];
  skipped: string[];
  /** Backfill report rows per migration, for migrations that record one (see migration_backfill_report). */
  reports: Record<string, { step: string; count: number }[]>;
}

/**
 * A migration that backfills data records what it did in `migration_backfill_report` (migration, step, row_count). This
 * reads those rows back while the migration's transaction is still open, so a dry run can show them before it rolls back.
 */
async function backfillReport(client: MigrationClient, file: string): Promise<{ step: string; count: number }[]> {
  const present = await client.query("select to_regclass('migration_backfill_report') is not null as present");
  if (present.rows[0]?.present !== true) return [];
  const rows = await client.query(
    'select step, row_count from migration_backfill_report where migration = $1 order by step',
    [file.replace(/\.sql$/, '')],
  );
  return rows.rows.map((r) => ({ step: String(r.step), count: Number(r.row_count) }));
}

/**
 * Applies the pending migrations in file-name order. With `dryRun`, all of them run inside one transaction (so a later
 * migration sees an earlier one's changes, as it will for real) and that transaction is rolled back: nothing is
 * recorded or changed, but constraint, backfill and syntax errors surface, and the backfill report is printed.
 */
export async function runMigrations(
  client: MigrationClient,
  files: string[],
  { dryRun = false, read, log = () => undefined }: RunOptions,
): Promise<RunResult> {
  const result: RunResult = { applied: [], skipped: [], reports: {} };
  const report = async (file: string) => {
    const rows = await backfillReport(client, file);
    if (rows.length === 0) return;
    result.reports[file] = rows;
    log(`  backfill report for ${file}`);
    for (const r of rows) log(`    ${String(r.count).padStart(6)}  ${r.step}`);
  };

  if (dryRun) await client.query('begin');
  try {
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => String(r.name)));
    for (const file of [...files].sort()) {
      if (done.has(file)) {
        result.skipped.push(file);
        log(`skip    ${file}`);
        continue;
      }
      if (!dryRun) await client.query('begin');
      try {
        await client.query(read(file));
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await report(file);
        if (!dryRun) await client.query('commit');
        result.applied.push(file);
        log(dryRun ? `would apply ${file}` : `applied ${file}`);
      } catch (error) {
        if (!dryRun) await client.query('rollback');
        log(`failed  ${file}`);
        throw error;
      }
    }
  } finally {
    if (dryRun) {
      await client.query('rollback');
      log('dry run: rolled back, nothing was applied');
    }
  }
  return result;
}
