import test from 'node:test';
import assert from 'node:assert/strict';
import { assignResources, buildEvents, validateProject } from '../src/lib/index.ts';
import { buildAuditBundle } from '../src/lib/audit.ts';
import { roomsRows } from '../src/lib/export.ts';
import { project, proctor, room, section } from './helpers.ts';

const morning = (date: string) => ({ date, startMinutes: 540, endMinutes: 720 });

test('audit and room export keep unknown proctor demand separate from known positions', async () => {
  const snapshot = project([section('060000001', ['G1']), section('060000002', ['G2'])]);
  snapshot.rooms = [room('Known room', { proctorsRequired: 2 }), room('Unspecified room')];
  snapshot.proctors = [proctor('P1'), proctor('P2')];
  snapshot.events = buildEvents(snapshot);
  for (const event of snapshot.events) {
    event.timing = morning(event.examType === 'midterm' ? '2026-08-17' : '2026-10-19');
    event.timingOrigin = 'generated';
  }

  const assigned = assignResources(snapshot);
  assert.equal(assigned.summary.scheduledManagedEvents, 4);
  assert.equal(assigned.summary.roomsAssigned, 4);
  assert.equal(assigned.summary.eventsWithUnknownProctorDemand, 2);
  assert.equal(assigned.summary.roomsWithUnknownProctorDemand, 1);
  assert.equal(assigned.summary.positionsFilled, assigned.summary.proctorPositions);
  assert.equal(assigned.summary.eventsWithUnfilledProctorPositions, 0);

  const audit = await buildAuditBundle(assigned.project, assigned.validation);
  for (const key of [
    'scheduledManagedEvents', 'roomsAssigned', 'roomsUnassigned', 'proctorPositions', 'positionsFilled',
    'positionsUnfilled', 'eventsWithUnknownProctorDemand', 'roomsWithUnknownProctorDemand',
    'eventsWithUnfilledProctorPositions', 'eligibleProctors', 'ineligibleProctors', 'computerRuleApplied',
  ] as const) assert.equal(audit.summary[key], assigned.summary[key], key);

  const unknownRows = roomsRows(assigned.project).slice(1).filter(row => row[7] === 'ไม่ทราบ');
  assert.equal(unknownRows.length, 2);
  assert.ok(unknownRows.every(row => row[8] === 'ไม่ทราบความต้องการ'));
});

test('duplicate proctor IDs cannot inflate audit or exported staffing counts', async () => {
  const snapshot = project([section('060000001')]);
  snapshot.rooms = [room('Known room', { proctorsRequired: 2 })];
  const first = proctor('P');
  snapshot.proctors = [first, { ...proctor('Other name'), id: first.id }];
  snapshot.events = buildEvents(snapshot);
  const event = snapshot.events.find(candidate => candidate.examType === 'midterm')!;
  event.timing = morning('2026-08-17');
  event.timingOrigin = 'generated';
  event.roomAssignments = [snapshot.rooms[0].id];
  event.proctorAssignments = [first.id, first.id];

  const validation = validateProject(snapshot);
  assert.ok(validation.issues.some(issue => issue.type === 'DUPLICATE_PROCTOR_ID'));
  assert.ok(validation.issues.some(issue => issue.type === 'DUPLICATE_PROCTOR_ASSIGNMENT'));
  const audit = await buildAuditBundle(snapshot, validation);
  assert.equal(audit.summary.proctorPositions, 2);
  assert.equal(audit.summary.positionsFilled, 0);
  assert.equal(audit.summary.positionsUnfilled, 2);
  assert.equal(audit.summary.eventsWithUnfilledProctorPositions, 1);

  const row = roomsRows(snapshot).find(candidate => candidate[4] === '060000001' && candidate[0] === '2026-08-17')!;
  assert.equal(row[6], 'P');
  assert.equal(row[7], 2);
  assert.equal(row[8], 'ไม่ครบ');

  const invalidDemand = structuredClone(snapshot);
  invalidDemand.rooms[0].proctorsRequired = 0;
  const invalidDemandRow = roomsRows(invalidDemand).find(candidate => candidate[4] === '060000001' && candidate[0] === '2026-08-17')!;
  assert.equal(invalidDemandRow[7], 'ไม่ทราบ');
  assert.equal(invalidDemandRow[8], 'ไม่ทราบความต้องการ');

  const ambiguousRoom = structuredClone(snapshot);
  ambiguousRoom.events.find(candidate => candidate.id === event.id)!.roomAssignments = [snapshot.rooms[0].id, snapshot.rooms[0].id];
  const ambiguousRoomRow = roomsRows(ambiguousRoom).find(candidate => candidate[4] === '060000001' && candidate[0] === '2026-08-17')!;
  assert.equal(ambiguousRoomRow[7], 'ไม่ทราบ');
  assert.equal(ambiguousRoomRow[8], 'ไม่ทราบความต้องการ');
});
