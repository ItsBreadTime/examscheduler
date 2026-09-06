import test from 'node:test';
import assert from 'node:assert/strict';
import { assignResources, projectHashes, proctorAvailable, summarizeAssignedResources, validateProject } from '../src/lib/index.ts';
import type { AcademicTerm, ExamEvent, ExamTiming, Project, SourceArtifact } from '../src/lib/types.ts';
import { project, proctor, room, rule, section } from './helpers.ts';
import { timingsOverlap } from '../src/lib/time.ts';

const midterm = (startMinutes: number, endMinutes: number, date = '2026-08-17'): ExamTiming => ({ date, startMinutes, endMinutes });
const noFinal = (codes: string[]) => rule('no_exam', codes, 'final');

function managedProject(codes: string[], groups = codes.map((_, i) => `G${i + 1}`)): Project {
  return project(codes.map((code, i) => section(code, [groups[i]])), [noFinal(codes)]);
}

function eventOf(p: Project, code: string, examType: 'midterm' | 'final' = 'midterm'): ExamEvent {
  return p.events.find(e => e.courseCode === code && e.examType === examType)!;
}

function setTiming(event: ExamEvent, timing: ExamTiming): void {
  event.timing = timing;
  event.timingOrigin = 'generated';
}

function maximumProctorCardinality(events: ExamEvent[], proctors: Project['proctors']): number {
  let best = 0;
  const assigned = new Map<string, ExamTiming[]>();
  let count = 0;
  const visit = (index: number): void => {
    if (count + events.length - index <= best) return;
    if (index === events.length) { best = Math.max(best, count); return; }
    const event = events[index];
    visit(index + 1);
    for (const candidate of proctors) {
      if (!proctorAvailable(candidate, event.timing!)) continue;
      const duties = assigned.get(candidate.id) ?? [];
      if (duties.some(timing => timingsOverlap(timing, event.timing!))) continue;
      duties.push(event.timing!); assigned.set(candidate.id, duties); count++;
      visit(index + 1);
      duties.pop(); count--;
    }
  };
  visit(0);
  return best;
}

function artifact(kind: SourceArtifact['kind'], id: string, term?: AcademicTerm): SourceArtifact {
  return { id, originalName: `${id}.xlsx`, mediaType: 'application/octet-stream', byteLength: 1, sha256: id, importedAt: '2026-09-05T00:00:00Z', kind, term };
}

test('augmenting reassignment reaches maximum cardinality for the audited counterexample', () => {
  const p = managedProject(['060000001', '060000002']);
  const first = eventOf(p, '060000001'), second = eventOf(p, '060000002');
  setTiming(first, midterm(540, 720));
  setTiming(second, midterm(600, 780));
  p.rooms = [room('R1', { proctorsRequired: 1 }), room('R2', { proctorsRequired: 1 })];
  const a = proctor('A');
  const b = proctor('B', { availability: [{ available: false, date: '2026-08-17', interval: { startMinutes: 720, endMinutes: 780 } }] });
  p.proctors = [a, b];

  const result = assignResources(p);
  assert.equal(result.summary.proctorPositions, 2);
  assert.equal(result.summary.positionsFilled, 2);
  assert.deepEqual(eventOf(result.project, '060000001').proctorAssignments, [b.id]);
  assert.deepEqual(eventOf(result.project, '060000002').proctorAssignments, [a.id]);
  assert.equal(result.validation.issues.some(i => i.type === 'PROCTOR_DOUBLE_BOOKED'), false);
});

