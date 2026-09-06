import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readSpreadsheet } from '../src/lib/import/spreadsheet.ts';
import { parseRooms } from '../src/lib/import/rooms.ts';
import { parseProctors } from '../src/lib/import/proctors.ts';
import { importProject } from '../src/lib/project.ts';
import { scheduleProject, assignResources, repairResources, validateProject, defaultSettings, buildEvents } from '../src/lib/index.ts';
import { auditSchemaVersion, buildAuditBundle, projectHashes, schedulerVersion, validatorVersion } from '../src/lib/audit.ts';
import { createZip } from '../src/lib/zip.ts';
import { toCsv, scheduleRows, calendarHtml, proctorMatrixRows } from '../src/lib/export.ts';
import { project, rule, section, room, proctor } from './helpers.ts';

const fixtures = join(import.meta.dirname, 'fixtures');
const load = async (name: string) => new Uint8Array(await readFile(join(fixtures, name)));
const midtiming = { date: '2026-08-17', startMinutes: 540, endMinutes: 720 };

test('room fixture parses zones, computer tags and the documented proctor-count mapping', async () => {
  const parsed = parseRooms(await readSpreadsheet(await load('roominfo.csv'), 'roominfo.csv', 'rooms'));
  assert.equal(parsed.rooms.length, 13);
  const b420 = parsed.rooms.find(r => r.name === 'B4-20')!;
  assert.deepEqual(b420.zones, ['A', 'B', 'C']); assert.equal(b420.proctorsRequired, 4);
  assert.deepEqual(parsed.rooms.find(r => r.name === 'B4-07')!.zones, ['จ', 'ฉ', 'ช']);
  assert.ok(parsed.rooms.find(r => r.name === 'B4-01A')!.tags.includes('computer'));
  assert.ok(parsed.rooms.every(r => r.capacity === undefined));
  assert.ok(parsed.issues.some(i => i.type === 'ROOM_PROCTOR_COUNT_MAPPING' && !i.blocking));
});

test('proctor roster imports from csv and xls; the old dated matrix is quarantined, free text is never interpreted', async () => {
  const csv = parseProctors(await readSpreadsheet(await load('proctors.csv'), 'proctors.csv', 'proctors'));
  assert.equal(csv.proctors.length, 66);
  assert.deepEqual(csv.matrixDates, ['2026-01-19', '2026-01-20', '2026-01-21', '2026-01-22', '2026-01-23', '2026-01-24']);
  assert.equal(csv.duties.length, 0);
  // The Saturday note names ณัฐพันธ์, who is not on the roster; near-miss names must not inherit it.
  for (const name of ['proctors.csv', 'proctors.xls']) {
    const parsed = parseProctors(await readSpreadsheet(await load(name), name, 'proctors'));
    assert.ok(parsed.proctors.some(p => p.displayName === 'อ.ดร.ประดิษฐ์' && p.tags.includes('computer') && p.role === 'อาจารย์'));
    assert.ok(parsed.proctors.some(p => p.displayName === 'ณัฐกานต์' && p.role === 'เจ้าหน้าที่'));
    const note = parsed.issues.find(i => i.type === 'PROCTOR_FREE_TEXT_NOTE')!;
    assert.match(note.message, /ณัฐพันธ์/);
    assert.ok(parsed.proctors.every(p => p.availability.length === 0));
  }
  // The xls workbook is a mixed-term archive: four roster sheets merge to one roster, old duty
  // matrices are read but dated far outside any configured period, non-roster sheets are disclosed.
  const xls = parseProctors(await readSpreadsheet(await load('proctors.xls'), 'proctors.xls', 'proctors'));
  assert.equal(xls.proctors.length, 93);
  assert.equal(xls.proctors.filter(p => p.role === 'อาจารย์').length, 43);
  assert.ok(xls.duties.length > 200); assert.ok(xls.matrixDates.every(d => d < '2026-08-01'));
  assert.ok(xls.issues.some(i => i.type === 'PROCTOR_SHEET_SKIPPED' && /Sheet6/.test(i.message)));
  assert.ok(xls.issues.some(i => i.type === 'PROCTOR_ROSTER_SHEETS'));
});

