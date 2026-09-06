// Shared run-record bookkeeping for the report's evidence trail (report plan 1.5).
// Every tool that executes a scenario (verify-results.ts, bench.ts) appends records here
// through this module so the JSON stays one consistent shape.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface RunRecord {
  id: string;
  scenario: string | null;
  kind: 'baseline' | 'functional' | 'sizing' | 'benchmark' | 'cloud';
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Furthest pipeline phase the run observably reached. import covers the pre-solve
   *  inspection; schedule means the solver started but no result JSON exists; audit means a
   *  result JSON was written by the full pipeline (schedule + resources + audit bundle);
   *  cloud-api means the deployed-worker walk (create, revisions, shares, sources) completed. */
  phase: 'import' | 'schedule' | 'audit' | 'cloud-api';
  /** Every issue code and solver unscheduled-reason code recorded by the run, with counts. */
  issueCodes: Record<string, number>;
  resultPath: string | null;
  inspect: unknown;
  recordedAt: string;
  notes?: string;
}

const recordsPath = resolve(import.meta.dirname, 'run-records.json');

export function loadRecords(): RunRecord[] {
  if (!existsSync(recordsPath)) return [];
  return (JSON.parse(readFileSync(recordsPath, 'utf8')) as { records: RunRecord[] }).records;
}

export function saveRecord(record: Omit<RunRecord, 'issueCodes'> & { issueCodes?: Record<string, number> }): void {
  const fixed = { ...record, issueCodes: record.issueCodes ?? {} } as RunRecord;
  const records = loadRecords().filter(existing => existing.id !== fixed.id);
  records.push(fixed);
  records.sort((a, b) => a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0);
  writeFileSync(recordsPath, JSON.stringify({ records }, null, 2) + '\n');
}

/** Tally repeated codes into a count map, preserving first-seen order. */
export function countCodes(codes: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const code of codes) counts[code] = (counts[code] ?? 0) + 1;
  return counts;
}

/** Classify how far a CLI run observably got, from its streams and output artifacts. */
export function furthestPhase(resultWritten: boolean, stderrJson: unknown, exitCode: number): 'import' | 'schedule' | 'audit' {
  if (resultWritten) return 'audit';
  // The CLI prints the pre-solve inspection to stderr before scheduling starts; a non-zero
  // exit after that point means a later stage crashed with no result JSON.
  if (stderrJson && typeof stderrJson === 'object' && 'stage' in stderrJson && exitCode !== 0) return 'schedule';
  return 'import';
}

export const root = resolve(import.meta.dirname, '..', '..');
