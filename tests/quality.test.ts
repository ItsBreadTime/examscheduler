import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildEvents, assignResources, scheduleProject, validateProject, scheduleQuality } from '../src/lib/index.ts';
import { importProject } from '../src/lib/project.ts';
import { defaultSettings } from '../src/lib/model.ts';
import { project, section, room } from './helpers.ts';

const fixtures = join(import.meta.dirname, 'fixtures');
const load = async (name: string) => new Uint8Array(await readFile(join(fixtures, name)));

test('scheduleQuality counts same-day, consecutive-day, peak and weekend facts', () => {
  const p = project([section('060000001', ['G1']), section('060000002', ['G1']), section('060000003', ['G1'])]);
  p.events = buildEvents(p);
  const midterms = p.events.filter(e => e.examType === 'midterm');
  midterms[0].timing = { date: '2026-08-17', startMinutes: 540, endMinutes: 720 };
  midterms[1].timing = { date: '2026-08-17', startMinutes: 780, endMinutes: 960 };
  midterms[2].timing = { date: '2026-08-18', startMinutes: 540, endMinutes: 720 };
  for (const e of midterms) e.timingOrigin = 'generated';
  const quality = scheduleQuality(p);
  assert.equal(quality.scheduledManagedEvents, 3);
  assert.equal(quality.sameDayPairs, 1);
  assert.equal(quality.groupsWithSameDayExams, 1);
  assert.equal(quality.consecutiveDayPairs, 2);
  assert.equal(quality.groupsWithConsecutiveDayExams, 1);
  assert.equal(quality.peakConcurrentExams, 1);
  assert.equal(quality.daysUsed.midterm, 2);
});

test('the scheduler treats imported exams as immovable student burden', () => {
  const external = section('040000001', ['G1'], 'context');
  external.exams.midterm = { date: '2026-08-17', startMinutes: 540, endMinutes: 660 };
  const p = project([external, section('060000001', ['G1'])]);
  p.settings.periods.midterm = { start: '2026-08-17', end: '2026-08-18' };
  const r = scheduleProject(p);
  const managed = r.project.events.find(e => e.ownership === 'managed' && e.examType === 'midterm')!;
  assert.equal(managed.timing!.date, '2026-08-18');
  assert.equal(r.quality.sameDayPairs, 0);
  assert.ok(r.search.improvementMoves >= 0);
});

test('the scheduler spreads one group over alternate days and stays deterministic', () => {
  const p = project([section('060000001'), section('060000002'), section('060000003')]);
  const a = scheduleProject(p), b = scheduleProject(p);
  assert.deepEqual(a.quality, b.quality);
  assert.equal(a.quality.weekendExams, 0);
  assert.equal(a.quality.sameDayPairs, 0);       // three exams, five weekdays: every student group breathes
  assert.equal(a.quality.consecutiveDayPairs, 0); // 17/19/21 and 19/21/23 alternate-day grids are preferred
  assert.equal(typeof a.search.improvementMoves, 'number');
});

test('room assignment is best-fit decreasing once a room declares capacity', () => {
  const small = section('060000001', ['G1']), big = section('060000002', ['G2']);
  small.registeredEnrollment = 25; big.registeredEnrollment = 100;
  const p = project([small, big]);
  p.rooms = [room('Big Hall', { capacity: 120 }), room('Small Room', { capacity: 30 })];
  p.events = buildEvents(p);
  for (const event of p.events) {
    event.timing = event.examType === 'midterm' ? { date: '2026-08-17', startMinutes: 540, endMinutes: 720 } : { date: '2026-10-19', startMinutes: 540, endMinutes: 720 };
    event.timingOrigin = 'generated';
  }
  const result = assignResources(p);
  const roomFor = (code: string) => result.project.events.find(e => e.courseCode === code && e.examType === 'midterm')!.roomAssignments[0];
  assert.equal(roomFor('060000001'), 'room:Small Room'); // the 25-seat exam claims the 30-seat room, not the hall
  assert.equal(roomFor('060000002'), 'room:Big Hall');   // the 100-seat exam cannot fit anywhere smaller
  assert.equal(result.validation.overallStatus, 'valid_with_warnings');
  assert.equal(result.validation.issues.filter(i => i.type === 'PROCTOR_DEMAND_UNKNOWN').length, 4);
});

