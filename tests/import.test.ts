import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { readSpreadsheet, parseCourses, parseRules, importProject, defaultSettings, scheduleProject, inspectImport, validateProject, buildEvents } from '../src/lib/index.ts';
import type { SourceRole } from '../src/lib/types.ts';
const headers = ['courseCode', 'courseName', 'sectionNumber', 'studentGroups', 'midtermDate', 'midtermTime', 'finalDate', 'finalTime', 'plannedEnrollment', 'registeredEnrollment', 'instructors'];
const rows = [headers, ['060000001', 'Course', '1', 'InAE-1R\nInAE-1R\nG  A', '17/08/69', '09:00-11:00', '', '', '40', '0', 'Teacher'], ['', '', '2', 'G2', '', '', '', '', '20', '0', '']];
const workbook = () => { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Courses'); return book; };
for (const format of ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'fods'] as XLSX.BookType[]) test(`${format} parses course data with leading zeroes and provenance`, async () => {
  const bytes = XLSX.write(workbook(), { type: 'buffer', bookType: format });
  const input = await readSpreadsheet(bytes, `courses.${format}`, 'course', '2026-09-05T00:00:00Z'); const parsed = parseCourses(input, 'managed');
  assert.equal(parsed.sections.length, 2); assert.equal(parsed.sections[1].courseCode, '060000001'); assert.equal(parsed.sections[1].courseName, 'Course');
  assert.deepEqual(parsed.sections[0].studentGroups, ['G A', 'InAE-1R']); assert.equal(parsed.sections[0].sourceRef.row, 2);
  assert.equal(parsed.sections[0].plannedEnrollment, 40); assert.equal(parsed.sections[0].registeredEnrollment, 0);
  assert.equal(parsed.sections[0].exams.midterm!.endMinutes, 660); assert.match(input.artifact.sha256, /^[0-9a-f]{64}$/);
  assert.equal(parsed.issues.length, 0);
});
test('CSV UTF-8 BOM and quoted multiline cells retain leading zero codes', async () => {
  const csv = '\ufeff' + headers.join(',') + '\r\n060000001,"Course, A",1,"InAE-1R\nInAE-1R",17/08/69,09:00-11:00,,,40,0,Teacher\r\n';
  const parsed = parseCourses(await readSpreadsheet(new TextEncoder().encode(csv), 'a.csv', 'course'), 'managed');
  assert.equal(parsed.sections[0].courseCode, '060000001'); assert.equal(parsed.sections[0].courseName, 'Course, A'); assert.deepEqual(parsed.sections[0].studentGroups, ['InAE-1R']);
});
test('TSV imports the canonical flat header schema', async () => {
  const text = headers.join('\t') + '\n060000001\tCourse\t1\tG1\t17/08/69\t09:00-11:00\t\t\t40\t0\tTeacher';
  const parsed = parseCourses(await readSpreadsheet(new TextEncoder().encode(text), 'a.tsv', 'course'), 'managed'); assert.equal(parsed.sections[0].courseCode, '060000001');
});
test('actual Excel serial dates ignore US display format; formatted numeric course codes retain zeroes', async () => {
  const book = workbook(), sheet = book.Sheets.Courses;
  sheet.A2 = { t: 'n', v: 60000001, z: '000000000' }; sheet.E2 = { t: 'n', v: 46251, z: 'm/d/yy' };
  const input = await readSpreadsheet(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'dates.xlsx', 'course');
  const parsed = parseCourses(input, 'managed'); assert.equal(parsed.sections[0].courseCode, '060000001');
  const date = XLSX.SSF.parse_date_code(46251); assert.equal(parsed.sections[0].exams.midterm!.date, `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`);
});
test('headers can repeat and section codes inherit across them', async () => {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([rows[0], rows[1], [], headers, rows[2]]), 'Courses');
  const parsed = parseCourses(await readSpreadsheet(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'repeat.xlsx', 'course'), 'managed');
  assert.equal(parsed.sections.length, 2); assert.equal(parsed.sections[1].sourceRef.row, 5); assert.equal(parsed.issues.length, 0);
});
test('malformed codes and incomplete fixed timings produce import errors', async () => {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ['060000001', 'A', 1, 'G', '17/08/69', ''], ['bad', 'B', 1, 'G']]), 'Courses');
  const parsed = parseCourses(await readSpreadsheet(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'bad.xlsx', 'course'), 'context');
  assert.ok(parsed.issues.some(i => i.type === 'INVALID_EXAM_TIMING')); assert.ok(parsed.issues.some(i => i.type === 'MALFORMED_COURSE_ROW'));
});
test('unrecognized formats, empty sources and unknown headers fail visibly', async () => {
  await assert.rejects(readSpreadsheet(new Uint8Array(), 'empty.xlsx', 'course'), /empty/);
  await assert.rejects(readSpreadsheet(new Uint8Array([1]), 'file.pdf', 'course'), /Unsupported/);
  const parsed = parseCourses(await readSpreadsheet(new TextEncoder().encode('a,b\n1,2'), 'unknown.csv', 'course'), 'managed'); assert.equal(parsed.issues[0].type, 'NO_COURSE_RECORDS');
});
test('rule columns retain conservative and explicit no-exam semantics', async () => {
  const input = await readSpreadsheet(await readFile(new URL('./fixtures/rules.csv', import.meta.url)), 'rules.csv', 'rules');
  const parsed = parseRules(input); assert.equal(parsed.issues.length, 0);
  assert.ok(parsed.rules.some(r => r.courseCodes.includes('060123432') && r.action === 'exclude_from_central_schedule' && r.examType === 'midterm'));
  assert.ok(parsed.rules.some(r => r.action === 'no_exam' && !r.examType)); assert.ok(parsed.rules.some(r => r.courseCodes.includes('0602434074')));
});
test('legacy XLS proctor workbook is readable without treating old matrices as availability', async () => {
  const input = await readSpreadsheet(await readFile(new URL('./fixtures/proctors.xls', import.meta.url)), 'proctors.xls', 'proctors');
  assert.ok(input.sheets.some(s => s.name.includes('268'))); assert.ok(input.sheets.some(s => s.rows.flat().some(c => c.includes('ปีการศึกษา 2568'))));
});
test('real fixture imports every source row, preserves context, reports contradictions and generates zero collisions', async () => {
  const file = async (name: string) => ({ name, bytes: await readFile(new URL(`./fixtures/${name}`, import.meta.url)) });
  const p = await importProject({ courseSources: await Promise.all(['04', '05', '06', '08'].map(async prefix => ({ ...await file(`${prefix}.xlsx`), role: (prefix === '06' ? 'managed' : 'context') as SourceRole, expectedPrefix: prefix }))), rules: await file('rules.csv'), references: [{ ...await file('proctors.xls'), kind: 'proctors' }, { ...await file('roominfo.csv'), kind: 'rooms' }], settings: defaultSettings({ start: '2026-08-17', end: '2026-08-28' }, { start: '2026-10-14', end: '2026-10-30' }), importedAt: '2026-09-05T00:00:00Z' });
  const info = inspectImport(p);
  assert.deepEqual(info.sources.slice(0, 4).map(s => [s.sectionCount, s.courseCount]), [[24, 18], [82, 73], [238, 189], [54, 20]]);
  assert.ok(p.sections.some(s => s.faculty && s.department)); assert.ok(p.sections.some(s => s.studentGroups.some(g => g.startsWith('InAE-'))));
  for (const type of ['SOURCE_EXAM_CONFLICT', 'INVALID_RULE_CODE', 'STALE_RULE_REFERENCE', 'PROCTOR_SOURCE_TERM_MISMATCH', 'HOLIDAYS_NOT_CONFIGURED', 'SAME_TIME_CONTRADICTION']) assert.ok(info.issues.some(i => i.type === type), type);
  assert.ok(!info.issues.some(i => i.type === 'MALFORMED_COURSE_ROW'));
  const original = structuredClone(p.events.filter(e => e.ownership === 'context'));
  const result = scheduleProject(p), again = scheduleProject(p);
  assert.deepEqual(result.project.events, again.project.events);
  assert.deepEqual(result.project.events.filter(e => e.ownership === 'context'), original);
  assert.equal(result.validation.issues.filter(i => i.type === 'STUDENT_GROUP_OVERLAP').length, 0);
  assert.equal(result.project.events.filter(e => e.timingOrigin === 'generated' && e.timing).length, 354);
  assert.equal(result.unscheduled.flatMap(u => u.eventIds).length, 6);
  assert.equal(result.validation.overallStatus, 'invalid'); assert.equal(result.validation.coverage.roomCapacity, 'not_checked');
  assert.ok(result.project.events.some(e => e.timingOrigin === 'imported' && e.timing!.endMinutes - e.timing!.startMinutes === 120));
  assert.ok(result.validation.issues.every(i => i.type !== 'NONSTANDARD_GENERATED_INTERVAL'));
  assert.deepEqual(validateProject(result.project), result.validation);
  // Reordered source and rule collections produce the same timings.
  const reordered = structuredClone(p); reordered.sections.reverse(); reordered.rules.reverse(); reordered.events = buildEvents(reordered);
  assert.deepEqual(scheduleProject(reordered).project.events.map(e => [e.id, e.timing]), result.project.events.map(e => [e.id, e.timing]));
});
