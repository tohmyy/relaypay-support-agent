import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runMigrations, type MigrationClient } from '../scripts/db/migrate-runner';

// Build Plan V4, Window 6: static checks of the ownership migration (no database is needed or touched) and unit tests of
// the dry-run logic with a fake `pg` client.

const FILE = '20261007000017_ticket_escalation_ownership.sql';
const sql = readFileSync(`supabase/migrations/${FILE}`, 'utf8');
const lower = sql.toLowerCase();
/** Position of the first match, failing the test if there is none. */
const at = (pattern: RegExp, from = 0) => {
  const m = pattern.exec(sql.slice(from));
  if (!m) throw new Error(`not found: ${pattern}`);
  return from + m.index;
};
/** The text of one function: from its `create or replace function name(` to the closing `$fn$;`. */
function functionBody(name: string): string {
  const start = at(new RegExp(`create or replace function ${name}\\(`, 'i'));
  return sql.slice(start, at(/\$fn\$;/, at(/\$fn\$\s*\n/, start) + 5));
}

describe('migration 20261007000017: ticket / escalation ownership', () => {
  it('sorts after the existing migrations', () => {
    const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
    expect(files.at(-1)).toBe(FILE);
  });

  it('is written to be re-run: guarded creates, constraints dropped before they are added, balanced quoting', () => {
    expect(lower).not.toMatch(/create (unique )?index (?!if not exists)/);
    expect(lower).not.toMatch(/create table (?!if not exists)/);
    expect(lower).not.toMatch(/add column (?!if not exists)/);
    expect((lower.match(/add constraint/g) ?? []).length).toBe((lower.match(/drop constraint if exists/g) ?? []).length);
    expect((sql.match(/\$fn\$/g) ?? []).length % 2).toBe(0);
    expect((sql.match(/\$\$/g) ?? []).length % 2).toBe(0);
  });

  it('normalises ticket status and backfills before the constraints that depend on them (AC-43.2)', () => {
    const normalise = at(/update support_tickets\s+set status = case/i);
    const statusCheck = at(/add constraint support_tickets_status_check/i);
    expect(normalise).toBeLessThan(statusCheck);
    expect(sql).toMatch(/check \(status in \('open', 'in_progress', 'closed'\)\)/);

    const backfill = at(/-- \(a\) Link to the latest ticket/);
    const quarantine = at(/insert into escalations_quarantine/i);
    const orphanDelete = at(/delete from escalations e/i);
    const notNull = at(/alter table escalations alter column ticket_id set not null/i);
    expect(backfill).toBeLessThan(quarantine);
    expect(quarantine).toBeLessThan(orphanDelete);
    expect(orphanDelete).toBeLessThan(notNull);
    // Rows are copied before they are removed, and the quarantine table keeps the whole row.
    expect(sql).toMatch(/original jsonb not null/);
    expect(sql).toMatch(/to_jsonb\(e\)/);
  });

  it('records a backfill report with linked, created and quarantined counts', () => {
    expect(sql).toMatch(/create table if not exists migration_backfill_report/i);
    for (const step of ['linked to an existing ticket', 'tickets created', 'quarantined', 'duplicate open escalations closed']) {
      expect(sql).toContain(step);
    }
  });

  it('requires the unique (ticket_id, conversation_id) pair before the composite foreign key', () => {
    const unique = at(/create unique index if not exists support_tickets_ticket_conversation_key\s+on support_tickets \(ticket_id, conversation_id\)/i);
    const fk = at(/foreign key \(ticket_id, conversation_id\) references support_tickets \(ticket_id, conversation_id\)/i);
    expect(unique).toBeLessThan(fk);
  });

  it('makes ticket_id and conversation_id mandatory on escalations and checks the ticket id format', () => {
    expect(sql).toMatch(/alter table escalations alter column ticket_id set not null/i);
    expect(sql).toMatch(/alter table escalations alter column conversation_id set not null/i);
    expect(sql).toContain("check (ticket_id ~ '^TKT-[0-9]{6}$')");
  });

  it('allows one open escalation per conversation (AC-43.2 idempotency)', () => {
    expect(sql).toMatch(
      /create unique index if not exists escalations_one_open_per_conversation_key\s+on escalations \(conversation_id\) where status <> 'closed'/i,
    );
    // Existing duplicates are closed before the index is built.
    expect(at(/duplicate open escalations closed/)).toBeLessThan(at(/escalations_one_open_per_conversation_key/));
  });

  it('adds the owner pair check without breaking existing rows, and ends duplicate active AI conversations first (AC-44.1)', () => {
    expect(sql).toMatch(/conversations_owner_pair check \(\(user_id is null\) = \(customer_id is null\)\) not valid/i);
    expect(sql).toMatch(
      /create unique index if not exists conversations_one_active_ai_per_customer_key\s+on conversations \(customer_id\) where support_mode = 'ai' and ended_at is null/i,
    );
    expect(at(/duplicate active AI conversations ended/)).toBeLessThan(at(/create unique index if not exists conversations_one_active_ai/i));
    expect(sql).toMatch(/on conversations \(started_at desc, conversation_id desc\)/i);
  });

  it('adds the canonical turn columns with a unique stable id', () => {
    expect(sql).toMatch(/add column if not exists turn_uid uuid not null default gen_random_uuid\(\)/i);
    expect(sql).toMatch(/add column if not exists display_text text/i);
    expect(sql).toMatch(/add column if not exists spoken_text text/i);
    expect(sql).toMatch(/create unique index if not exists conversation_turns_turn_uid_key on conversation_turns \(turn_uid\)/i);
  });

  const PUBLIC_FUNCTIONS: Record<string, string> = {
    create_ticket_and_escalation: 'text, text, text, text, text, text, text, text, text, text, text, timestamptz, text',
    create_support_ticket_once: 'text, text, text, text, text',
    staff_claim_escalation: 'text, uuid',
    staff_release_escalation: 'text, uuid',
    staff_close_escalation: 'text, uuid',
    customer_end_escalation: 'text, text',
    add_human_message: 'text, text, text, uuid, uuid',
    replace_active_conversation: 'text, text',
  };

  it.each(Object.entries(PUBLIC_FUNCTIONS))('defines %s as service-role-only security definer', (name, args) => {
    const body = functionBody(name);
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = public/i);
    expect(sql).toContain(`revoke all on function ${name}(${args}) from public, anon, authenticated;`);
    expect(sql).toContain(`grant execute on function ${name}(${args}) to service_role;`);
  });

  it('takes the conversation lock first in every lifecycle function, so concurrent calls serialise', () => {
    for (const name of [
      'create_ticket_and_escalation',
      'create_support_ticket_once',
      'staff_claim_escalation',
      'staff_release_escalation',
      'staff_close_escalation',
      'customer_end_escalation',
      'add_human_message',
    ]) {
      expect(functionBody(name), name).toMatch(/from conversations where conversation_id = p_conversation_id for update/i);
    }
    expect(functionBody('replace_active_conversation')).toMatch(/from customers where customer_id = p_customer_id for update/i);
  });

  it('closes ticket and escalation together and leaves final_status alone on close (AC-46.2)', () => {
    const close = functionBody('staff_close_escalation');
    expect(close).toContain("support_mode = 'ended'");
    expect(close).toContain("end_reason = 'human-closed'");
    expect(close).toMatch(/ended_at = now\(\)/);
    expect(close).toContain("set_escalation_status(p_conversation_id, 'closed')");
    expect(close).not.toMatch(/final_status\s*=/);
    expect(close).toMatch(/'human_closed'/);
    const status = functionBody('set_escalation_status');
    expect(status).toMatch(/update escalations\s+set status = p_status/i);
    expect(status).toMatch(/update support_tickets t\s+set status = p_status/i);
  });

  it('claims to in_progress and releases to open, each with one event (AC-46.1)', () => {
    expect(functionBody('staff_claim_escalation')).toContain("set_escalation_status(p_conversation_id, 'in_progress')");
    expect(functionBody('staff_release_escalation')).toContain("set_escalation_status(p_conversation_id, 'open')");
    for (const name of ['staff_claim_escalation', 'staff_release_escalation', 'staff_close_escalation']) {
      expect((functionBody(name).match(/insert into conversation_events/gi) ?? []).length, name).toBe(1);
    }
  });

  it('reports a stale or repeated action with the current state instead of changing anything', () => {
    for (const outcome of ["'not-open'", "'taken'", "'already-mine'"]) {
      expect(functionBody('staff_claim_escalation')).toContain(outcome);
    }
    expect(functionBody('staff_close_escalation')).toContain("'not-open'");
    expect(functionBody('staff_claim_escalation')).toContain('escalation_state(p_conversation_id)');
  });

  it('rejects a message to a chat that is not open, and stores a retried message once', () => {
    const add = functionBody('add_human_message');
    expect(add).toMatch(/c\.support_mode <> 'human' or c\.ended_at is not null/);
    expect(add).toContain("'closed'");
    expect(add).toMatch(/on conflict \(conversation_id, client_msg_id\) do nothing/i);
  });

  it('reuses the open escalation and the conversation ticket instead of creating another', () => {
    const create = functionBody('create_ticket_and_escalation');
    expect(create).toMatch(/e\.status <> 'closed'/);
    expect(create).toContain("'created', false");
    expect(create).toContain("'created', true");
    expect(create).toMatch(/t\.conversation_id = p_conversation_id and t\.status <> 'closed'/);
  });
});