test('partial interval components can replace one long duty with two touching shorter duties', () => {
  const p = managedProject(['060000001', '060000002', '060000003']);
  setTiming(eventOf(p, '060000001'), midterm(530, 780));
  setTiming(eventOf(p, '060000002'), midterm(540, 660));
  setTiming(eventOf(p, '060000003'), midterm(660, 780));
  p.rooms = [room('R1', { proctorsRequired: 1 }), room('R2', { proctorsRequired: 1 }), room('R3', { proctorsRequired: 1 })];
  p.proctors = [proctor('Only proctor')];

  const result = assignResources(p);
  assert.equal(result.summary.proctorPositions, 3);
  assert.equal(result.summary.positionsFilled, 2);
  assert.deepEqual(eventOf(result.project, '060000001').proctorAssignments, []);
  assert.deepEqual(eventOf(result.project, '060000002').proctorAssignments, ['proctor:Only proctor']);
  assert.deepEqual(eventOf(result.project, '060000003').proctorAssignments, ['proctor:Only proctor']);
  assert.equal(result.validation.issues.some(i => i.type === 'PROCTOR_DOUBLE_BOOKED'), false);
});

test('partially overlapping duties never double-book a proctor', () => {
  const p = managedProject(['060000001', '060000002']);
  setTiming(eventOf(p, '060000001'), midterm(540, 720));
  setTiming(eventOf(p, '060000002'), midterm(660, 840));
  p.rooms = [room('R1', { proctorsRequired: 1 }), room('R2', { proctorsRequired: 1 })];
  p.proctors = [proctor('Only proctor')];

  const result = assignResources(p);
  assert.equal(result.summary.positionsFilled, 1);
  assert.equal(result.project.events.filter(e => e.proctorAssignments.includes('proctor:Only proctor')).length, 1);
  assert.equal(result.validation.issues.some(i => i.type === 'PROCTOR_DOUBLE_BOOKED'), false);
});

test('touching endpoints do not conflict, so one proctor can cover both sessions', () => {
  const p = managedProject(['060000001', '060000002']);
  setTiming(eventOf(p, '060000001'), midterm(540, 660));
  setTiming(eventOf(p, '060000002'), midterm(660, 780));
  p.rooms = [room('R1', { proctorsRequired: 1 }), room('R2', { proctorsRequired: 1 })];
  p.proctors = [proctor('Only proctor')];

  const result = assignResources(p);
  assert.equal(result.summary.positionsFilled, 2);
  assert.ok(result.project.events.filter(e => e.timing).every(e => e.proctorAssignments[0] === 'proctor:Only proctor'));
  assert.equal(result.validation.issues.some(i => i.type === 'PROCTOR_DOUBLE_BOOKED'), false);
});

test('context room and proctor assignments survive and reserve both resources', () => {
  const managed = section('060000001', ['managed-group']);
  const external = section('040000001', ['context-group'], 'context');
  external.exams.midterm = midterm(540, 720);
  const p = project([managed, external], [noFinal(['060000001'])]);
  const context = eventOf(p, '040000001');
  context.roomAssignments = ['room:R1'];
  context.proctorAssignments = ['proctor:Context proctor'];
  const target = eventOf(p, '060000001');
  setTiming(target, midterm(540, 720));
  p.rooms = [room('R1', { proctorsRequired: 1 }), room('R2', { proctorsRequired: 1 })];
  p.proctors = [proctor('Context proctor'), proctor('Managed proctor')];

  const result = assignResources(p);
  const preserved = eventOf(result.project, '040000001');
  const assigned = eventOf(result.project, '060000001');
  assert.deepEqual(preserved.roomAssignments, ['room:R1']);
  assert.deepEqual(preserved.proctorAssignments, ['proctor:Context proctor']);
  assert.deepEqual(assigned.roomAssignments, ['room:R2']);
  assert.deepEqual(assigned.proctorAssignments, ['proctor:Managed proctor']);
  assert.equal(result.validation.issues.some(i => i.type === 'ROOM_DOUBLE_BOOKED'), false);
  assert.equal(result.validation.issues.some(i => i.type === 'PROCTOR_DOUBLE_BOOKED'), false);
});