test('importProject integrates rooms and proctors with term diagnostics', async () => {
  const settings = defaultSettings({ start: '2026-08-17', end: '2026-08-28' }, { start: '2026-10-14', end: '2026-10-30' });
  const p = await importProject({
    courseSources: [{ name: '06.xlsx', bytes: await load('06.xlsx'), role: 'managed', expectedPrefix: '06' }],
    rules: { name: 'rules.csv', bytes: await load('rules.csv') },
    references: [{ name: 'roominfo.csv', bytes: await load('roominfo.csv'), kind: 'rooms' }, { name: 'proctors.xls', bytes: await load('proctors.xls'), kind: 'proctors' }],
    settings,
  });
  assert.equal(p.rooms.length, 13); assert.equal(p.proctors.length, 93);
  for (const type of ['PROCTOR_SOURCE_TERM_MISMATCH', 'PROCTOR_MATRIX_QUARANTINED']) assert.ok(p.importIssues.some(i => i.type === type), type);
  assert.ok(!p.importIssues.some(i => i.type === 'RESOURCE_SCHEDULING_NOT_IMPLEMENTED'));
});

test('room and proctor assignment is deterministic, respects unavailability and leaves visible unresolved work', () => {
  const base = project([section('060000001'), section('060000002', ['G2']), section('060000003', ['G3'])]);
  base.rooms = [room('R1', { proctorsRequired: 2 }), room('R2'), room('R3')];
  base.proctors = [proctor('อาจารย์ ก'), proctor('อาจารย์ ข'), proctor('อาจารย์ ค', { availability: [{ available: false, dayOfWeek: 1, interval: { startMinutes: 540, endMinutes: 720 } }] })];
  const scheduled = scheduleProject(base);
  const a = assignResources(scheduled.project), b = assignResources(scheduled.project);
  assert.deepEqual(a.project, b.project); assert.deepEqual(a.summary, b.summary);
  assert.equal(a.summary.scheduledManagedEvents, a.summary.roomsAssigned);
  const midterm = scheduled.project.events.find(e => e.courseCode === '060000001' && e.examType === 'midterm')!;
  const assignedRoom = a.project.events.find(e => e.id === midterm.id)!.roomAssignments[0];
  // The proctor unavailable on Monday mornings is never assigned then; Monday is enforced, not guessed.
  if (new Date(`${midterm.timing!.date}T00:00:00Z`).getUTCDay() === 1 && midterm.timing!.startMinutes < 720 && midterm.timing!.endMinutes > 540) {
    assert.ok(!a.project.events.find(e => e.id === midterm.id)!.proctorAssignments.includes('proctor:อาจารย์ ค'));
  }
  assert.equal(a.issues.filter(i => i.origin === 'resource' && i.severity === 'error').length, 0);
});

test('resource shortage surfaces as warnings, never as silent overbooking', () => {
  const p = project([section('060000001'), section('060000002', ['G2'])]);
  p.rooms = [room('R1')];
  p.events = buildEvents(p);
  for (const event of p.events) { event.timing = event.examType === 'midterm' ? midtiming : { ...midtiming, date: '2026-10-19' }; event.timingOrigin = 'generated'; }
  const result = assignResources(p);
  assert.equal(result.summary.roomsAssigned, 2); assert.equal(result.summary.roomsUnassigned, 2);
  const validation = validateProject(result.project);
  assert.equal(validation.coverage.roomDoubleBooking, 'passed');
  assert.ok(validation.issues.some(i => i.type === 'ROOM_REQUIREMENT_UNSATISFIED' && !i.blocking));
  assert.equal(result.validation.overallStatus, 'valid_with_warnings');
});

