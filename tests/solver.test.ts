import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, scheduleProject, scheduleQuality } from '../src/lib/index.ts';
import type { ExamTiming, Project } from '../src/lib/types.ts';
import { project, rule, section } from './helpers.ts';

const code = (i: number) => String(60000000 + i).padStart(9, '0');
const overlap = (a: ExamTiming, b: ExamTiming) => a.date === b.date && a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
const weekday = (date: string) => ![0, 6].includes(new Date(date).getUTCDay());
const finalOff = (codes: string[]) => rule('no_exam', codes, 'final');
function independentFacts(p: Project) {
  const timed = p.events.filter(e => e.timing);
  let sameDay = 0, consecutive = 0, clashes = 0;
  for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length; j++) {
    const a = timed[i], b = timed[j];
    const shared = a.studentGroups.filter(g => b.studentGroups.includes(g)).length;
    if (overlap(a.timing!, b.timing!)) clashes += shared;
    if (a.timing!.date === b.timing!.date) sameDay += shared;
    if (Math.abs(Date.parse(a.timing!.date) - Date.parse(b.timing!.date)) === 86400000) consecutive += shared;
  }
  return { sameDay, consecutive, clashes };
}

// Exhaustive enumeration intentionally does not use the production solver, legality, bounds or
// quality functions. Cases below have at most seven moving exams and include irregular intervals.
function oracle(p: Project) {
  const events = buildEvents(p), fixed = events.filter(e => e.timing);
  const moving = events.filter(e => e.required && !e.timing);
  const candidates = moving.map(e => {
    const period = p.settings.periods[e.examType], out: ExamTiming[] = [];
    for (let d = Date.parse(period.start); d <= Date.parse(period.end); d += 86400000) {
      const date = new Date(d).toISOString().slice(0, 10);
      if (p.settings.weekendPolicy === 'never' && !weekday(date)) continue;
      if (p.settings.holidayPolicy === 'never' && p.settings.holidays.includes(date)) continue;
      for (const interval of e.fullDay ? [p.settings.fullDay] : p.settings.sessions) {
        const t = { date, ...interval };
        if (!fixed.some(f => f.studentGroups.some(g => e.studentGroups.includes(g)) && overlap(f.timing!, t))) out.push(t);
      }
    }
    return out;
  });
  const assigned: { index: number; timing: ExamTiming }[] = [];
  let maximum = -1, avoided = Infinity;
  const visit = (index: number, restricted: number) => {
    if (assigned.length + moving.length - index < maximum) return;
    if (index === moving.length) {
      if (assigned.length > maximum || (assigned.length === maximum && restricted < avoided)) {
        maximum = assigned.length; avoided = restricted;
      }
      return;
    }
    for (const timing of candidates[index]) {
      if (assigned.some(a => moving[a.index].studentGroups.some(g => moving[index].studentGroups.includes(g)) && overlap(a.timing, timing))) continue;
      const avoid = (p.settings.weekendPolicy === 'only_if_necessary' && !weekday(timing.date)) ||
        (p.settings.holidayPolicy === 'only_if_necessary' && p.settings.holidays.includes(timing.date));
      assigned.push({ index, timing }); visit(index + 1, restricted + Number(avoid)); assigned.pop();
    }
    visit(index + 1, restricted);
  };
  visit(0, 0); return { maximum, avoided };
}

test('60 seeded small schedules match exhaustive maximum coverage and minimum avoided days', () => {
  for (let seed = 1; seed <= 60; seed++) {
    let state = Math.imul(seed, 0x9e3779b1) >>> 0;
    const random = (n: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return Math.floor(state / 4294967296 * n); };
    const n = 3 + random(5), sections = Array.from({ length: n }, (_, i) => section(code(i), [...new Set([`G${random(4)}`, `G${random(4)}`])]));
    const rules = [finalOff(sections.map(s => s.courseCode))];
    for (const s of sections) if (random(5) === 0) rules.push(rule('full_day', [s.courseCode], 'midterm'));
    if (seed % 3 === 0) {
      const fixed = section('040000001', ['G0'], seed % 2 ? 'managed' : 'context');
      fixed.exams.midterm = { date: '2026-08-21', startMinutes: 570, endMinutes: 630 };
      sections.push(fixed); rules.push(finalOff([fixed.courseCode]));
    }
    const p = project(sections, rules);
    p.settings.periods.midterm = { start: '2026-08-21', end: seed % 2 ? '2026-08-22' : '2026-08-21' };
    p.settings.sessions = seed % 4 ? [{ startMinutes: 540, endMinutes: 660 }, { startMinutes: 780, endMinutes: 900 }] :
      [{ startMinutes: 540, endMinutes: 660 }, { startMinutes: 600, endMinutes: 720 }, { startMinutes: 660, endMinutes: 780 }];
    if (seed % 5 === 0) { p.settings.holidays = ['2026-08-21']; p.settings.holidayPolicy = 'only_if_necessary'; }
    const expected = oracle(p), result = scheduleProject(p);
    const generated = result.project.events.filter(e => e.timing && e.timingOrigin === 'generated');
    const avoided = generated.filter(e => (p.settings.weekendPolicy === 'only_if_necessary' && !weekday(e.timing!.date)) ||
      (p.settings.holidayPolicy === 'only_if_necessary' && p.settings.holidays.includes(e.timing!.date))).length;
    assert.equal(generated.length, expected.maximum, `coverage seed ${seed}`);
    assert.equal(avoided, expected.avoided, `avoided seed ${seed}`);
    assert.equal(result.search.coverageUpperBound, expected.maximum, `bound seed ${seed}`);
    assert.equal(result.search.coverageOptimal, true, `proof seed ${seed}`);
    assert.equal(independentFacts(result.project).clashes, 0, `clashes seed ${seed}`);
    assert.ok(result.search.visitedNodes + result.search.improvementEvaluations <= p.settings.searchBudget);
  }
});