test('duplicate room and roster identities are excluded from allocation and reported', () => {
  const p = managedProject(['060000001']);
  setTiming(eventOf(p, '060000001'), midterm(540, 720));
  const duplicateRoom = room('R1', { proctorsRequired: 1 });
  const duplicateRoomAgain = structuredClone(duplicateRoom);
  duplicateRoomAgain.sourceRef = { artifactId: 'rooms', row: 2 };
  p.rooms = [duplicateRoom, duplicateRoomAgain, room('R2', { proctorsRequired: 1 })];
  const duplicateProctor = proctor('Duplicate');
  const duplicateProctorAgain = structuredClone(duplicateProctor);
  duplicateProctorAgain.sourceRef = { artifactId: 'proctors', row: 2 };
  p.proctors = [duplicateProctor, duplicateProctorAgain, proctor('Unique')];

  const result = assignResources(p);
  assert.deepEqual(eventOf(result.project, '060000001').roomAssignments, ['room:R2']);
  assert.deepEqual(eventOf(result.project, '060000001').proctorAssignments, ['proctor:Unique']);
  assert.ok(result.validation.issues.some(i => i.type === 'DUPLICATE_ROOM_ID'));
  assert.ok(result.validation.issues.some(i => i.type === 'DUPLICATE_PROCTOR_ID'));
});

test('duplicate assigned proctor IDs count once and fail structural validation', () => {
  const p = managedProject(['060000001']);
  const target = eventOf(p, '060000001');
  setTiming(target, midterm(540, 720));
  p.rooms = [room('R1', { proctorsRequired: 2 })];
  p.proctors = [proctor('P'), proctor('Q')];
  target.roomAssignments = ['room:R1'];
  target.proctorAssignments = ['proctor:P', 'proctor:P'];

  const summary = summarizeAssignedResources(p);
  const validation = validateProject(p);
  assert.equal(summary.proctorPositions, 2);
  assert.equal(summary.positionsFilled, 1);
  assert.ok(validation.issues.some(i => i.type === 'DUPLICATE_PROCTOR_ASSIGNMENT'));
  assert.ok(validation.issues.some(i => i.type === 'PROCTOR_REQUIREMENT_UNSATISFIED'));
});

test('invalid proctor demand values are safe, unknown and never create positions', () => {
  for (const value of [0, -1, 1.5, Number.NaN]) {
    const p = managedProject(['060000001']);
    setTiming(eventOf(p, '060000001'), midterm(540, 720));
    p.rooms = [room('R1', { proctorsRequired: value })];
    p.proctors = [proctor('P')];

    const result = assignResources(p);
    assert.equal(result.summary.proctorPositions, 0, `positions for ${value}`);
    assert.equal(result.summary.positionsFilled, 0, `filled for ${value}`);
    assert.equal(result.summary.eventsWithUnknownProctorDemand, 1, `unknown events for ${value}`);
    assert.ok(result.validation.issues.some(i => i.type === 'INVALID_PROCTOR_DEMAND'), `invalid demand for ${value}`);
    assert.ok(result.validation.issues.some(i => i.type === 'PROCTOR_DEMAND_UNKNOWN'), `unknown demand for ${value}`);
  }
});

test('unavailable assigned proctors are validated without a room, including context and unexpected events', () => {
  const unavailable = proctor('Unavailable', { availability: [{ available: false, date: '2026-08-17', interval: { startMinutes: 540, endMinutes: 720 }, sourceRef: { artifactId: 'availability', sheet: 'Matrix', row: 7, column: 4 } }] });

  const noRoom = managedProject(['060000001']);
  const noRoomEvent = eventOf(noRoom, '060000001');
  setTiming(noRoomEvent, midterm(540, 720));
  noRoom.proctors = [unavailable];
  noRoomEvent.proctorAssignments = [unavailable.id];
  const noRoomReport = validateProject(noRoom);
  assert.ok(noRoomReport.issues.some(i => i.type === 'PROCTOR_UNAVAILABLE' && i.blocking));
  assert.equal(noRoomReport.coverage.proctorAvailability, 'failed');

  const context = section('040000001', ['context-group'], 'context');
  context.exams.midterm = midterm(540, 720);
  const contextProject = project([context]);
  const contextEvent = eventOf(contextProject, '040000001');
  contextProject.proctors = [unavailable];
  contextEvent.proctorAssignments = [unavailable.id];
  assert.ok(validateProject(contextProject).issues.some(i => i.type === 'PROCTOR_UNAVAILABLE'));

  const unexpectedProject = managedProject(['060000001']);
  const unexpected = structuredClone(eventOf(unexpectedProject, '060000001'));
  unexpected.id = 'managed:ghost:midterm';
  setTiming(unexpected, midterm(540, 720));
  unexpectedProject.events = [unexpected];
  unexpectedProject.proctors = [unavailable];
  unexpected.proctorAssignments = [unavailable.id];
  const unexpectedReport = validateProject(unexpectedProject);
  assert.ok(unexpectedReport.issues.some(i => i.type === 'UNEXPECTED_EVENT'));
  assert.ok(unexpectedReport.issues.some(i => i.type === 'PROCTOR_UNAVAILABLE'));
});