test('a provable seat overflow is an error; unknown capacity stays not_checked', () => {
  const big = section('060000001');
  big.plannedEnrollment = 100;
  const p = project([big]);
  p.rooms = [room('Tiny', { capacity: 30 })];
  p.events = buildEvents(p);
  const event = p.events.find(e => e.examType === 'midterm')!;
  event.timing = { date: '2026-08-17', startMinutes: 540, endMinutes: 720 };
  event.timingOrigin = 'generated';
  event.roomAssignments = ['room:Tiny'];
  const validation = validateProject(p);
  assert.ok(validation.issues.some(i => i.type === 'ROOM_CAPACITY_EXCEEDED' && i.blocking));
  assert.equal(validation.coverage.roomCapacity, 'failed');
  const noCapacity = project([section('060000001')]);
  noCapacity.events = buildEvents(noCapacity);
  assert.equal(validateProject(noCapacity).coverage.roomCapacity, 'not_checked');
});

test('the demo manifest schedule improves student burden without new clashes (regression bounds)', async () => {
  const settings = defaultSettings({ start: '2026-08-17', end: '2026-08-28' }, { start: '2026-10-14', end: '2026-10-30' });
  const imported = await importProject({
    courseSources: (await Promise.all(['04.xlsx', '05.xlsx', '06.xlsx', '08.xlsx'].map(async (name, i) =>
      ({ name, bytes: await load(name), role: (i === 2 ? 'managed' : 'context') as 'managed' | 'context', expectedPrefix: name.slice(0, 2) })))),
    rules: { name: 'rules.csv', bytes: await load('rules.csv') },
    references: [{ name: 'roominfo.csv', bytes: await load('roominfo.csv'), kind: 'rooms' as const }, { name: 'proctors.xls', bytes: await load('proctors.xls'), kind: 'proctors' as const }],
    settings,
  });
  const result = scheduleProject(imported);
  const again = scheduleProject(imported);
  assert.equal(result.unscheduled.length, 4); // the two source contradictions and the two group-less course exams
  assert.equal(result.quality.scheduledManagedEvents, 354);
  assert.ok(!result.validation.issues.some(i => i.type === 'STUDENT_GROUP_OVERLAP'));
  assert.equal(result.quality.weekendExams, 0);
  assert.equal(result.quality.groupsWithThreeSameDayExams, 0);
  assert.ok(result.quality.sameDayPairs <= 30, `sameDayPairs ${result.quality.sameDayPairs}`);
  assert.ok(result.quality.consecutiveDayPairs <= 185, `consecutiveDayPairs ${result.quality.consecutiveDayPairs}`);
  assert.ok(result.quality.peakConcurrentExams <= 13, `peak ${result.quality.peakConcurrentExams}`);
  const timing = (e: { timing?: unknown }) => JSON.stringify(e.timing);
  assert.deepEqual(result.project.events.filter(e => e.required).map(timing).sort(), again.project.events.filter(e => e.required).map(timing).sort());
  const resources = assignResources(result.project);
  assert.equal(resources.summary.roomsAssigned, 354);
  assert.equal(resources.summary.roomsUnassigned, 0);
});

test('every emitted validation issue has a localized title and diagnostic route', async () => {
  const coreFiles = ['src/lib/validator.ts', 'src/lib/project.ts', 'src/lib/import/courses.ts', 'src/lib/import/rooms.ts', 'src/lib/import/proctors.ts', 'src/lib/rules.ts', 'src/lib/resources.ts'];
  const core = (await Promise.all(coreFiles.map(file => readFile(join(import.meta.dirname, '..', file), 'utf8')))).join('\n');
  const emitted = [...new Set([...core.matchAll(/['\"]([A-Z][A-Z0-9_]+)['\"]/g)].map(match => match[1]).filter(type => type.includes('_')))];
  const format = await readFile(join(import.meta.dirname, '..', 'src/ui/format.ts'), 'utf8');
  const titles = new Set([...format.matchAll(/^  ([A-Z][A-Z0-9_]+): \[/gm)].map(match => match[1]));
  const messages = new Set([...format.matchAll(/case '([A-Z][A-Z0-9_]*)':/g)].map(match => match[1]));
  assert.deepEqual(emitted.filter(type => !titles.has(type)), [], 'missing issue title pair');
  assert.deepEqual(emitted.filter(type => !messages.has(type)), [], 'missing issue message route');
});