test('pigeonhole bounds stop impossible search without starving independent exams or improvement', () => {
  const sections = Array.from({ length: 30 }, (_, i) => section(code(i), i < 10 ? ['overloaded'] : [`other${i}`]));
  const p = project(sections);
  p.settings.periods.midterm.end = '2026-08-19'; p.settings.periods.final.end = '2026-10-21';
  const result = scheduleProject(p);
  assert.equal(result.quality.scheduledManagedEvents, 52);
  assert.equal(result.search.coverageUpperBound, 52);
  assert.equal(result.search.coverageOptimal, true);
  assert.equal(result.search.budgetExhausted, false);
  assert.ok(result.search.visitedNodes < 100);
  assert.ok(result.search.improvementEvaluations > 0);
  assert.equal(result.unscheduled.length, 8);
  assert.ok(result.unscheduled.every(u => u.reason === 'STUDENT_CONFLICTS' && u.blockedCandidateCount === 6));
  assert.equal(independentFacts(result.project).clashes, 0);
  const shuffled = structuredClone(p); shuffled.sections.reverse();
  assert.deepEqual(scheduleProject(shuffled).project.events, result.project.events);
});

test('capacity bounds preserve weighted same-time bundles instead of dropping arbitrary excess exams', () => {
  const sections = [section(code(0), ['A']), section(code(1), ['A']), section(code(2), ['B']), section(code(3), ['C'])];
  const p = project(sections, [rule('same_time', sections.slice(1).map(s => s.courseCode), 'midterm'), finalOff(sections.map(s => s.courseCode))]);
  p.settings.periods.midterm.end = p.settings.periods.midterm.start;
  p.settings.sessions = [p.settings.sessions[0]];
  const result = scheduleProject(p);
  assert.equal(result.quality.scheduledManagedEvents, 3);
  assert.equal(result.search.coverageUpperBound, 3);
  assert.equal(result.project.events.find(e => e.courseCode === code(0) && e.examType === 'midterm')!.timing, undefined);
  assert.equal(independentFacts(result.project).clashes, 0);
});

test('a placeable full-day exam can be omitted to fit two shorter exams', () => {
  const sections = [0, 1, 2].map(i => section(code(i)));
  const p = project(sections, [rule('full_day', [code(0)], 'midterm'), finalOff(sections.map(s => s.courseCode))]);
  p.settings.periods.midterm.end = p.settings.periods.midterm.start;
  const result = scheduleProject(p);
  assert.equal(result.quality.scheduledManagedEvents, 2);
  assert.equal(result.search.coverageOptimal, true);
  assert.ok(result.unscheduled[0].eventIds.includes(`managed:${code(0)}:midterm`));
});

test('duplicate and overlapping sessions do not inflate proven capacity', () => {
  const sections = [0, 1, 2, 3].map(i => section(code(i)));
  const p = project(sections, [finalOff(sections.map(s => s.courseCode))]);
  p.settings.periods.midterm.end = p.settings.periods.midterm.start;
  p.settings.sessions = [{ startMinutes: 540, endMinutes: 720 }, { startMinutes: 540, endMinutes: 720 }, { startMinutes: 600, endMinutes: 780 }];
  const result = scheduleProject(p);
  assert.equal(result.search.coverageUpperBound, 1);
  assert.equal(result.quality.scheduledManagedEvents, 1);
  assert.ok(result.search.visitedNodes < 5);
  assert.ok(result.unscheduled.every(u => u.reason === 'STUDENT_CONFLICTS'));
});

test('fixed managed exams affect spread exactly as context exams do', () => {
  for (const origin of ['imported', 'manual'] as const) {
    const fixed = section(code(0));
    const p = project([fixed, section(code(1))], [finalOff([code(0), code(1)])]);
    const timing = { date: '2026-08-17', startMinutes: 540, endMinutes: 720 };
    if (origin === 'imported') fixed.exams.midterm = timing;
    else p.locks[`managed:${code(0)}:midterm`] = timing;
    p.settings.periods.midterm.end = '2026-08-19';
    const result = scheduleProject(p);
    assert.deepEqual(result.project.events.find(e => e.courseCode === code(0) && e.examType === 'midterm')!.timing, timing);
    assert.equal(result.project.events.find(e => e.courseCode === code(1) && e.examType === 'midterm')!.timing!.date, '2026-08-19');
    assert.equal(result.quality.sameDayPairs, 0); assert.equal(result.quality.consecutiveDayPairs, 0);
  }
});

