import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleProject, validateProject, overlaps, parseDate, parseInterval, reconcileRules, sameTiming, weekend, buildEvents, inspectImport } from '../src/lib/index.ts';
import { project, rule, section } from './helpers.ts';
const timing = { date: '2026-08-17', startMinutes: 540, endMinutes: 660 };
test('exact intervals overlap; touching boundaries do not', () => {
  assert.equal(overlaps(timing, { startMinutes: 600, endMinutes: 720 }), true);
  assert.equal(overlaps(timing, { startMinutes: 660, endMinutes: 720 }), false);
  assert.equal(overlaps(timing, { startMinutes: 540, endMinutes: 960 }), true);
});
test('Thai and ISO dates are strict, with arbitrary exam durations', () => {
  assert.equal(parseDate('17/08/69'), '2026-08-17'); assert.equal(parseDate('17/08/2569'), '2026-08-17');
  assert.equal(parseDate('17/08/2026'), '2026-08-17'); assert.equal(parseDate('31/02/69'), undefined);
  assert.equal(parseDate('2026-02-30'), undefined); assert.equal(parseInterval('09:70-12:00'), undefined);
  assert.deepEqual(parseInterval('9.00-11.00'), { startMinutes: 540, endMinutes: 660 });
});
test('scheduler is deterministic, immutable and independently valid', () => {
  const p = project([section('060000001'), section('060000002'), section('060000003', ['G2'])]); const before = structuredClone(p);
  const a = scheduleProject(p), b = scheduleProject(p);
  assert.deepEqual(a, b); assert.deepEqual(p, before); assert.equal(a.validation.overallStatus, 'valid'); assert.equal(a.unscheduled.length, 0);
});
test('context blank exams never become tasks; arbitrary imported intervals stay fixed', () => {
  const external = section('040000001', ['G1'], 'context'); external.exams.midterm = timing;
  const p = project([external, section('050000001', ['G3'], 'context'), section('060000001')]);
  const r = scheduleProject(p); assert.deepEqual(r.project.events.find(e => e.ownership === 'context')!.timing, timing);
  assert.equal(r.project.events.filter(e => e.ownership === 'context').length, 1);
  assert.equal(r.validation.overallStatus, 'valid');
});
test('context sections with differing fixed times remain distinct', () => {
  const a = section('040000001', ['G1'], 'context'), b = section('040000001', ['G2'], 'context');
  b.id = 'section2'; b.sectionNumber = 2; a.exams.midterm = timing; b.exams.midterm = { ...timing, startMinutes: 780, endMinutes: 900 };
  const r = scheduleProject(project([a, b, section('060000001')]));
  assert.deepEqual(r.project.events.filter(e => e.ownership === 'context').map(e => e.timing), [a.exams.midterm, b.exams.midterm]);
});
test('same-time graph normalizes transitively and reports malformed/stale/duplicate rules', () => {
  const sections = ['060000001', '060000002', '060000003'].map(c => section(c, [c]));
  const rules = [rule('same_time', ['060000001', '060000002']), rule('same_time', ['060000002', '060000003']), rule('same_time', ['060000002', '060000001']), rule('same_time', ['060000003', '060000099', '0602434074'])];
  const result = reconcileRules(rules, sections);
  assert.equal(result.groups.length, 2); assert.deepEqual(result.groups[0].courseCodes, sections.map(s => s.courseCode));
  for (const type of ['DUPLICATE_RULE', 'INVALID_RULE_CODE', 'STALE_RULE_REFERENCE', 'SAME_TIME_GROUP_PARTIALLY_STALE']) assert.ok(result.issues.some(i => i.type === type));
  const generated = scheduleProject(project(sections, rules));
  const midterms = generated.project.events.filter(e => e.examType === 'midterm');
  assert.ok(midterms.every(e => sameTiming(e.timing, midterms[0].timing)));
});
test('same-time shared student groups are a contradiction, not an allowed collision', () => {
  const r = scheduleProject(project([section('060000001'), section('060000002')], [rule('same_time', ['060000001', '060000002'])]));
  assert.ok(r.unscheduled.every(u => u.reason === 'SAME_TIME_CONTRADICTION')); assert.ok(r.project.events.every(e => !e.timing));
});
test('contradictory same-time locks remain fixed with visible invalid result', () => {
  const p = project([section('060000001', ['A']), section('060000002', ['B']), section('060000003', ['C'])], [rule('same_time', ['060000001', '060000002', '060000003'], 'midterm')]);
  p.locks['managed:060000001:midterm'] = timing; p.locks['managed:060000002:midterm'] = { ...timing, date: '2026-08-18' };
  const r = scheduleProject(p); assert.ok(r.unscheduled.some(u => u.reason === 'SAME_TIME_CONTRADICTION')); assert.ok(r.validation.issues.some(i => i.type === 'SAME_TIME_NOT_SATISFIED'));
});
test('full-day blocks both sessions', () => {
  const p = project([section('060000001'), section('060000002')], [rule('full_day', ['060000001'])]);
  const r = scheduleProject(p); const events = r.project.events.filter(e => e.examType === 'midterm');
  assert.equal(events[0].timing!.endMinutes, 960); assert.notEqual(events[0].timing!.date, events[1].timing!.date); assert.equal(r.validation.overallStatus, 'valid');
});
test('combined no-midterm rule excludes generation but permits an imported midterm', () => {
  const a = section('060000001'); a.exams.midterm = timing;
  const r = scheduleProject(project([a], [rule('exclude_from_central_schedule', [a.courseCode], 'midterm')]));
  assert.deepEqual(r.project.events.find(e => e.examType === 'midterm')!.timing, timing); assert.equal(r.validation.overallStatus, 'valid');
});
test('explicit no-exam blocks generation and conflicts with imported assignment', () => {
  const a = section('060000001');
  const p = project([a], [rule('no_exam', [a.courseCode])]);
  assert.ok(scheduleProject(p).project.events.every(e => !e.timing));
  a.exams.midterm = timing; const r = scheduleProject(p);
  assert.ok(r.validation.issues.some(i => i.type === 'NO_EXAM_RULE_VIOLATED'));
});
test('impossible events remain unscheduled with structured reasons', () => {
  const p = project([section('060000001'), section('060000002'), section('060000003')]);
  p.settings.periods.midterm.end = p.settings.periods.midterm.start;
  const r = scheduleProject(p); assert.equal(r.project.events.filter(e => e.examType === 'midterm' && e.timing).length, 2);
  assert.ok(r.unscheduled.length); assert.ok(!r.validation.issues.some(i => i.type === 'STUDENT_GROUP_OVERLAP'));
});
test('weekends and configured holidays are excluded when forbidden', () => {
  const p = project([section('060000001')]); p.settings.periods.midterm = { start: '2026-08-21', end: '2026-08-24' };
  p.settings.weekendPolicy = 'never'; p.settings.holidayPolicy = 'never'; p.settings.holidays = ['2026-08-21'];
  const r = scheduleProject(p); assert.equal(r.project.events.find(e => e.examType === 'midterm')!.timing!.date, '2026-08-24');
});
test('only-if-necessary searches weekdays before using weekends', () => {
  const p = project([section('060000001'), section('060000002'), section('060000003')]);
  p.settings.periods.midterm = { start: '2026-08-21', end: '2026-08-22' };
  const r = scheduleProject(p); assert.equal(r.unscheduled.length, 0);
  assert.equal(r.project.events.filter(e => e.examType === 'midterm' && weekend(e.timing!.date)).length, 1);
  assert.ok(r.validation.issues.some(i => i.type === 'EXAM_ON_WEEKEND'));
});
test('holiday-only period falls back visibly; never policy leaves unscheduled', () => {
  const p = project([section('060000001')]); p.settings.periods.midterm.end = p.settings.periods.midterm.start; p.settings.holidays = ['2026-08-17'];
  assert.ok(scheduleProject(p).validation.issues.some(i => i.type === 'EXAM_ON_HOLIDAY'));
  p.settings.holidayPolicy = 'never'; assert.equal(scheduleProject(p).unscheduled[0].reason, 'NO_CANDIDATES');
});
test('file input inspection flags fixed weekend/holiday dates before generation', () => {
  const a = section('040000001', ['A'], 'context'); a.exams.midterm = { ...timing, date: '2026-08-22' };
  const p = project([a, section('060000001')]); p.settings.holidays = ['2026-08-22']; p.events = buildEvents(p);
  const report = inspectImport(p); assert.ok(report.issues.some(i => i.type === 'EXAM_ON_WEEKEND')); assert.ok(report.issues.some(i => i.type === 'EXAM_ON_HOLIDAY')); assert.ok(!report.issues.some(i => i.type === 'UNSCHEDULED_REQUIRED_EXAM'));
});
test('search budget is deterministic and never produces forced conflicts', () => {
  const p = project(Array.from({ length: 10 }, (_, i) => section(`0600000${String(i).padStart(2, '0')}`))); p.settings.searchBudget = 1;
  const r = scheduleProject(p); assert.ok(r.unscheduled.some(u => u.reason === 'SEARCH_BUDGET_EXHAUSTED')); assert.ok(!r.validation.issues.some(i => i.type === 'STUDENT_GROUP_OVERLAP')); assert.deepEqual(r, scheduleProject(p));
});
test('manual locks and separate exam-type state survive generation', () => {
  const p = project([section('060000001')]); p.locks['managed:060000001:midterm'] = timing;
  const r = scheduleProject(p); assert.deepEqual(r.project.events.find(e => e.examType === 'midterm')!.timing, timing); assert.ok(r.project.events.find(e => e.examType === 'final')!.timing!.date.startsWith('2026-10'));
});
test('validator catches fabricated collision, even if output groups are erased', () => {
  const r = scheduleProject(project([section('060000001'), section('060000002')])).project;
  const midterms = r.events.filter(e => e.examType === 'midterm'); midterms[1].timing = midterms[0].timing; midterms[1].studentGroups = [];
  const v = validateProject(r); assert.ok(v.issues.some(i => i.type === 'STUDENT_GROUP_OVERLAP')); assert.ok(v.issues.some(i => i.type === 'EVENT_MODEL_CHANGED'));
});
test('validator catches missing/duplicate events, changed fixed times and date ranges', () => {
  const a = section('040000001', ['E'], 'context'); a.exams.midterm = timing;
  const p = scheduleProject(project([a, section('060000001')])).project;
  p.events.find(e => e.ownership === 'context')!.timing!.date = '2026-08-18';
  p.events.find(e => e.ownership === 'managed')!.timing!.date = '2027-01-01';
  p.events.pop(); p.events.push(structuredClone(p.events[0]));
  const types = validateProject(p).issues.map(i => i.type);
  for (const type of ['FIXED_TIMING_CHANGED', 'OUTSIDE_PERIOD', 'MISSING_EVENT', 'DUPLICATE_EVENT']) assert.ok(types.includes(type), type);
});
test('validator rejects fabricated same-time/full-day violations independently', () => {
  const p = project([section('060000001', ['A']), section('060000002', ['B'])], [rule('same_time', ['060000001', '060000002']), rule('full_day', ['060000001'])]);
  const r = scheduleProject(p).project; const event = r.events.find(e => e.courseCode === '060000001')!; event.timing!.endMinutes = 720;
  const types = validateProject(r).issues.map(i => i.type); assert.ok(types.includes('FULL_DAY_REQUIRED')); assert.ok(types.includes('SAME_TIME_NOT_SATISFIED'));
});
test('source conflicts remain visible, with resource coverage not checked', () => {
  const a = section('040000001', ['G'], 'context'), b = section('050000001', ['G'], 'context'); a.exams.midterm = timing; b.exams.midterm = timing;
  const r = scheduleProject(project([a, b, section('060000001', ['G'])]));
  assert.equal(r.validation.overallStatus, 'invalid'); assert.ok(r.validation.issues.some(i => i.type === 'SOURCE_EXAM_CONFLICT' && i.origin === 'source')); assert.equal(r.validation.coverage.roomCapacity, 'not_checked');
});