test('resource assignments with missing or invalid timing are rejected without availability crashes', () => {
  for (const timing of [undefined, { date: 'not-a-date', startMinutes: 540, endMinutes: 720 }]) {
    const p = managedProject(['060000001']);
    const target = eventOf(p, '060000001');
    p.proctors = [proctor('P')];
    target.proctorAssignments = ['proctor:P'];
    target.timing = timing;
    if (timing) target.timingOrigin = 'generated';
    const report = validateProject(p);
    assert.ok(report.issues.some(i => i.type === 'RESOURCE_TIMING_INVALID'), String(timing));
  }
});

test('an empty roster produces an explicit staffing shortage for known demand', () => {
  const p = managedProject(['060000001']);
  setTiming(eventOf(p, '060000001'), midterm(540, 720));
  p.rooms = [room('R1', { proctorsRequired: 2 })];
  p.proctors = [];

  const result = assignResources(p);
  assert.equal(result.summary.proctorPositions, 2);
  assert.equal(result.summary.positionsFilled, 0);
  assert.equal(result.summary.positionsUnfilled, 2);
  assert.equal(result.summary.eventsWithUnfilledProctorPositions, 1);
  assert.ok(result.validation.issues.some(i => i.type === 'PROCTOR_REQUIREMENT_UNSATISFIED' && /no proctor roster imported/.test(i.message)));
  assert.equal(result.validation.coverage.proctorStaffing, 'failed');
  assert.equal(result.validation.coverage.proctorAvailability, 'not_checked');
});

test('shortage diagnostics explain blocked candidates and retain availability/context provenance', () => {
  const managed = section('060000001', ['managed-group']);
  const external = section('040000001', ['context-group'], 'context');
  external.exams.midterm = midterm(540, 720);
  const p = project([managed, external], [noFinal(['060000001'])]);
  const target = eventOf(p, '060000001');
  const context = eventOf(p, '040000001');
  setTiming(target, midterm(540, 720));
  context.proctorAssignments = ['proctor:Busy'];
  p.rooms = [room('R1', { proctorsRequired: 1 })];
  p.proctors = [
    proctor('Blocked', { availability: [{ available: false, date: '2026-08-17', interval: { startMinutes: 540, endMinutes: 720 }, sourceRef: { artifactId: 'availability', sheet: 'Matrix', row: 8, column: 4 } }] }),
    proctor('Busy'),
  ];

  const result = assignResources(p);
  assert.deepEqual(target.proctorAssignments, []);
  const issue = result.validation.issues.find(i => i.type === 'PROCTOR_REQUIREMENT_UNSATISFIED' && i.blockedCandidates?.length);
  assert.ok(issue);
  const blocked = issue!.blockedCandidates!.find(c => c.proctorId === 'proctor:Blocked')!;
  const busy = issue!.blockedCandidates!.find(c => c.proctorId === 'proctor:Busy')!;
  assert.ok(blocked.reasons.includes('unavailable'));
  assert.ok(blocked.sourceRefs.some(ref => ref.artifactId === 'availability' && ref.column === 4));
  assert.ok(busy.reasons.includes('overlapping_duty'));
  assert.ok(busy.eventIds.includes(context.id));
  assert.ok(busy.sourceRefs.some(ref => ref.artifactId === 'test'));
});

