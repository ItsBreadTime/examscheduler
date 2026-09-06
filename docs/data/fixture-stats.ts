// Structural difficulty profile of the three timing fixtures (report chapter on methodology).
// The unit derivation and graph construction below are verbatim copies of
// src/lib/scheduler.ts (makeUnit loop) and src/lib/solver.ts (slot interning and
// neighbor construction). The equivalence assertions at the end prove the copies are
// faithful: this script re-derives every unit, feeds them to the real solveUnits, and
// requires the search statistics and every produced timing to match the recorded
// results JSON before any metric is written.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { importProject, buildEvents, reconcileRules, timingsOverlap, weekend, dates, validTiming, compare, unique } from '../../src/lib/index.ts';
import { solveUnits } from '../../src/lib/solver.ts';
import type { Project, ProjectInput, SchedulerSettings, ExamTiming, ExamEvent } from '../../src/lib/index.ts';
import { root, saveRecord } from './records.ts';

const data = import.meta.dirname;
interface Manifest { courseSources: { path: string; role: 'managed' | 'context'; expectedPrefix?: string }[]; rules?: string; references?: { path: string; kind: 'rooms' }[]; settings: SchedulerSettings; locks?: ProjectInput['locks'] }
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const fixtures: [string, string, string][] = [
  ['เล็ก', 'clean/manifest.json', 'results-clean.json'],
  ['กลาง', 'benchmark/medium/manifest.json', 'results-bench-medium.json'],
  ['ใหญ่', 'benchmark/large/manifest.json', 'results-bench-large.json'],
];
interface Unit { id: string; members: ExamEvent[]; groups: string[]; candidates: ExamTiming[]; reason?: string; totalCandidates: number }

const loadProject = async (manifestPath: string): Promise<Project> => {
  const manifest = read(manifestPath) as Manifest;
  const load = (name: string) => ({ name: basename(name), bytes: readFileSync(resolve(dirname(manifestPath), name)) });
  return importProject({ courseSources: manifest.courseSources.map(s => ({ ...load(s.path), role: s.role, expectedPrefix: s.expectedPrefix })), rules: manifest.rules ? load(manifest.rules) : undefined,
    references: (manifest.references ?? []).map(s => ({ ...load(s.path), kind: s.kind })), settings: manifest.settings, locks: manifest.locks });
};