test('the independent validator rejects fabricated resource corruption', () => {
  const p = project([section('060000001'), section('060000002', ['G2'])]);
  p.rooms = [room('R1')]; p.proctors = [proctor('อาจารย์ ก')];
  p.events = buildEvents(p);
  const [a, b] = p.events.filter(e => e.examType === 'midterm');
  a.roomAssignments = ['room:R1']; b.roomAssignments = ['room:R1'];
  a.proctorAssignments = ['proctor:อาจารย์ ก']; b.proctorAssignments = ['proctor:อาจารย์ ก'];
  for (const event of [a, b]) { event.timing = midtiming; event.timingOrigin = 'generated'; }
  const validation = validateProject(p);
  for (const type of ['ROOM_DOUBLE_BOOKED', 'PROCTOR_DOUBLE_BOOKED']) assert.ok(validation.issues.some(i => i.type === type), type);
  assert.equal(validation.coverage.roomDoubleBooking, 'failed'); assert.equal(validation.overallStatus, 'invalid');

  b.roomAssignments = ['room:Ghost']; b.proctorAssignments = ['proctor:ภูตผี'];
  const ghost = validateProject(p);
  assert.ok(ghost.issues.some(i => i.type === 'UNKNOWN_ROOM')); assert.ok(ghost.issues.some(i => i.type === 'UNKNOWN_PROCTOR'));

  b.roomAssignments = ['room:R1']; b.proctorAssignments = []; b.timing = { ...midtiming, startMinutes: 780, endMinutes: 960 };
  const unavailableProctor = proctor('อาจารย์ ก', { availability: [{ available: false, interval: { startMinutes: 780, endMinutes: 960 } }] });
  a.proctorAssignments = []; b.proctorAssignments = ['proctor:อาจารย์ ก'];
  const fresh = structuredClone(p); fresh.proctors = [unavailableProctor];
  assert.ok(validateProject(fresh).issues.some(i => i.type === 'PROCTOR_UNAVAILABLE' && i.blocking));
  // Coverage stays honest when resource sources are absent entirely.
  const empty = project([section('060000001')]);
  assert.equal(validateProject(empty).coverage.roomDoubleBooking, 'not_checked');
});

test('resource repair moves a flexible exam out of an exhausted session', () => {
  const p = project([section('060000001'), section('060000002', ['G2'])]);
  p.rooms = [room('R1')];
  p.events = buildEvents(p);
  for (const event of p.events) { event.timing = event.examType === 'midterm' ? midtiming : { ...midtiming, date: '2026-10-19' }; event.timingOrigin = 'generated'; }
  const result = repairResources(p);
  assert.ok(result.attempts.some(a => a.accepted));
  assert.equal(result.failuresAfter, 0);
  assert.ok(result.failuresBefore > result.failuresAfter);
  const timed = result.project.events.filter(e => e.timing && e.roomAssignments.length);
  assert.equal(result.project.events.filter(e => e.timing).every(e => e.roomAssignments.length), true);
  assert.notEqual(timed.length, 0);
});

test('repair never splits a same-time group', () => {
  const p = project([section('060000001'), section('060000002', ['G2'])], [rule('same_time', ['060000001', '060000002'])]);
  p.rooms = [room('R1')];
  p.events = buildEvents(p);
  for (const event of p.events) { event.timing = event.examType === 'midterm' ? midtiming : { ...midtiming, date: '2026-10-19' }; event.timingOrigin = 'generated'; }
  const result = repairResources(p);
  const members = result.project.events.filter(e => e.timing);
  assert.equal(members.length, 4); // both exam types, both courses
  for (const type of ['midterm', 'final']) {
    const pair = members.filter(e => e.examType === type);
    assert.deepEqual(pair.map(e => e.timing!.date + e.timing!.startMinutes), [pair[0].timing!.date + pair[0].timing!.startMinutes, pair[0].timing!.date + pair[0].timing!.startMinutes]);
  }
});

