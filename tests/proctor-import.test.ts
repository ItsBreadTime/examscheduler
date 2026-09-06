import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { parseProctors } from '../src/lib/import/proctors.ts';
import { readSpreadsheet } from '../src/lib/import/spreadsheet.ts';
import { defaultSettings, importProject } from '../src/lib/index.ts';
import type { SourceArtifact } from '../src/lib/types.ts';
import type { Spreadsheet } from '../src/lib/import/spreadsheet.ts';

const fixtures = join(import.meta.dirname, 'fixtures');
const artifact = (kind: SourceArtifact['kind'], id = `${kind}:test`): SourceArtifact => ({
  id, originalName: `${kind}.csv`, mediaType: 'text/csv', byteLength: 1, sha256: id, importedAt: '2026-09-05T00:00:00Z', kind,
});
const proctorSheet = (term: number): Spreadsheet => ({
  artifact: artifact('proctors'),
  sheets: [{ name: 'Roster', rows: [
    [`ตารางกรรมการกลางคุมสอบกลางภาคเรียนที่ 1 ปีการศึกษา ${term}`, '', ''],
    ['กรรมการ', 'จ.17/08/2569', ''],
    ['กลาง', '9-12', '13-16'],
    ['อ. P', 'P', 'Q'],
  ] }],
});
const xlsxBytes = (rows: string[][]): Uint8Array => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
};

test('paired date headers import every populated session with cell provenance', () => {
  const parsed = parseProctors(proctorSheet(2569));
  assert.equal(parsed.duties.length, 2);
  assert.deepEqual(parsed.duties.map(d => ({ date: d.date, interval: d.interval, column: d.sourceRef.column })), [
    { date: '2026-08-17', interval: { startMinutes: 540, endMinutes: 720 }, column: 2 },
    { date: '2026-08-17', interval: { startMinutes: 780, endMinutes: 960 }, column: 3 },
  ]);
});

test('a named adjacent header is not treated as a second session for the date', () => {
  const input = proctorSheet(2569);
  input.sheets[0].rows[1][2] = 'Notes';
  const parsed = parseProctors(input);
  assert.equal(parsed.duties.length, 1);
  assert.equal(parsed.duties[0].sourceRef.column, 2);
});

test('the real roster fixture retains every populated duty cell and merged provenance', async () => {
  const parsed = parseProctors(await readSpreadsheet(new Uint8Array(await readFile(join(fixtures, 'proctors.xls'))), 'proctors.xls', 'proctors'));
  // The four roster sheets contain 592 populated cells across their paired session columns.
  assert.equal(parsed.duties.length, 592);
  assert.equal(new Set(parsed.duties.map(d => `${d.sourceRef.sheet}:${d.sourceRef.row}:${d.sourceRef.column}`)).size, 592);
  const merged = parsed.proctors.find(p => p.displayName === 'รศ.ดร.ธัญญา');
  assert.equal(merged?.sourceRefs?.length, 2);
  assert.deepEqual(merged?.sourceRefs?.map(ref => ref.sheet), ['F168 (2)', 'M168']);
});

test('a mismatched dated roster is ineligible and its in-period duties are quarantined', async () => {
  const settings = defaultSettings({ start: '2026-08-17', end: '2026-08-18' }, { start: '2026-10-19', end: '2026-10-20' });
  const project = await importProject({
    courseSources: [{ name: 'course.xlsx', bytes: xlsxBytes([
      ['ภาคเรียนที่ 1 ปีการศึกษา 2569'],
      ['courseCode', 'courseName', 'sectionNumber', 'studentGroups', 'midtermDate', 'midtermTime', 'finalDate', 'finalTime', 'plannedEnrollment', 'registeredEnrollment', 'instructors'],
      ['060000001', 'Course', '1', 'G1', '', '', '', '', '', '', ''],
    ]), role: 'managed' }],
    references: [{ name: 'proctors.xlsx', bytes: xlsxBytes(proctorSheet(2568).sheets[0].rows), kind: 'proctors' }],
    settings,
  });
  const imported = project.proctors[0];
  assert.deepEqual(imported.assignmentEligibility, { eligible: false, reason: 'Proctor source belongs to a different academic term', sourceTerm: { semester: 1, academicYearBE: 2568, campus: undefined } });
  assert.equal(imported.availability.length, 0);
  assert.ok(project.importIssues.some(i => i.type === 'PROCTOR_SOURCE_TERM_MISMATCH'));
  assert.ok(project.importIssues.some(i => i.type === 'PROCTOR_MATRIX_QUARANTINED'));
});

test('a current-term roster keeps both current-period session constraints and their source cells', async () => {
  const settings = defaultSettings({ start: '2026-08-17', end: '2026-08-18' }, { start: '2026-10-19', end: '2026-10-20' });
  const project = await importProject({
    courseSources: [{ name: 'course.xlsx', bytes: xlsxBytes([
      ['ภาคเรียนที่ 1 ปีการศึกษา 2569'],
      ['courseCode', 'courseName', 'sectionNumber', 'studentGroups', 'midtermDate', 'midtermTime', 'finalDate', 'finalTime', 'plannedEnrollment', 'registeredEnrollment', 'instructors'],
      ['060000001', 'Course', '1', 'G1', '', '', '', '', '', '', ''],
    ]), role: 'managed' }],
    references: [{ name: 'proctors.xlsx', bytes: xlsxBytes(proctorSheet(2569).sheets[0].rows), kind: 'proctors' }],
    settings,
  });
  const imported = project.proctors[0];
  assert.deepEqual(imported.assignmentEligibility, { eligible: true, sourceTerm: { semester: 1, academicYearBE: 2569, campus: undefined } });
  assert.equal(imported.availability.length, 2);
  assert.deepEqual(imported.availability.map(constraint => ({ date: constraint.date, interval: constraint.interval, column: constraint.sourceRef?.column })), [
    { date: '2026-08-17', interval: { startMinutes: 540, endMinutes: 720 }, column: 2 },
    { date: '2026-08-17', interval: { startMinutes: 780, endMinutes: 960 }, column: 3 },
  ]);
  assert.ok(!project.importIssues.some(i => i.type === 'PROCTOR_MATRIX_QUARANTINED'));
});