test('known mismatched proctor artifact cannot be selected from a restored snapshot', () => {
  const p = managedProject(['060000001']);
  setTiming(eventOf(p, '060000001'), midterm(540, 720));
  p.rooms = [room('R1', { proctorsRequired: 1 })];
  const sourceRef = { artifactId: 'legacy-proctors', sheet: 'Roster', row: 5, column: 1 };
  p.artifacts = [
    artifact('course', 'current-course', { academicYearBE: 2569, semester: 1 }),
    artifact('proctors', 'legacy-proctors', { academicYearBE: 2568, semester: 1 }),
  ];
  p.proctors = [proctor('Legacy', { sourceRef, sourceRefs: [sourceRef] })];

  const result = assignResources(p);
  assert.equal(result.summary.eligibleProctors, 0);
  assert.equal(result.summary.ineligibleProctors, 1);
  assert.deepEqual(eventOf(result.project, '060000001').proctorAssignments, []);
  const shortage = result.validation.issues.find(i => i.type === 'PROCTOR_REQUIREMENT_UNSATISFIED' && i.blockedCandidates?.length);
  assert.ok(shortage?.blockedCandidates?.some(c => c.proctorId === 'proctor:Legacy' && c.reasons.includes('ineligible_roster')));
});

test('computer rooms prefer a capable proctor while retaining cardinality', () => {
  const p = managedProject(['060000001']);
  setTiming(eventOf(p, '060000001'), midterm(540, 720));
  p.settings.computerProctorRule = true;
  p.rooms = [room('Computer', { proctorsRequired: 2, tags: ['computer'] })];
  p.proctors = [proctor('Plain'), proctor('Computer', { tags: ['computer'] })];

  const result = assignResources(p);
  const assignments = eventOf(result.project, '060000001').proctorAssignments;
  assert.equal(result.summary.positionsFilled, 2);
  assert.ok(assignments.includes('proctor:Computer'));
  assert.ok(assignments.includes('proctor:Plain'));
  assert.equal(result.validation.issues.some(i => i.type === 'COMPUTER_PROCTOR_MISSING'), false);
});

test('bounded exhaustive oracle agrees with allocation on a small arbitrary-interval instance', () => {
  const p = managedProject(['060000001', '060000002', '060000003', '060000004', '060000005']);
  const intervals = [[530, 780], [540, 660], [660, 780], [600, 720], [780, 900]];
  p.events.filter(e => e.examType === 'midterm').forEach((event, i) => setTiming(event, midterm(intervals[i][0], intervals[i][1])));
  p.rooms = intervals.map((_, i) => room(`R${i + 1}`, { proctorsRequired: 1 }));
  const a = proctor('A');
  const b = proctor('B', { availability: [{ available: false, date: '2026-08-17', interval: { startMinutes: 540, endMinutes: 660 } }] });
  p.proctors = [a, b];

  const events = p.events.filter(e => e.examType === 'midterm').sort((x, y) => x.id.localeCompare(y.id));
  const expected = maximumProctorCardinality(events, p.proctors);
  const result = assignResources(p);
  assert.equal(expected, 3);
  assert.equal(result.summary.positionsFilled, expected);
  assert.equal(result.validation.issues.some(i => i.type === 'PROCTOR_DOUBLE_BOOKED'), false);
});

