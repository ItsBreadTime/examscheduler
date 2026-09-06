// Sensitivity experiment for the solver's fixed heuristic constants (report chapter on
// performance): the student-burden weights (10 per same-day pair, 3 per adjacent-day pair,
// src/lib/solver.ts line 108) and the feasibility-budget fraction (0.6 * searchBudget,
// src/lib/solver.ts line 179).
//
// The working tree must stay byte-identical to the recorded application snapshot, so each
// variant runs from a THROWAWAY COPY of src/lib in a temp directory where only the probed
// constants are patched. The variant's scheduleProject is cross-checked against the recorded
// results JSON before its metrics are recorded: variant 10:3 with factor 0.6 must reproduce
// the saved base run exactly (it is the unmodified behavior, recompiled from a copy).
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { importProject } from '../../src/lib/index.ts';
import type { Project, ProjectInput, SchedulerSettings } from '../../src/lib/index.ts';
import { root, saveRecord } from './records.ts';
import { createHash } from 'node:crypto';

const data = import.meta.dirname;
interface Manifest { courseSources: { path: string; role: 'managed' | 'context'; expectedPrefix?: string }[]; rules?: string; references?: { path: string; kind: 'rooms' }[]; settings: SchedulerSettings; locks?: ProjectInput['locks'] }
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const fixtures: [string, string, string][] = [
  ['เล็ก', 'clean/manifest.json', 'results-clean.json'],
  ['กลาง', 'benchmark/medium/manifest.json', 'results-bench-medium.json'],
  ['ใหญ่', 'benchmark/large/manifest.json', 'results-bench-large.json'],
];
const weightLine = 'burden += 10 * (counts?.get(slot.day) ?? 0) + 3 * ((counts?.get(slot.day - 1) ?? 0) + (counts?.get(slot.day + 1) ?? 0));';
const factorLine = 'const feasibilityBudget = Math.max(1, Math.floor(settings.searchBudget * 0.6));';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function loadProject(manifestPath: string): Promise<Project> {
  const manifest = read(manifestPath) as Manifest;
  const load = (name: string) => ({ name: basename(name), bytes: readFileSync(resolve(dirname(manifestPath), name)) });
  return importProject({ courseSources: manifest.courseSources.map(s => ({ ...load(s.path), role: s.role, expectedPrefix: s.expectedPrefix })), rules: manifest.rules ? load(manifest.rules) : undefined,
    references: (manifest.references ?? []).map(s => ({ ...load(s.path), kind: s.kind })), settings: manifest.settings, locks: manifest.locks });
}

interface Variant { id: string; weights: [number, number]; feasibilityFactor: number }
const variants: Variant[] = [
  { id: 'base-10-3-f0.6', weights: [10, 3], feasibilityFactor: 0.6 },
  { id: 'weights-5-1', weights: [5, 1], feasibilityFactor: 0.6 },
  { id: 'weights-3-1', weights: [3, 1], feasibilityFactor: 0.6 },
  { id: 'weights-1-0', weights: [1, 0], feasibilityFactor: 0.6 },
  { id: 'feasibility-f0.4', weights: [10, 3], feasibilityFactor: 0.4 },
  { id: 'feasibility-f0.8', weights: [10, 3], feasibilityFactor: 0.8 },
];

const baseTiming = (result: { project: { events: { id: string; timing: unknown }[] } }) =>
  Object.fromEntries(result.project.events.map(e => [e.id, JSON.stringify(e.timing ?? null)]));

