import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

// Empty CSV cells become NULL (e.g. PAY-7001 failure_reason, blank estimated_arrival).
export function parseCsv(text: string): Record<string, string | null>[] {
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Record<
    string,
    string
  >[];
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === '' ? null : v])),
  );
}

export function readCsv(path: string) {
  return parseCsv(readFileSync(path, 'utf8'));
}
