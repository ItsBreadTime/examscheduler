// Reproducible functional evidence. Run: node docs/data/verify-results.ts
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { countCodes, furthestPhase, root, saveRecord } from './records.ts';

const expected = JSON.parse(readFileSync(resolve(import.meta.dirname, 'expected.json'), 'utf8'));
const outcomes: any[] = [];
const observedIdentifiers = new Set<string>();
function classify(namespace: string, value: string | number) {
  // A spelling may validly exist in two APIs: classify occurrences by their source field.
  assert(expected.identifierClasses[namespace].includes(value), `Unclassified ${namespace}:${value}`);
  const qualified = `${namespace}:${value}`;
  assert.equal(Object.entries(expected.identifierClasses).filter(([key, values]: any) => key === namespace && values.includes(value)).length, 1);
  observedIdentifiers.add(qualified);
}
function run(scenario: any, output: string, suffix = '') {
  if (existsSync(output)) unlinkSync(output); // stale files cannot establish a reached phase
  const args = ['src/cli.ts', `docs/data/${scenario.dir}/manifest.json`, ...(scenario.mode === 'inspect' ? ['--inspect'] : ['--out', relative(root, output)])];
  const child = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, TZ: 'Asia/Bangkok' }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (child.error) throw child.error;
  const stdout = child.stdout, stderr = child.stderr, exitCode = child.status ?? -1;
  const inspection = scenario.mode === 'inspect' ? JSON.parse(stdout) : JSON.parse(stderr);
  const written = existsSync(output);
  const result = written ? JSON.parse(readFileSync(output, 'utf8')) : null;
  const issues = result?.validation.issues ?? inspection.issues;
  saveRecord({ id: `functional-${scenario.id}${suffix}`, scenario: scenario.id, kind: 'functional', command: `TZ=Asia/Bangkok node ${args.join(' ')}`, cwd: root, stdout, stderr, exitCode,
    phase: scenario.mode === 'inspect' ? 'import' : furthestPhase(written, inspection, exitCode), issueCodes: countCodes(issues.map((i: any) => i.type)), resultPath: written && !suffix ? relative(root, output) : null, inspect: inspection, recordedAt: new Date().toISOString(),
    notes: suffix ? 'Determinism rerun; temporary output removed after comparison. Solver reasons are classified separately in verification.json.' : 'issueCodes counts validation issues only; solver reasons are classified separately in verification.json.' });
  classify('exitStatuses', exitCode);
  for (const issue of [...inspection.issues, ...issues]) classify('issueCodes', issue.type);
  for (const reason of result?.unscheduled ?? []) classify('solverUnscheduledReasons', reason.reason);
  for (const field of Object.keys(result?.search ?? {})) classify('searchStatisticFields', field);
  return { exitCode, inspection, result };
}
function invariants(r: any) {
  assert.equal(r.project.schemaVersion, 1);
  const events = r.project.events, sections = r.project.sections;
  assert.equal(new Set(events.map((e: any) => e.id)).size, events.length);
  const sectionIds = new Set(sections.map((s: any) => s.id));
  const roomIds = new Set(r.project.rooms.map((room: any) => room.id));
  const unscheduled = new Set(r.unscheduled.flatMap((u: any) => u.eventIds));
  for (const e of events) {
    assert(['managed', 'context'].includes(e.ownership));
    assert(['midterm', 'final'].includes(e.examType));
    assert(e.sectionIds.length > 0 && e.sectionIds.every((id: string) => sectionIds.has(id)));
    assert(e.roomAssignments.every((id: string) => roomIds.has(id)));
    if (e.timing) {
      assert.match(e.timing.date, /^\d{4}-\d{2}-\d{2}$/);
      assert(Number.isInteger(e.timing.startMinutes) && Number.isInteger(e.timing.endMinutes));
      assert(e.timing.startMinutes >= 0 && e.timing.startMinutes < e.timing.endMinutes && e.timing.endMinutes <= 1440);
      assert(!unscheduled.has(e.id));
    }
    if (unscheduled.has(e.id)) assert(!e.timing && e.ownership === 'managed');
    if (e.ownership === 'managed' && e.required && !e.timing) assert(unscheduled.has(e.id));
  }
  for (const id of unscheduled) assert(events.some((e: any) => e.id === id));
  const scheduled = events.filter((e: any) => e.ownership === 'managed' && e.timing);
  assert.equal(r.audit.quality.scheduledManagedEvents, scheduled.length);
  assert.equal(r.resources.summary.roomsAssigned + r.resources.summary.roomsUnassigned, scheduled.length);
  assert.match(r.audit.scheduleHash, /^[a-f0-9]{64}$/);
}
function anchors(r: any, specs: any[]) {
  const events = r.project.events.filter((e: any) => e.ownership === 'managed');
  const pair = (codes: string[], type: string) => codes.map(code => { const matches = events.filter((e: any) => e.courseCode === code && e.examType === type); assert.equal(matches.length, 1); return matches[0]; });
  for (const a of specs) {
    if (a.kind === 'sameTimePair' || a.kind === 'sharedGroupPairNeverOverlaps') for (const type of ['midterm', 'final']) {
      const [x, y] = pair(a.codes, type); assert(x.timing && y.timing);
      if (a.kind === 'sameTimePair') assert.deepEqual(x.timing, y.timing);
      else { assert(x.studentGroups.some((g: string) => y.studentGroups.includes(g))); assert(!(x.timing.date === y.timing.date && x.timing.startMinutes < y.timing.endMinutes && y.timing.startMinutes < x.timing.endMinutes)); }
    }
    else if (a.kind === 'fullDayCourseInterval') { const es = events.filter((e: any) => e.courseCode === a.code); assert.equal(es.length, 2); for (const e of es) { assert(e.fullDay); assert.equal(e.timing.startMinutes, a.startMinutes); assert.equal(e.timing.endMinutes, a.endMinutes); } }
    else if (a.kind === 'avoidedDaysOnlyForSaturatedCohorts') { const es = events.filter((e: any) => a.avoidedDates.includes(e.timing?.date)); assert(es.length > 0); for (const e of es) assert(e.studentGroups.some((g: string) => a.cohorts.includes(g))); }
    else if (a.kind === 'importedTimingPreserved') for (const type of ['midterm', 'final']) for (const e of pair(a.codes, type)) { assert.equal(e.timingOrigin, 'imported'); const sections = r.project.sections.filter((s: any) => e.sectionIds.includes(s.id)); for (const s of sections) assert.deepEqual(e.timing, s.exams[type]); const pinned: any = { '060321190': { midterm: ['2026-08-18',780,960], final:['2026-10-15',540,720] }, '060321197': { midterm:['2026-08-26',540,720], final:['2026-10-22',780,960] } }; assert.deepEqual([e.timing.date,e.timing.startMinutes,e.timing.endMinutes],pinned[e.courseCode][type]); }
    else if (a.kind === 'unscheduledCodesAreEventsWithoutTiming') for (const type of ['midterm', 'final']) for (const e of pair(a.codes, type)) { assert(!e.timing); assert(r.unscheduled.some((u: any) => u.eventIds.includes(e.id))); }
    else assert.fail(`Unknown anchor ${a.kind}`);
  }
}
for (const scenario of expected.scenarios) {
  try {
    const { exitCode, inspection, result: r } = run(scenario, resolve(import.meta.dirname, `results-${scenario.id}.json`));
    const e = scenario.expect;
    assert.equal(exitCode, e.exitCode);
    const managedSource = inspection.sources.find((s: any) => s.originalName === 'managed.xlsx');
    assert.equal(managedSource.courseCount, e.managedCourseCount ?? 41);
    assert.equal(managedSource.sectionCount, e.managedSectionCount ?? 47);
    if (scenario.mode === 'inspect') {
      assert.deepEqual(inspection.issues.filter((i: any) => i.blocking).map((i: any) => i.type), e.blockingIssues);
      assert.deepEqual(countCodes(inspection.issues.filter((i: any) => !i.blocking).map((i: any) => i.type)), e.warningIssues);
    } else {
      assert(r); invariants(r);
      assert.deepEqual(countCodes(r.validation.issues.map((i: any) => i.type)), e.issues);
      assert.equal(r.validation.overallStatus, e.status);
      assert.equal(r.unscheduled.reduce((sum: number, u: any) => sum + u.eventIds.length, 0), e.unscheduledEvents);
      for (const key of ['scheduledManagedEvents','weekendExams','holidayExams','daysUsed']) if (key in e) assert.deepEqual(r.audit.quality[key], e[key]);
      for (const key of ['roomsAssigned','roomsUnassigned']) if (key in e) assert.equal(r.resources.summary[key], e[key]);
      if (e.unscheduledByReason) assert.deepEqual(countCodes(r.unscheduled.map((u: any) => u.reason)), e.unscheduledByReason);
      for (const [key, value] of Object.entries(e.search ?? {})) assert.deepEqual(r.search[key], value);
      anchors(r, scenario.anchors);
      if (scenario.id === 'clean') {
        const temp = mkdtempSync(resolve(tmpdir(), 'report-determinism-'));
        try { const again = run(scenario, resolve(temp, 'result.json'), '-determinism').result; assert.deepEqual([again.audit.scheduleHash, again.unscheduled, again.search], [r.audit.scheduleHash,r.unscheduled,r.search]); } finally { rmSync(temp, { recursive: true, force: true }); }
      }
    }
    outcomes.push({ scenario: scenario.id, pass: true, exitCode, phase: r ? 'audit' : 'import', anchors: scenario.anchors.map((a: any) => a.kind) });
    console.log(`PASS ${scenario.id}`);
  } catch (error) { const message = error instanceof Error ? error.message : String(error); outcomes.push({ scenario: scenario.id, pass: false, message }); console.error(`FAIL ${scenario.id}: ${message}`); }
}
writeFileSync(resolve(import.meta.dirname, 'verification.json'), JSON.stringify({ recordedAt: new Date().toISOString(), command: 'node docs/data/verify-results.ts', identifierPolicy: 'Occurrences are qualified by their source field namespace; identical strings can name different API concepts.', observedIdentifiers: [...observedIdentifiers].sort(), outcomes }, null, 2) + '\n');
if (outcomes.some(o => !o.pass)) process.exitCode = 1;
