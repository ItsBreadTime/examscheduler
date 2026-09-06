// Regenerates the synthetic fixtures used by the Thai usage manual.
// All course codes, groups, instructors and dates are invented for demonstration.
// Output is deterministic (no randomness). Re-run with:
//   node --experimental-strip-types docs/usage-report/examples/generate.ts
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as XLSX from 'xlsx';

const outDir = resolve(import.meta.dirname, '.');
const clean = join(outDir, 'clean');
const badCode = join(outDir, 'bad-code');
const missingGroup = join(outDir, 'missing-group');
const staleRule = join(outDir, 'stale-rule');
const tight = join(outDir, 'tight-calendar');
for (const dir of [clean, badCode, missingGroup, staleRule, tight]) mkdirSync(dir, { recursive: true });

/** One logical course row. `groups` may be empty to simulate a missing-group mistake. */
interface Row {
  code: string; name: string; section: number; groups: string[];
  midterm?: string; final?: string; planned?: number; registered?: number;
  /** When set, the code cell is written as a number (simulates a lost leading zero). */
  numericCode?: boolean;
}

const HEADERS = ['courseCode', 'courseName', 'sectionNumber', 'studentGroups', 'midtermDate', 'midtermTime', 'finalDate', 'finalTime', 'plannedEnrollment', 'registeredEnrollment', 'instructors', 'teachingDay', 'teachingTime', 'teachingRoom'];

function xlsx(name: string, dir: string) {
  return join(dir, name);
}

/** Build a flat course workbook: one term line, one header row, then data rows. */
function courseWorkbook(rows: Row[]): XLSX.WorkBook {
  const data = rows.map(r => [
    r.numericCode ? Number(r.code) : r.code,
    r.name,
    r.section,
    r.groups.join(';'),
    r.midterm ? r.midterm.split(' ')[0] : '',
    r.midterm ? r.midterm.split(' ')[1] : '',
    r.final ? r.final.split(' ')[0] : '',
    r.final ? r.final.split(' ')[1] : '',
    r.planned ?? '',
    r.registered ?? '',
    'อ.สมัครเรียน',
    '',
    '',
    '',
  ]);
  const aoa = [['ภาคการศึกษาที่ 1/2569'], HEADERS, ...data];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  // Day-name rows are left empty; the flat headers define the layout.
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'รายวิชา');
  return wb;
}

function writeXlsx(wb: XLSX.WorkBook, path: string) {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  writeFileSync(path, out);
}

