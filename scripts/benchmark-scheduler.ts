// Reproducible performance/quality probe. Use --baseline /absolute/scheduler.ts --sizes 50,100
// to compare a saved scheduler on the same data; larger old-solver runs can take many minutes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scheduleProject, assignResources, defaultSettings, importProject } from '../src/lib/index.ts';
import type { Project, ExamTiming, Section, SchedulerSettings } from '../src/lib/types.ts';

const root = resolve(import.meta.dirname, '..');
const option = (key: string) => {
  const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1];
};
const baselinePath = option('--baseline');
const baseline: typeof scheduleProject | undefined = baselinePath ? (await import(pathToFileURL(resolve(baselinePath)).href)).scheduleProject : undefined;
const sizes = (option('--sizes') ?? '50,100,200,300,420').split(',').map(Number);
assert.ok(sizes.every(n => Number.isInteger(n) && n > 0 && n <= 1000), 'sizes must be course counts from 1 to 1000');

// The audit's H generator, including its deliberately retained overloaded first cohort.
function scale(courses: number): Project {
  let seed = 4242;
  const random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const groups = Array.from({ length: 100 }, (_, i) => `H${i}`), sections: Section[] = [];
  for (let i = 0; i < courses; i++) {
    const ngroups = random() < 0.6 ? 1 : 2;
    const gs = [...new Set(Array.from({ length: ngroups }, () => groups[Math.floor(random() * groups.length)]))];
    const add = (suffix: string, studentGroups: string[], enrolled: number, sectionNumber: number) => sections.push({
      id: `h${i}${suffix}`, courseCode: String(101000000 + i * 7), courseName: 'Synthetic exam', sectionNumber,
      studentGroups, rawStudentGroups: studentGroups.join(','), sourceRole: 'managed',
      sourceRef: { artifactId: 'synthetic', row: i + 1 }, instructors: [], exams: {}, invalidExams: [], registeredEnrollment: enrolled,
    });
    if (random() < 0.15) {
      add('-a', gs, 40 + Math.floor(random() * 160), 1);
      add('-b', [groups.find(g => !gs.includes(g))!], 40 + Math.floor(random() * 160), 2);
    } else add('', gs, 60 + Math.floor(random() * 290), 1);
  }
  return { schemaVersion: 1, artifacts: [], sections, rules: [], importIssues: [], events: [], locks: {}, rooms: [], proctors: [],
    settings: defaultSettings({ start: '2026-08-17', end: '2026-08-28' }, { start: '2026-10-19', end: '2026-10-30' }) };
}
const overlap = (a: ExamTiming, b: ExamTiming) => a.date === b.date && a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
function neutral(p: Project) {
  const timed = p.events.filter(e => e.timing), managed = timed.filter(e => e.ownership === 'managed');
  let sameDay = 0, consecutive = 0, newClashes = 0, peak = 0;
  for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length; j++) {
    const a = timed[i], b = timed[j], shared = a.studentGroups.filter(g => b.studentGroups.includes(g)).length;
    if (a.timing!.date === b.timing!.date) sameDay += shared;
    if (Math.abs(Date.parse(a.timing!.date) - Date.parse(b.timing!.date)) === 86400000) consecutive += shared;
    if ((a.timingOrigin === 'generated' || b.timingOrigin === 'generated') && overlap(a.timing!, b.timing!)) newClashes += shared;
  }
  for (const event of managed) peak = Math.max(peak, managed.filter(e => e.timing!.date === event.timing!.date &&
    e.timing!.startMinutes <= event.timing!.startMinutes && e.timing!.endMinutes > event.timing!.startMinutes).length);
  return { sameDay, consecutive, newClashes, peak };
}
const signature = (p: Project) => p.events.map(e => [e.id, e.timing]);
function run(name: string, input: Project, solver: typeof scheduleProject, label: string) {
  const start = performance.now(), result = solver(input), milliseconds = Math.round(performance.now() - start);
  const facts = neutral(result.project);
  assert.equal(facts.newClashes, 0);
  assert.equal(facts.sameDay, result.quality.sameDayPairs);
  assert.equal(facts.consecutive, result.quality.consecutiveDayPairs);
  assert.equal(facts.peak, result.quality.peakConcurrentExams);
  if (label === 'current') assert.deepEqual(signature(result.project), signature(solver(input).project), 'determinism');
  const resources = assignResources(result.project);
  for (const room of resources.project.rooms) {
    const exams = resources.project.events.filter(e => e.roomAssignments.includes(room.id));
    for (let i = 0; i < exams.length; i++) {
      const e = exams[i];
      assert.ok(!room.unavailableDates.includes(e.timing!.date));
      const demand = input.sections.filter(s => e.sectionIds.includes(s.id)).reduce((sum, s) => sum + (s.registeredEnrollment ?? s.plannedEnrollment ?? 0), 0);
      assert.ok(room.capacity === undefined || room.capacity >= demand);
      for (let j = i + 1; j < exams.length; j++) assert.ok(!overlap(e.timing!, exams[j].timing!));
    }
  }
  console.log(JSON.stringify({ name, solver: label, milliseconds, scheduled: result.quality.scheduledManagedEvents,
    omittedEvents: result.unscheduled.reduce((n, u) => n + u.eventIds.length, 0), ...facts,
    weekend: result.quality.weekendExams, roomsAssigned: resources.summary.roomsAssigned, search: result.search }));
}
const fixtureRoot = resolve(root, 'tests/fixtures');
const manifest = JSON.parse(await readFile(resolve(fixtureRoot, 'manifest.json'), 'utf8')) as {
  courseSources: { path: string; role: 'managed' | 'context'; expectedPrefix: string }[];
  rules: string; references: { path: string; kind: 'rooms' | 'proctors' }[]; settings: SchedulerSettings;
};
const load = async (name: string) => ({ name, bytes: await readFile(resolve(fixtureRoot, name)) });
const fixture = await importProject({
  courseSources: await Promise.all(manifest.courseSources.map(async s => ({ ...await load(s.path), role: s.role, expectedPrefix: s.expectedPrefix }))),
  rules: await load(manifest.rules), references: await Promise.all(manifest.references.map(async s => ({ ...await load(s.path), kind: s.kind }))),
  settings: manifest.settings,
});
for (const [name, input] of [['demo', fixture], ...sizes.map(n => [`scale-${n * 2}`, scale(n)] as const)] as const) {
  if (baseline) run(name, input, baseline, 'baseline');
  run(name, input, scheduleProject, 'current');
}