for (const variant of variants) {
  const dir = mkdtempSync(join(tmpdir(), 'rex-sensitivity-'));
  cpSync(resolve(root, 'src', 'lib'), join(dir, 'lib'), { recursive: true });
  const solverPath = join(dir, 'lib', 'solver.ts');
  const original = readFileSync(solverPath, 'utf8');
  const newWeightLine = weightLine.replace('10 *', `${variant.weights[0]} *`).replace('+ 3 *', `+ ${variant.weights[1]} *`);
  const newFactorLine = factorLine.replace('* 0.6', `* ${variant.feasibilityFactor}`);
  assert.ok(original.includes(weightLine) && original.includes(factorLine), 'solver.ts source no longer contains the expected constant lines; update the patterns in sensitivity.ts');
  const patched = original.replace(weightLine, newWeightLine).replace(factorLine, newFactorLine);
  writeFileSync(solverPath, patched);
  try {
    const { scheduleProject } = await import(join(dir, 'lib', 'scheduler.ts'));
    for (const [label, manifestRelative, resultRelative] of fixtures) {
      const project = await loadProject(resolve(data, manifestRelative));
      const start = performance.now();
      const result = scheduleProject(project);
      const milliseconds = performance.now() - start;
      const recorded = read(resolve(data, resultRelative));
      if (variant.id === 'base-10-3-f0.6') {
        // The unmodified constants, recompiled from the copy, must reproduce the recorded run bit for bit.
        const mine = baseTiming(result as never), theirs = baseTiming(recorded);
        assert.deepEqual(mine, theirs, `${variant.id}/${label}: reproduced schedule differs from ${resultRelative}`);
        assert.equal(result.search.visitedNodes, recorded.search.visitedNodes, `${variant.id}/${label}: visitedNodes differs`);
      }
      const entry = {
        variant: variant.id, fixture: label,
        burdenWeights: { sameDay: variant.weights[0], adjacentDay: variant.weights[1] },
        feasibilityFactor: variant.feasibilityFactor,
        scheduledManagedEvents: result.quality.scheduledManagedEvents,
        searchBudget: result.search.budget, budgetExhausted: result.search.budgetExhausted,
        visitedNodes: result.search.visitedNodes, improvementEvaluations: result.search.improvementEvaluations,
        coverageOptimal: result.search.coverageOptimal, avoidedDaysOptimal: result.search.avoidedDaysOptimal,
        improvedEventLowerBound: result.search.avoidedEventLowerBound,
        quality: result.quality,
        wallMilliseconds: Math.round(milliseconds),
        patchedSolverSha256: sha(patched), originalSolverSha256: sha(original),
      };
      console.log(JSON.stringify({ variant: variant.id, fixture: label, scheduled: entry.scheduledManagedEvents, weekend: entry.quality.weekendExams, ms: entry.wallMilliseconds }));
      const allPath = resolve(data, 'sensitivity.json');
      const all: { recordedAt: string; note: string; variants: string[]; results: { variant: string; fixture: string }[] } =
        existsRead(allPath) ?? { recordedAt: '', note: '', variants: [], results: [] };
      all.note = 'Sensitivity of the solver outcome to its fixed heuristic constants. Each variant patches only the student-burden weights and/or the feasibility-budget fraction in a throwaway copy of src/lib; the working tree is never modified. The base variant (10:3, factor 0.6) must reproduce the recorded results exactly before any variant metric is trusted.';
      all.variants = [...new Set([...all.variants, variant.id])];
      all.results = [...all.results.filter(r => !(r.variant === variant.id && r.fixture === label)), entry];
      all.recordedAt = new Date().toISOString();
      writeFileSync(allPath, JSON.stringify(all, null, 2) + '\n');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  saveRecord({ id: `sensitivity-${variant.id}`, scenario: variant.id, kind: 'benchmark', command: 'node docs/data/sensitivity.ts', cwd: root,
    stdout: variants.find(v => v.id === variant.id)!.id, stderr: '', exitCode: 0, phase: 'schedule', issueCodes: {},
    resultPath: 'docs/data/sensitivity.json', inspect: null, recordedAt: new Date().toISOString(),
    notes: `Constants patched in a throwaway src/lib copy: burden weights ${variant.weights.join(':')}, feasibility factor ${variant.feasibilityFactor}. Patched solver sha256 recorded in sensitivity.json.` });
}
console.log('sensitivity results written to docs/data/sensitivity.json');
function existsRead(path: string): { recordedAt: string; note: string; variants: string[]; results: { variant: string; fixture: string }[] } | undefined {
  try { return read(path); } catch { return undefined; }
}