test('thirty deterministic small interval cases match exhaustive maximum cardinality', () => {
  let state = 0x9e3779b9;
  const random = (limit: number): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 0x100000000) * limit);
  };
  for (let seed = 0; seed < 30; seed++) {
    const count = 2 + random(4);
    const codes = Array.from({ length: count }, (_, i) => String(70000000 + seed * 10 + i).padStart(9, '0'));
    const p = managedProject(codes);
    p.events.filter(e => e.examType === 'midterm').forEach(event => {
      const start = 480 + random(8) * 60;
      const duration = 60 + random(3) * 60;
      setTiming(event, midterm(start, start + duration, random(3) === 0 ? '2026-08-17' : '2026-08-18'));
    });
    p.rooms = codes.map((_, i) => room(`R${i}`, { proctorsRequired: 1 }));
    p.proctors = Array.from({ length: 2 + random(3) }, (_, i) => {
      const candidate = proctor(`P${i}`);
      if (random(3) === 0) {
        const start = 480 + random(8) * 60;
        candidate.availability = [{ available: false, date: random(2) === 0 ? '2026-08-17' : '2026-08-18', interval: { startMinutes: start, endMinutes: start + 60 + random(2) * 60 } }];
      }
      return candidate;
    });
    const events = p.events.filter(e => e.examType === 'midterm').sort((a, b) => a.id.localeCompare(b.id));
    const expected = maximumProctorCardinality(events, p.proctors);
    const result = assignResources(p);
    assert.equal(result.summary.positionsFilled, expected, `seed ${seed}`);
    assert.equal(result.validation.issues.some(i => i.type === 'PROCTOR_DOUBLE_BOOKED'), false, `double-booked seed ${seed}`);
  }
});

test('resource permutations and repeated assignment runs are deterministic', async () => {
  const p = managedProject(['060000001', '060000002']);
  setTiming(eventOf(p, '060000001'), midterm(540, 720));
  setTiming(eventOf(p, '060000002'), midterm(780, 960));
  p.rooms = [room('B', { proctorsRequired: 1 }), room('A', { proctorsRequired: 1 })];
  p.proctors = [proctor('Y'), proctor('X')];

  const first = assignResources(p);
  const second = assignResources(structuredClone(p));
  const permuted = structuredClone(p);
  permuted.rooms.reverse();
  permuted.proctors.reverse();
  permuted.events.reverse();
  const third = assignResources(permuted);
  const normalized = (result: ReturnType<typeof assignResources>) => result.project.events.map(e => [e.id, e.roomAssignments, e.proctorAssignments]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  assert.deepEqual(normalized(first), normalized(second));
  assert.deepEqual(normalized(first), normalized(third));
  assert.deepEqual(first.summary, second.summary);
  assert.deepEqual(first.summary, third.summary);
  assert.deepEqual(await projectHashes(first.project), await projectHashes(third.project));
});

test('malformed resource IDs in restored JSON are rejected without throwing', () => {
  for (const id of [null, 123, {}, '   ']) {
    const p = managedProject(['060000001']);
    setTiming(eventOf(p, '060000001'), midterm(540, 720));
    p.rooms = [room('Valid', { proctorsRequired: 1 }), room('Malformed', { id: id as string })];
    p.proctors = [proctor('Malformed', { id: id as string })];
    const result = assignResources(p);
    assert.equal(result.summary.positionsFilled, 0);
    assert.ok(result.validation.issues.some(i => i.type === 'INVALID_RESOURCE_ID'));
    assert.equal(result.validation.coverage.resourceIntegrity, 'failed');
  }
});

test('ambiguous candidate diagnostics retain every duplicate roster row and duty cell', () => {
  const p = managedProject(['060000001']);
  setTiming(eventOf(p, '060000001'), midterm(540, 720));
  p.rooms = [room('R', { proctorsRequired: 1 })];
  const refs = [
    { artifactId: 'roster', sheet: 'One', row: 3, column: 1 },
    { artifactId: 'roster', sheet: 'Two', row: 4, column: 1 },
  ];
  const cell = { artifactId: 'roster', sheet: 'One', row: 3, column: 5 };
  p.proctors = [
    proctor('P', { sourceRef: refs[0], availability: [{ available: false, date: '2026-08-17', sourceRef: cell }] }),
    proctor('P', { sourceRef: refs[1] }),
  ];
  const candidate = assignResources(p).issues.find(i => i.type === 'PROCTOR_REQUIREMENT_UNSATISFIED')!.blockedCandidates![0];
  assert.ok(candidate.reasons.includes('ambiguous_identity'));
  assert.ok(candidate.reasons.includes('unavailable'));
  for (const ref of [...refs, cell]) assert.ok(candidate.sourceRefs.some(actual => JSON.stringify(actual) === JSON.stringify(ref)));
});
