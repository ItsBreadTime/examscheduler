import test from 'node:test';
import assert from 'node:assert/strict';
import { previewTimingEdit, scheduleProject } from '../src/lib/index.ts';
import { project, rule, section } from './helpers.ts';
const timing = { date: '2026-08-20', startMinutes: 540, endMinutes: 720 };

test('manual preview is immutable, preserves a lock and survives regeneration', () => {
  const p = scheduleProject(project([section('060000001')])).project;
  const before = structuredClone(p);
  const id = p.events.find(e => e.examType === 'midterm')!.id;
  const preview = previewTimingEdit(p, id, timing);
  assert.ok(preview.accepted); assert.deepEqual(p, before);
  assert.deepEqual(scheduleProject(preview.project).project.events.find(e => e.id === id)!.timing, timing);
});
test('manual preview rejects student conflicts without changing the input', () => {
  const p = scheduleProject(project([section('060000001'), section('060000002')])).project;
  const exams = p.events.filter(e => e.examType === 'midterm');
  const preview = previewTimingEdit(p, exams[0].id, exams[1].timing!);
  assert.equal(preview.accepted, false); assert.ok(preview.blockingIssues.some(i => i.type === 'STUDENT_GROUP_OVERLAP'));
  assert.notDeepEqual(p.events.find(e => e.id === exams[0].id)!.timing, exams[1].timing);
});
test('same-time edits apply atomically to every member', () => {
  const p = scheduleProject(project([section('060000001', ['A']), section('060000002', ['B'])], [rule('same_time', ['060000001', '060000002'])])).project;
  const id = p.events.find(e => e.examType === 'midterm')!.id;
  const preview = previewTimingEdit(p, id, timing);
  assert.ok(preview.accepted); assert.equal(preview.affectedIds.length, 2);
  assert.ok(preview.project.events.filter(e => e.examType === 'midterm').every(e => e.timingOrigin === 'manual' && e.timing!.date === timing.date));
});
test('manual editing rejects imported exams, invalid intervals and out-of-period dates', () => {
  const external = section('040000001', ['G'], 'context'); external.exams.midterm = timing;
  const p = scheduleProject(project([external, section('060000001')])).project;
  assert.throws(() => previewTimingEdit(p, p.events.find(e => e.ownership === 'context')!.id, timing), /fixed/);
  const id = p.events.find(e => e.ownership === 'managed' && e.examType === 'midterm')!.id;
  assert.throws(() => previewTimingEdit(p, id, { ...timing, endMinutes: 500 }), /valid/);
  assert.equal(previewTimingEdit(p, id, { ...timing, date: '2027-01-01' }).accepted, false);
});
test('unrelated source conflicts do not block a valid manual edit', () => {
  const a = section('040000001', ['E'], 'context'), b = section('050000001', ['E'], 'context');
  a.exams.midterm = timing; b.exams.midterm = timing;
  const p = scheduleProject(project([a, b, section('060000001', ['M'])])).project;
  const preview = previewTimingEdit(p, p.events.find(e => e.ownership === 'managed' && e.examType === 'midterm')!.id, timing);
  assert.ok(preview.accepted); assert.equal(preview.validation.overallStatus, 'invalid');
});