test('peak concurrency handles nested full-day exams and touching intervals', () => {
  const p = project([0, 1, 2, 3].map(i => section(code(i), [code(i)])));
  const exams = p.events.filter(e => e.examType === 'midterm');
  const intervals = [[540, 960], [540, 720], [780, 900], [900, 1020]];
  exams.forEach((e, i) => { e.timing = { date: '2026-08-17', startMinutes: intervals[i][0], endMinutes: intervals[i][1] }; });
  assert.equal(scheduleQuality(p).peakConcurrentExams, 2);
});

test('two-exam exchanges improve burden when neither exam can relocate alone', () => {
  const a = section(code(0), ['G', 'X', 'Z']), b = section(code(1), ['G', 'Y']);
  const contexts = [section('040000001', ['X'], 'context'), section('040000002', ['Y'], 'context'), section('040000003', ['Y'], 'context')];
  contexts.forEach((e, i) => { e.exams.midterm = { date: '2026-08-19', startMinutes: 780 + i * 60, endMinutes: 840 + i * 60 }; });
  const p = project([a, b, ...contexts], [finalOff([a.courseCode, b.courseCode])]);
  p.settings.periods.midterm.end = '2026-08-19';
  p.settings.sessions = [p.settings.sessions[0]];
  p.settings.holidays = ['2026-08-18']; p.settings.holidayPolicy = 'never';
  const result = scheduleProject(p);
  assert.ok(result.search.exchangeMoves > 0);
  assert.equal(result.project.events.find(e => e.courseCode === a.courseCode && e.examType === 'midterm')!.timing!.date, '2026-08-19');
  assert.equal(result.project.events.find(e => e.courseCode === b.courseCode && e.examType === 'midterm')!.timing!.date, '2026-08-17');
  const facts = independentFacts(result.project);
  assert.equal(facts.clashes, 0); assert.equal(facts.sameDay, 2); assert.equal(facts.consecutive, 0);
  assert.equal(result.quality.sameDayPairs, facts.sameDay);
  assert.equal(result.quality.consecutiveDayPairs, facts.consecutive);
});

test('weekday fallback reuses placements within a small effort budget', () => {
  const sections = Array.from({ length: 100 }, (_, i) => section(code(i), i < 30 ? ['overloaded'] : [`G${i}`]));
  const p = project(sections, [finalOff(sections.map(s => s.courseCode))]);
  p.settings.periods.midterm.end = '2026-08-28'; p.settings.searchBudget = 180;
  const result = scheduleProject(p);
  assert.equal(result.quality.scheduledManagedEvents, 94);
  assert.equal(result.quality.weekendExams, 4);
  assert.equal(result.search.coverageOptimal, true);
  assert.equal(result.search.avoidedDaysOptimal, true);
  assert.ok(result.search.visitedNodes <= 108);
  assert.ok(result.search.visitedNodes + result.search.improvementEvaluations <= 180);
});

test('an effort cutoff is reported separately from proven optimal coverage', () => {
  const p = project(Array.from({ length: 20 }, (_, i) => section(code(i), [`G${i}`])));
  p.settings.searchBudget = 1;
  const result = scheduleProject(p);
  assert.equal(result.search.coverageOptimal, false);
  assert.equal(result.search.avoidedDaysOptimal, false);
  assert.equal(result.search.budgetExhausted, true);
  assert.ok(result.search.coverageUpperBound > result.quality.scheduledManagedEvents);
  assert.ok(result.unscheduled.some(u => u.reason === 'SEARCH_BUDGET_EXHAUSTED' && u.blockedCandidateCount === 0));
  assert.equal(independentFacts(result.project).clashes, 0);
});

test('search frames the coverage bound in data terms: impossible vs policy-declined', () => {
  const a = section(code(0), ['G']), b = section(code(1), ['G']), missing = section(code(2), []);
  const p = project([a, b, missing, section(code(3), ['H'])], [rule('same_time', [code(0), code(1)], 'final')]);
  const result = scheduleProject(p);
  assert.equal(result.search.provablyImpossibleEvents, 2); // a and b finals share group G plus a same-time rule
  assert.equal(result.search.policyDeclinedEvents, 2);     // missing groups block both of its exams
  assert.equal(result.search.maxPlaceableKnown, result.search.coverageUpperBound + 2); // declined events still have candidates
  assert.ok(result.unscheduled.some(u => u.reason === 'SAME_TIME_CONTRADICTION' && u.eventIds.length === 2));
  assert.ok(result.unscheduled.every(u => u.reason !== 'STUDENT_CONFLICTS' && u.reason !== 'SEARCH_BUDGET_EXHAUSTED'));
});