for (const [label, manifestRelative, resultRelative] of fixtures) {
  const project = await loadProject(resolve(data, manifestRelative));
  project.events = buildEvents(project);
  const { settings } = project;
  const fixed = project.events.filter(e => e.timing);
  // --- begin verbatim derivation copy: src/lib/scheduler.ts ---
  const units: Unit[] = [], claimed = new Set<string>();
  const makeUnit = (members: ExamEvent[]) => {
    members.forEach(e => claimed.add(e.id));
    if (!members.some(e => e.required && !e.timing)) return;
    const required = members.filter(e => e.required || e.timing);
    const unit: Unit = { id: members.map(e => e.id).sort(compare).join('+'), members, groups: unique(members.flatMap(e => e.studentGroups)), candidates: [], totalCandidates: 0 };
    const period = settings.periods[members[0].examType];
    const fullDay = members.some(e => e.fullDay);
    const locked = members.filter(e => e.timing);
    let candidates: ExamTiming[];
    if (locked.length) candidates = [locked[0].timing!];
    else candidates = dates(period.start, period.end).flatMap(date => (fullDay ? [settings.fullDay] : settings.sessions).map(t => ({ date, ...t })));
    candidates = candidates.filter(t => validTiming(t) && t.date >= period.start && t.date <= period.end && !(settings.weekendPolicy === 'never' && weekend(t.date)) && !(settings.holidayPolicy === 'never' && settings.holidays.includes(t.date)) && (fullDay ? (t.startMinutes === settings.fullDay.startMinutes && t.endMinutes === settings.fullDay.endMinutes) : settings.sessions.some(s => s.startMinutes === t.startMinutes && s.endMinutes === t.endMinutes)));
    candidates = [...new Map(candidates.map(t => [`${t.date}:${t.startMinutes}:${t.endMinutes}`, t])).values()];
    unit.totalCandidates = candidates.length;
    const sharedWithin = required.some((a, i) => required.slice(i + 1).some(b => a.studentGroups.some(g => b.studentGroups.includes(g))));
    const inconsistentLocks = locked.some(e => !sameTiming(e.timing, locked[0].timing));
    if (sharedWithin || inconsistentLocks || members.some(e => !e.required && !e.timing)) unit.reason = 'SAME_TIME_CONTRADICTION';
    else if (members.some(e => e.blocked) || project.sections.some(s => s.invalidExams.includes(members[0].examType) && s.studentGroups.some(g => unit.groups.includes(g)))) unit.reason = 'SOURCE_DATA_INVALID';
    else if (!candidates.length) unit.reason = 'NO_CANDIDATES';
    const memberIds = new Set(members.map(e => e.id));
    const memberSections = new Set(members.flatMap(e => e.sectionIds));
    unit.candidates = candidates.filter(t => !fixed.some(e => !memberIds.has(e.id) && e.studentGroups.some(g => unit.groups.includes(g)) && timingsOverlap(e.timing!, t)) && !project.sections.some(s => !memberSections.has(s.id) && s.studentGroups.some(g => unit.groups.includes(g)) && Object.values(s.exams).some(exam => timingsOverlap(exam, t))));
    if (!unit.reason && !unit.candidates.length) unit.reason = 'FIXED_CONSTRAINTS';
    units.push(unit);
  };
  const sameTiming = (a?: ExamTiming, b?: ExamTiming) => !!a && !!b && a.date === b.date && a.startMinutes === b.startMinutes && a.endMinutes === b.endMinutes;
  for (const group of reconcileRules(project.rules, project.sections).groups) makeUnit(project.events.filter(e => e.ownership === 'managed' && e.examType === group.examType && group.courseCodes.includes(e.courseCode)));
  for (const event of project.events) if (event.ownership === 'managed' && !claimed.has(event.id)) makeUnit([event]);
  const viable = units.filter(u => !u.reason);
  // --- end derivation copy; begin graph construction copy: src/lib/solver.ts ---
  const preferredOrder = [...viable].sort((a, b) => compare(a.id, b.id));
  const slotIds = new Map<string, number>();
  const slots: { timing: ExamTiming; day: number; overlaps: number[] }[] = [];
  const intern = (timing: ExamTiming) => {
    const key = `${timing.date}:${timing.startMinutes}:${timing.endMinutes}`;
    let id = slotIds.get(key);
    if (id === undefined) {
      id = slots.length; slotIds.set(key, id);
      slots.push({ timing, day: Date.parse(timing.date) / 86400000, overlaps: [] });
    }
    return id;
  };
  for (const unit of preferredOrder) for (const timing of unit.candidates) intern(timing);
  for (const event of fixed) intern(event.timing!);
  const byDay = new Map<number, number[]>();
  slots.forEach((_slot, id) => { if (!byDay.has(slots[id].day)) byDay.set(slots[id].day, []); byDay.get(slots[id].day)!.push(id); });
  for (const ids of byDay.values()) for (const a of ids) slots[a].overlaps = ids.filter(b => timingsOverlap(slots[a].timing, slots[b].timing));
  const candidateIds = preferredOrder.map(unit => [...new Set(unit.candidates.map(intern))]);
  const byGroup = new Map<string, number[]>();
  preferredOrder.forEach((unit, i) => { for (const group of unit.groups) { if (!byGroup.has(group)) byGroup.set(group, []); byGroup.get(group)!.push(i); } });
  const neighbors = preferredOrder.map(() => new Set<number>());
  for (const ids of byGroup.values()) for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
    const i = ids[a], j = ids[b];
    if (neighbors[i].has(j)) continue;
    if (candidateIds[i].some(s => slots[s].overlaps.some(t => candidateIds[j].includes(t)))) { neighbors[i].add(j); neighbors[j].add(i); }
  }
  // --- end graph copy ---
  const movingGroups = new Set(preferredOrder.flatMap(u => u.members.filter(e => e.required && !e.timing).flatMap(e => e.studentGroups)));
  const degree = neighbors.map(n => n.size);
  const componentOf: number[] = []; let components = 0;
  const visitComponent = (i: number, mark: number) => { if (componentOf[i] !== undefined) return; componentOf[i] = mark; for (const n of [...neighbors[i]]) visitComponent(n, mark); };
  preferredOrder.forEach((_u, i) => { if (componentOf[i] === undefined) visitComponent(i, components++); });
  const { assignments, search } = solveUnits(project, viable);
  // Faithfulness gate: re-derived units must reproduce the recorded search statistics and timings.
  const recorded = read(resolve(data, resultRelative));
  for (const [key, value] of Object.entries(search)) assert.equal(value, recorded.search[key], `${label}: search.${key} differs from ${resultRelative}`);
  assert.equal(components, recorded.search.components, `${label}: component count differs`);
  for (const [unitId, timing] of assignments) for (const member of viable.find(u => u.id === unitId)!.members) {
    if (member.timing) continue; // already-timed members are not moved
    const observed = recorded.project.events.find((e: ExamEvent) => e.id === member.id)!.timing;
    assert.ok(observed && timing.date === observed.date && timing.startMinutes === observed.startMinutes && timing.endMinutes === observed.endMinutes, `${label}: ${member.id} timing ${JSON.stringify(timing)} != recorded ${JSON.stringify(observed)}`);
  }
  const edges = degree.reduce((sum, n) => sum + n, 0) / 2;
  const pairs = viable.length * (viable.length - 1) / 2;
  const stats = {
    label,
    managedCourses: new Set(project.sections.filter(s => s.sourceRole === 'managed').map(s => s.courseCode)).size,
    managedEvents: project.events.filter(e => e.ownership === 'managed').length,
    sourceTimedManagedEvents: project.events.filter(e => e.ownership === 'managed' && e.timing).length,
    fullDayManagedEvents: project.events.filter(e => e.ownership === 'managed' && e.fullDay).length,
    contextTimedEvents: project.events.filter(e => e.ownership === 'context' && e.timing).length,
    units: units.length, sameTimeUnits: units.filter(u => u.members.length > 1).length, viableUnits: viable.length,
    studentGroups: movingGroups.size,
    conflictEdges: edges, conflictDensity: edges / pairs, components,
    meanDegree: degree.reduce((a, b) => a + b, 0) / viable.length,
    slots: slots.length,
    midtermDays: dates(settings.periods.midterm.start, settings.periods.midterm.end).length,
    finalDays: dates(settings.periods.final.start, settings.periods.final.end).length,
    rooms: project.rooms.length, computerRooms: project.rooms.filter(r => r.tags.includes('computer')).length,
    searchBudget: settings.searchBudget,
  };
  console.log(JSON.stringify(stats));
  const allPath = resolve(data, 'fixture-stats.json');
  const all: { recordedAt: string; note: string; stats: { label: string }[] } = {
    recordedAt: new Date().toISOString(),
    note: 'Structural difficulty metrics per fixture. The unit derivation and conflict-graph construction are verbatim copies of scheduler.ts/solver.ts, and each run asserts equivalence with the recorded results (search statistics, component count and every produced timing) before writing metrics.',
    stats: existsSync(allPath) ? read(allPath).stats?.filter((s: { label: string }) => s.label !== label) ?? [] : [],
  };
  all.stats.push(stats);
  all.stats.sort((a, b) => fixtures.findIndex(f => f[0] === a.label) - fixtures.findIndex(f => f[0] === b.label));
  writeFileSync(allPath, JSON.stringify(all, null, 2) + '\n');
  saveRecord({ id: `fixture-stats-${label}`, scenario: label, kind: 'sizing', command: 'node docs/data/fixture-stats.ts', cwd: root, stdout: JSON.stringify(stats), stderr: '',
    exitCode: 0, phase: 'schedule', issueCodes: {}, resultPath: 'docs/data/fixture-stats.json', inspect: null, recordedAt: all.recordedAt,
    notes: 'Structural profile of fixtures; unit derivation and graph construction copied verbatim from scheduler.ts/solver.ts and proven equivalent to recorded results before metrics were written.' });
}
console.log('fixture stats written to docs/data/fixture-stats.json');