function writeCsv(path: string, rows: (string | number)[][]) {
  const text = rows.map(r => r.map(cell => {
    const s = String(cell ?? '');
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n') + '\r\n';
  writeFileSync(path, Buffer.from(text, 'utf8'));
}

const RULES_HEADER = ['ไม่มีสอบกลางภาค', 'ไม่มีสอบปลายภาค', 'ไม่มีสอบ', 'สอบสองช่วง', 'สอบตรงกัน'];

// ---------------------------------------------------------------------------
// Clean fixture: 12 managed courses (anchors A–H + 4 fillers) + 2 context courses.
// ---------------------------------------------------------------------------
const managedRows: Row[] = [
  // A — editable managed exam, DEMO-A: used for the successful move (E01) and re-edit (E07).
  { code: '061000001', name: 'การจัดการอุตสาหกรรมขั้นแนะนำ', section: 1, groups: ['DEMO-A'], planned: 60, registered: 58 },
  // B — shares DEMO-A with A: a reproducible student-conflict when A is moved onto B (E02).
  { code: '061000002', name: 'การจัดการคุณภาพเบื้องต้น', section: 1, groups: ['DEMO-A'], planned: 55, registered: 54 },
  // C + D — distinct groups linked by the same-time rule; atomic move (E03).
  { code: '061000003', name: 'ระบบฐานข้อมูลเบื้องต้น', section: 1, groups: ['DEMO-C'], planned: 70, registered: 70 },
  { code: '061000004', name: 'การวิเคราะห์และออกแบบระบบ', section: 1, groups: ['DEMO-D'], planned: 65, registered: 63 },
  // E — full-day requirement through the สอบสองช่วง rule (E04).
  { code: '061000005', name: 'การบริหารโครงการก่อสร้าง', section: 1, groups: ['DEMO-E'], planned: 40, registered: 39 },
  // F — managed course with an imported timing: fixed despite the managed role (E05).
  { code: '061000006', name: 'การจัดการโลจิสติกส์เบื้องต้น', section: 1, groups: ['DEMO-F'], midterm: '2026-08-18 09:00-12:00', planned: 80, registered: 78 },
  // G — three sections / three groups: source-row tracing and group membership (E05/G).
  { code: '061000007', name: 'ความปลอดภัยในงานก่อสร้าง', section: 1, groups: ['DEMO-GA'], planned: 45, registered: 44 },
  { code: '061000007', name: 'ความปลอดภัยในงานก่อสร้าง', section: 2, groups: ['DEMO-GB'], planned: 45, registered: 43 },
  { code: '061000007', name: 'ความปลอดภัยในงานก่อสร้าง', section: 3, groups: ['DEMO-GC'], planned: 45, registered: 45 },
  // H — excluded from central midterm generation by the rule file; final still runs (anchor H).
  { code: '061000008', name: 'ภาษาอังกฤษเทคนิคอุตสาหกรรม', section: 1, groups: ['DEMO-H'], planned: 50, registered: 49 },
  // Fillers (061000009-061000012) give the fixture volume; 009 also demos a no-final rule.
  { code: '061000009', name: 'การบัญชีต้นทุน', section: 1, groups: ['DEMO-I'], planned: 62, registered: 60 },
  { code: '061000010', name: 'การตลาดและการจัดการลูกค้า', section: 1, groups: ['DEMO-J1'], planned: 58, registered: 57 },
  { code: '061000010', name: 'การตลาดและการจัดการลูกค้า', section: 2, groups: ['DEMO-J2'], planned: 58, registered: 55 },
  { code: '061000011', name: 'การวิจัยดำเนินงาน', section: 1, groups: ['DEMO-K'], planned: 48, registered: 47 },
  { code: '061000012', name: 'การจัดการซัพพลายเชน', section: 1, groups: ['DEMO-L1'], planned: 72, registered: 70 },
  { code: '061000012', name: 'การจัดการซัพพลายเชน', section: 2, groups: ['DEMO-L2'], planned: 72, registered: 71 },
];

const contextRows: Row[] = [
  // Context anchors: fixed imported timings, including a reserved slot that shares DEMO-A
  // (midterm Monday 13:00–16:00) for conflict examples (E02, E12).
  { code: '069000001', name: 'คณิตศาสตร์วิศวกรรม 1', section: 1, groups: ['DEMO-F'], final: '2026-10-15 09:00-12:00', planned: 120, registered: 118 },
  { code: '069000002', name: 'ฟิสิกส์วิศวกรรม 1', section: 1, groups: ['DEMO-A'], midterm: '2026-08-17 13:00-16:00', planned: 130, registered: 127 },
];

const cleanRules: (string | number)[][] = [
  RULES_HEADER,
  // H: no central midterm exam.
  ['061000008', '', '', '', ''],
  // Filler 061000009: no final exam.
  ['', '061000009', '', '', ''],
  // E: full-day exam.
  ['', '', '', '061000005', ''],
  // C + D: same-time pair — codes occupy separate cells in the สอบตรงกัน column.
  ['', '', '', '', '061000003', '061000004'],
];

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------
function withCode(rows: Row[], code: string, mutate: (r: Row) => void): Row[] {
  return rows.map(r => r.code === code ? { ...r, ...mutate(r) } : r);
}

// bad-code: A's code cell is a number, so the leading zero is lost (61000001).
const badCodeRows = managedRows.map(r => r.code === '061000001' ? { ...r, code: '61000001', numericCode: true } : r);
// missing-group: filler 061000011 leaves the student-groups column empty.
const missingGroupRows = managedRows.map(r => r.code === '061000011' ? { ...r, groups: [] } : r);

// tight-calendar: adds one managed course whose every midterm slot is occupied by
// context full-day exams; the recovery widens the period and allows weekends.
const tightManagedRows = [
  ...managedRows,
  { code: '061000021', name: 'การวิเคราะห์ข้อมูลเชิงธุรกิจ', section: 1, groups: ['DEMO-T'], planned: 40, registered: 38 },
];
const tightContextRows = [
  ...contextRows,
  { code: '069000003', name: 'ฟิสิกส์ 2', section: 1, groups: ['DEMO-T'], midterm: '2026-08-17 09:00-16:00' },
  { code: '069000004', name: 'สถิติวิศวกรรม', section: 1, groups: ['DEMO-T'], midterm: '2026-08-18 09:00-16:00' },
  { code: '069000005', name: 'เทอร์โมไดนามิกส์', section: 1, groups: ['DEMO-T'], midterm: '2026-08-19 09:00-16:00' },
  { code: '069000006', name: 'กลศาสตร์ของไหล', section: 1, groups: ['DEMO-T'], midterm: '2026-08-20 09:00-16:00' },
  { code: '069000007', name: 'วัสดุวิศวกรรม', section: 1, groups: ['DEMO-T'], midterm: '2026-08-21 09:00-16:00' },
];

const staleRules: (string | number)[][] = [
  RULES_HEADER,
  ['061000008', '', '', '', ''],
  ['', '061000009', '060999999', '', ''],
  ['', '', '', '061000005', ''],
  ['', '', '', '', '061000003', '061000004'],
];
const staleRulesFixed: (string | number)[][] = staleRules.map((row, i) => i === 2 ? ['', '061000009', '', '', ''] : row);

// ---------------------------------------------------------------------------
// Write every file
// ---------------------------------------------------------------------------
const files: Record<string,string> = {};
function emit(rel: string, write: () => void) {
  const path = join(outDir, rel);
  write();
  files[rel] = path;
}

emit('clean/managed.xlsx', () => writeXlsx(courseWorkbook(managedRows), xlsx('managed.xlsx', clean)));
emit('clean/context.xlsx', () => writeXlsx(courseWorkbook(contextRows), xlsx('context.xlsx', clean)));
emit('clean/rules.csv', () => writeCsv(xlsx('rules.csv', clean), cleanRules));
// courses-flat: the flat CSV used for the format-reference exercise (UTF-8, Thai dates).
emit('courses-flat.csv', () => writeCsv(join(outDir, 'courses-flat.csv'), [
  HEADERS,
  ['061000101', 'การวิเคราะห์เชิงตัวเลข', 1, 'DEMO-M1;DEMO-M2', '17/08/69', '09.00-12.00', '', '', 90, 88, '"อ.สมัครเรียน"', 'จันทร์', '09:00-12:00', 'LAB-101'],
  ['061000102', 'การเขียนโปรแกรมคอมพิวเตอร์', 1, 'DEMO-M2', '2026-08-18', '13:00-16:00', '15/10/69', '13.00-16.00', 75, 72, '"อ.ขวัญใจ"', 'อังคาร', '13:00-15:00', 'LAB-102'],
  ['061000103', 'การออกแบบผลิตภัณฑ์', 1, 'DEMO-M3\r\nDEMO-M4', '', '', '', '', 60, 58, '"อ.สุชาติ"', 'พุธ', '09:00-12:00', 'STU-8'],
]));

emit('bad-code/managed.xlsx', () => writeXlsx(courseWorkbook(badCodeRows), xlsx('managed.xlsx', badCode)));
emit('bad-code/managed.fixed.xlsx', () => writeXlsx(courseWorkbook(managedRows), xlsx('managed.fixed.xlsx', badCode)));
emit('bad-code/context.xlsx', () => writeXlsx(courseWorkbook(contextRows), xlsx('context.xlsx', badCode)));
emit('bad-code/rules.csv', () => writeCsv(join(badCode, 'rules.csv'), cleanRules));

emit('missing-group/managed.xlsx', () => writeXlsx(courseWorkbook(missingGroupRows), xlsx('managed.xlsx', missingGroup)));
emit('missing-group/managed.fixed.xlsx', () => writeXlsx(courseWorkbook(managedRows), xlsx('managed.fixed.xlsx', missingGroup)));
emit('missing-group/context.xlsx', () => writeXlsx(courseWorkbook(contextRows), xlsx('context.xlsx', missingGroup)));
emit('missing-group/rules.csv', () => writeCsv(join(missingGroup, 'rules.csv'), cleanRules));

emit('stale-rule/rules.csv', () => writeCsv(join(staleRule, 'rules.csv'), staleRules));
emit('stale-rule/rules.fixed.csv', () => writeCsv(join(staleRule, 'rules.fixed.csv'), staleRulesFixed));
emit('stale-rule/managed.xlsx', () => writeXlsx(courseWorkbook(managedRows), xlsx('managed.xlsx', staleRule)));
emit('stale-rule/context.xlsx', () => writeXlsx(courseWorkbook(contextRows), xlsx('context.xlsx', staleRule)));

emit('tight-calendar/managed.xlsx', () => writeXlsx(courseWorkbook(tightManagedRows), xlsx('managed.xlsx', tight)));
emit('tight-calendar/context.xlsx', () => writeXlsx(courseWorkbook(tightContextRows), xlsx('context.xlsx', tight)));
emit('tight-calendar/rules.csv', () => writeCsv(join(tight, 'rules.csv'), cleanRules));

// Hash manifest for reproducibility.
const hashes: Record<string, string> = {};
for (const [rel, path] of Object.entries(files)) {
  hashes[rel] = createHash('sha256').update(readFileSync(path)).digest('hex');
}
writeFileSync(join(outDir, 'fixture-hashes.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log(`Wrote ${Object.keys(files).length} files under ${outDir}`);