test('audit hashes are deterministic, content-sensitive and shared with the CLI', async () => {
  const p = project([section('060000001')]);
  const hashes = await projectHashes(p);
  assert.equal((await projectHashes(structuredClone(p))).scheduleHash, hashes.scheduleHash);
  const changed = structuredClone(p); changed.events[0].timing = midtiming;
  assert.notEqual((await projectHashes(changed)).scheduleHash, hashes.scheduleHash);
  const bundle = await buildAuditBundle(p);
  assert.equal(bundle.schemaVersion, auditSchemaVersion);
  assert.equal(bundle.schedulerVersion, schedulerVersion);
  assert.equal(bundle.validatorVersion, validatorVersion);
});

test('CSV and HTML exports use one escaping implementation and never hide unscheduled exams', () => {
  assert.equal(toCsv([['a', 'x"y,z'], ['b', 'line\nbreak']]), 'a,"x""y,z"\r\nb,"line\nbreak"\r\n');
  // Spreadsheet text must not execute as a formula when the CSV opens in Excel; numbers keep their sign.
  assert.equal(toCsv([['=cmd|\' /c calc!A0', '@SUM(A1)', '+1', '-1', -1, 'safe']]), "'=cmd|' /c calc!A0,'@SUM(A1),'+1,'-1,-1,safe\r\n");
  const p = project([section('060000001'), section('060243112')]);
  p.events = buildEvents(p);
  p.sections.find(s => s.courseCode === '060000001')!.courseName = '<script>alert(1)</script>';
  const rows = scheduleRows(p);
  assert.equal(rows.filter(r => r[9] === 'ยังไม่จัด').length, 4); // both courses, both exam types
  const withRooms = structuredClone(p); withRooms.rooms = [room('R1')]; withRooms.proctors = [proctor('อาจารย์ ก')];
  for (const event of withRooms.events.filter(e => e.examType === 'midterm')) { event.timing = midtiming; event.timingOrigin = 'generated'; event.roomAssignments = ['room:R1']; event.proctorAssignments = ['proctor:อาจารย์ ก']; }
  const html = calendarHtml(withRooms, 'midterm');
  assert.ok(!html.includes('<script>alert')); assert.ok(html.includes('&lt;script&gt;'));
  const matrix = proctorMatrixRows(withRooms);
  assert.ok(matrix[0].length > 4 && matrix[0].includes('จ.17/08/69'));
  const dutyRow = matrix.find(r => r[0] === 'อาจารย์ ก')!;
  assert.ok(dutyRow.some(cell => String(cell).includes('060000001')));
});

test('zip writer produces a valid archive readable by standard tools', async () => {
  const encoder = new TextEncoder();
  const bytes = createZip([{ path: 'sources/roominfo.csv', bytes: await load('roominfo.csv') }, { path: 'project.json', bytes: encoder.encode('{"schemaVersion":1}') }]);
  const { writeFile } = await import('node:fs/promises');
  await writeFile('/tmp/examsched-zip-test.zip', bytes);
  const listing = execFileSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip() or "ok"); print("\\n".join(z.namelist())); print(len(z.read("sources/roominfo.csv")))', '/tmp/examsched-zip-test.zip'], { encoding: 'utf-8' });
  assert.match(listing, /^ok/m); assert.match(listing, /project\.json/); assert.match(listing, /sources\/roominfo\.csv/);
});

test('validate CLI runs the shared validator and exits nonzero for invalid projects', async () => {
  const p = project([section('060000001'), section('060000002')]);
  const invalid = structuredClone(p); invalid.events[0].timing = midtiming; invalid.events[1].timing = midtiming;
  await writeFile('/tmp/examsched-validate-test.json', JSON.stringify(invalid));
  let status = 0, stdout = '';
  try { stdout = execFileSync('node', ['src/validate.ts', '/tmp/examsched-validate-test.json', '--json'], { encoding: 'utf-8' }); }
  catch (error) { status = (error as { status: number }).status; stdout = (error as { stdout: string }).stdout; }
  assert.equal(status, 2);
  const report = JSON.parse(stdout);
  assert.equal(report.status, 'invalid'); assert.equal(report.schemaVersion, 4);
  assert.ok(report.issues.some((i: { type: string }) => i.type === 'STUDENT_GROUP_OVERLAP'));
  assert.ok(report.coverage.studentOverlap === 'failed');
});