/** A `pg` stand-in that records every statement and answers the few reads the runner makes. */
function fakeClient(opts: { done?: string[]; report?: { step: string; row_count: number }[]; failOn?: RegExp } = {}) {
  const log: string[] = [];
  const client: MigrationClient = {
    async query(text: string) {
      log.push(text.trim().split('\n')[0].slice(0, 60));
      if (opts.failOn?.test(text)) throw new Error('boom');
      if (text.startsWith('select name from schema_migrations')) {
        return { rows: (opts.done ?? []).map((name) => ({ name })) };
      }
      if (text.includes("to_regclass('migration_backfill_report')")) return { rows: [{ present: opts.report !== undefined }] };
      if (text.includes('from migration_backfill_report')) return { rows: opts.report ?? [] };
      return { rows: [] };
    },
  };
  return { client, log };
}

describe('runMigrations --dry-run', () => {
  const files = ['20261006000015_a.sql', '20261006000016_b.sql', '20261007000017_c.sql'];
  const read = (file: string) => `-- ${file}`;

  it('runs the pending files in one transaction, rolls it back, and prints the backfill report', async () => {
    const { client, log } = fakeClient({
      done: ['20261006000015_a.sql'],
      report: [
        { step: 'escalations linked to an existing ticket', row_count: 3 },
        { step: 'escalations quarantined', row_count: 1 },
      ],
    });
    const lines: string[] = [];
    const result = await runMigrations(client, [...files].reverse(), { dryRun: true, read, log: (l) => lines.push(l) });

    expect(log[0]).toBe('begin');
    expect(log.at(-1)).toBe('rollback');
    expect(log).not.toContain('commit');
    expect(log.filter((l) => l === 'begin')).toHaveLength(1);
    // Applied in file-name order, the finished one skipped.
    expect(log.filter((l) => l.startsWith('-- '))).toEqual(['-- 20261006000016_b.sql', '-- 20261007000017_c.sql']);
    expect(result.applied).toEqual(['20261006000016_b.sql', '20261007000017_c.sql']);
    expect(result.skipped).toEqual(['20261006000015_a.sql']);
    expect(result.reports['20261007000017_c.sql']).toEqual([
      { step: 'escalations linked to an existing ticket', count: 3 },
      { step: 'escalations quarantined', count: 1 },
    ]);
    expect(lines.join('\n')).toMatch(/3\s+escalations linked to an existing ticket/);
    expect(lines.join('\n')).toMatch(/1\s+escalations quarantined/);
    expect(lines.at(-1)).toMatch(/rolled back, nothing was applied/);
    expect(lines).toContain('would apply 20261007000017_c.sql');
  });

  it('prints no report for a migration that records none', async () => {
    const { client } = fakeClient();
    const result = await runMigrations(client, files, { dryRun: true, read });
    expect(result.reports).toEqual({});
  });

  it('rolls back and reports which file failed when a migration errors', async () => {
    const { client, log } = fakeClient({ failOn: /-- 20261006000016_b/ });
    const lines: string[] = [];
    await expect(runMigrations(client, files, { dryRun: true, read, log: (l) => lines.push(l) })).rejects.toThrow('boom');
    expect(log.at(-1)).toBe('rollback');
    expect(log).not.toContain('commit');
    expect(lines).toContain('failed  20261006000016_b.sql');
    // The file after the failing one never ran.
    expect(log).not.toContain('-- 20261007000017_c.sql');
  });
});

describe('runMigrations (apply)', () => {
  const read = (file: string) => `-- ${file}`;

  it('commits each pending file in its own transaction and skips the finished ones', async () => {
    const { client, log } = fakeClient({ done: ['a.sql'] });
    const result = await runMigrations(client, ['a.sql', 'b.sql', 'c.sql'], { read });
    expect(result.applied).toEqual(['b.sql', 'c.sql']);
    expect(log.filter((l) => l === 'begin')).toHaveLength(2);
    expect(log.filter((l) => l === 'commit')).toHaveLength(2);
    expect(log).not.toContain('rollback');
  });

  it('rolls back only the failing file and stops', async () => {
    const { client, log } = fakeClient({ failOn: /-- b\.sql/ });
    await expect(runMigrations(client, ['a.sql', 'b.sql', 'c.sql'], { read })).rejects.toThrow('boom');
    expect(log.filter((l) => l === 'commit')).toHaveLength(1);
    expect(log.filter((l) => l === 'rollback')).toHaveLength(1);
    expect(log).not.toContain('-- c.sql');
  });
});
