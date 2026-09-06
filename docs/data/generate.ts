// Synthetic-data generator for the report's executable specification fixtures.
// Emits everything under docs/data: the clean pedagogical dataset, the import-valid
// error mutations, the blocking import-failure mutations, and the medium/large
// benchmark fixtures. Deterministic: a seeded LCG (same pattern as the in-repo harness
// scripts/benchmark-scheduler.ts) drives every "random" choice, and the output is a
// pure function of this file. Run with plain node (>=22.18 native type stripping):
//
//   node docs/data/generate.ts
//
// Course-table layout, Buddhist-Era date helpers and rules/room CSV shapes are copied
// from the precedents in scripts/make-example-fixtures.ts (never imported) so every
// file is in the application's real import format. Nothing under tests/ is touched.
// Room sources deliberately omit the จำนวนคน column: staffing counts are outside the
// scope documented by this report, and omitting the column keeps that entire issue
// family out of the generated runs (PROCTOR_DEMAND_UNKNOWN caveats are documented in
// the report text instead).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const outRoot = resolve(import.meta.dirname, '.');

// ---------------------------------------------------------------------------
// Deterministic primitives
// ---------------------------------------------------------------------------
// Mulberry-style LCG, same shape as scripts/benchmark-scheduler.ts's scale() PRNG.
function makeRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SESSIONS = ['09:00-12:00', '13:00-16:00'] as const;
const FULL_DAY_TIME = '09:00-16:00';
// Exam windows mirror the real registrar manifest (tests/fixtures/manifest.json).
const MT_DATES = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'];
const FT_DATES = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
const HOLIDAYS = ['2026-08-20']; // Thursday inside the midterm window, adjacent to usable weekdays.
const be = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${String(Number(y) + 543).slice(2)}`;
};
type Slot = { date: string; time: string };
const slotsOf = (dates: string[]): Slot[] => dates.flatMap(date => SESSIONS.map(time => ({ date, time })));

// ---------------------------------------------------------------------------
// Course workbook emission (22-column Thai registrar layout)
// ---------------------------------------------------------------------------
const WIDTH = 22;
const HEADER = ['  รหัสวิชา', '', '', 'ชื่อวิชา', 'หน่วยกิต', '', '', '', 'ตอน', 'จำนวน นศ.', '', 'วัน', 'เวลาเรียน', 'สถานที่', 'อาจารย์ผู้สอน', 'กลุ่มนักศึกษา', 'สอบกลางภาค', '', 'สอบปลายภาค', '', '', ''];
const SUBHEADER = ['', '', '', '', 'รวม', 'ท.', 'ป.', 'ศ.', '', 'เปิด', 'ลง', '', '', '', '', '', 'วัน', 'เวลา', 'วัน', 'เวลา', '', ''];
const blank = (n: number): string[] => Array<string>(n).fill('');

interface SectionSpec { section: string; groups: string[]; planned: number }
interface CourseSpec {
  code: string; name: string; sections: SectionSpec[];
  /** Imported midterm/final timings; courses without them are scheduled centrally. */
  midterm?: Slot; final?: Slot;
  /** Teaching-room string; computer-lab names match the computer rooms in roominfo. */
  room?: string;
}

/** Flat-schema rows for one course: code/name only on the first section row. */
function courseRows(course: CourseSpec, ordinal: number): string[][] {
  const teachers = [INSTRUCTORS[ordinal % INSTRUCTORS.length], ...(ordinal % 5 === 0 ? [INSTRUCTORS[(ordinal + 7) % INSTRUCTORS.length]] : [])];
  return course.sections.map((sec, i) => {
    const row = blank(WIDTH);
    if (i === 0) { row[0] = course.code; row[3] = course.name; }
    row[4] = '3'; row[5] = '3'; row[6] = '0'; row[7] = '6';
    row[8] = sec.section; row[9] = String(sec.planned); row[10] = '';
    row[11] = LANGS[ordinal % 3]; row[12] = SESSIONS[ordinal % 2];
    row[13] = course.room ?? `1-B${1 + (ordinal % 3)}-${10 + (ordinal % 9)}`;
    row[14] = teachers.join('\n'); row[15] = sec.groups.join('\n');
    if (course.midterm) { row[16] = be(course.midterm.date); row[17] = course.midterm.time; }
    if (course.final) { row[18] = be(course.final.date); row[19] = course.final.time; }
    return row;
  });
}

const INSTRUCTORS = ['อ.ดร.วรากร ศรีสุวรรณ', 'ผศ.ดร.พรทิพย์ จันทร์เพ็ญ', 'อ.ธนากร บุญเรือง', 'ผศ.กัญญา แสงสุริยา', 'รศ.ดร.เกริกไกร วัฒนกุล', 'อ.สถาพร โพธิ์ทอง', 'อ.ดร.ณัชชา นิลรัตน์', 'ผศ.ดร.ปุณณวิช พงษ์ไพบูลย์', 'อ.มาลินี ทองอินทร์', 'อ.ภาสกร ชูเกียรติ', 'ผศ.อติวิชญ์ สุขเกษม', 'อ.ดร.ธัญญ์รภัสร์ ฤทัยวัฒนา'];
const LANGS = ['TH', 'F', 'S'];

function workbookRows(faculty: string, dept: string, courses: CourseSpec[], firstOrdinal: number): string[][] {
  const rows: string[][] = [];
  const masthead = blank(WIDTH);
  masthead[2] = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ'; masthead[13] = 'รายงานระเบียนขบวนวิชา';
  const system = blank(WIDTH);
  system[2] = 'ระบบตารางสอนตารางสอบ'; system[13] = 'มจพ. วิทยาเขตปราจีนบุรี ภาคการศึกษาที่ 1/2569';
  rows.push(masthead, system, blank(WIDTH), blank(WIDTH), blank(WIDTH), blank(WIDTH));
  const heading = blank(WIDTH);
  heading[0] = faculty; heading[13] = dept;
  rows.push(heading, blank(WIDTH), HEADER, SUBHEADER);
  courses.forEach((course, i) => {
    for (const row of courseRows(course, firstOrdinal + i)) rows.push(row);
    rows.push(blank(WIDTH));
  });
  const footer = blank(WIDTH);
  footer[0] = 'ตารางสอน-สอบปัจจุบัน (REG-R40-01-22)'; footer[13] = '01/06/2026 09:00'; footer[19] = 'Page'; footer[20] = '1/1';
  rows.push(footer);
  return rows;
}

function writeWorkbook(dir: string, name: string, faculty: string, dept: string, courses: CourseSpec[], firstOrdinal: number): void {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(workbookRows(faculty, dept, courses, firstOrdinal)), 'Sheet');
  // The ESM xlsx build cannot write to paths directly; emit a buffer instead.
  writeFileSync(resolve(dir, name), XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

// ---------------------------------------------------------------------------
// Rules and room CSV emission
// ---------------------------------------------------------------------------
// Column order mirrors the registrar file: exclusion/ไม่มีสอบ columns first, the
// สองช่วง (full-day) column, then ให้มีวัน เวลา สอบ ตรงกัน (same-time) last.
const RULES_HEADER = ['ไม่มีสอบกลางภาค/สอบนอกตาราง', 'ไม่มีสอบปลายภาค', 'ไม่มีสอบ', 'วิชาเดียวแต่สอบสองช่วง  (กำหนดให้เป็น 9.00-16.00 น.)', 'ให้มีวัน เวลา สอบ ตรงกัน', '', '', '', '', '', ''];

interface RuleRow { excludeMidterm?: string[]; noFinal?: string[]; noExam?: string[]; fullDay?: string[]; sameTime?: string[] }

function writeRules(dir: string, rows: RuleRow[]): void {
  const lines = [RULES_HEADER.join(',')];
  for (const row of rows) {
    const cells = blank(11);
    (row.excludeMidterm ?? []).forEach((code, i) => cells[i] = code);
    (row.noFinal ?? []).forEach((code, i) => cells[1 + i] = code);
    (row.noExam ?? []).forEach((code, i) => cells[2 + i] = code);
    (row.fullDay ?? []).forEach((code, i) => cells[3 + i] = code);
    (row.sameTime ?? []).forEach((code, i) => cells[4 + i] = code);
    lines.push(cells.join(','));
  }
  writeFileSync(resolve(dir, 'rules.csv'), '\uFEFF' + lines.join('\n') + '\n');
}

/** Room source: ห้อง / แถว (zones) / คอม (computer) columns only. */
function writeRooms(dir: string, rooms: { name: string; zones?: string; computer?: boolean }[]): void {
  const lines = [['ห้อง', 'แถว', 'คอม'].join(',')];
  for (const room of rooms) lines.push([room.name, room.zones ?? '', room.computer ? 'ใช่' : ''].join(','));
  writeFileSync(resolve(dir, 'roominfo.csv'), '\uFEFF' + lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Manifest emission
// ---------------------------------------------------------------------------
interface ManifestOptions { managed: string; context: string; prefix: string; referencePrefix?: string }
function writeManifest(dir: string, options: ManifestOptions): void {
  const manifest = {
    courseSources: [
      { path: options.managed, role: 'managed', expectedPrefix: options.prefix },
      { path: options.context, role: 'context', expectedPrefix: options.referencePrefix },
    ],
    rules: 'rules.csv',
    references: [{ path: 'roominfo.csv', kind: 'rooms' }],
    settings: {
      periods: { midterm: { start: '2026-08-17', end: '2026-08-28' }, final: { start: '2026-10-14', end: '2026-10-30' } },
      sessions: [{ startMinutes: 540, endMinutes: 720 }, { startMinutes: 780, endMinutes: 960 }],
      fullDay: { startMinutes: 540, endMinutes: 960 },
      weekendPolicy: 'only_if_necessary',
      holidays: HOLIDAYS,
      holidayPolicy: 'only_if_necessary',
      searchBudget: 20000,
    },
  };
  writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// The clean pedagogical dataset (~40 managed + 10 context courses)
// ---------------------------------------------------------------------------
// Cohorts (invented program codes, registrar naming style):
//   Gp*: the four cohorts whose calendars are deliberately saturated below;
//   Sx*: the must-coincide same-time pair (one cohort each, disjoint by construction);
//   Sh*: the shared-group pair that must never overlap;
//   Cmp: the computer-lab cohort; Fb*: filler cohorts; Pd*: pre-dated managed courses.
const GP = ['IAM-2R-DE-RA', 'ITS-2R-DE-RA', 'CNS-2R-DE-RA', 'LOG-2R-DE-RA'];
const FITM = 'คณะเทคโนโลยีและการจัดการอุตสาหกรรม';
const MANAGED_DEPT = 'ภาควิชาเทคโนโลยีสารสนเทศ';
const CONTEXT_FACULTY = 'คณะวิทยาศาสตร์ประยุกต์';
const CONTEXT_DEPT = 'ภาควิชาคณิตศาสตร์';

// Midterm weekday pressure design (window 17-28 Aug 2026, holiday 20 Aug, Sat 22 / Sun 23):
//   9 usable weekdays = 18 session slots per cohort; the six pre-dated context courses
//   consume 6 of them for every Gp cohort, leaving 12 free weekday slots. The Gp cohort's
//   managed demand is 15 exams + 1 full-day (= 2 slots) = 17 units, so any complete
//   placement needs 17 - 12 = 5 slots on avoided days (holiday + Saturday + Sunday),
//   which forces weekend use: the anchor the solver cannot avoid. All other cohorts stay
//   well below their weekday capacity, so their weekends remain unused (avoidable anchor).
const GCTX_SLOTS = [
  { date: '2026-08-17', time: '09:00-12:00' }, { date: '2026-08-18', time: '09:00-12:00' },
  { date: '2026-08-19', time: '09:00-12:00' }, { date: '2026-08-21', time: '09:00-12:00' },
  { date: '2026-08-24', time: '09:00-12:00' }, { date: '2026-08-25', time: '09:00-12:00' },
];
const GCTX_FINAL_SLOTS = [
  { date: '2026-10-14', time: '09:00-12:00' }, { date: '2026-10-15', time: '09:00-12:00' },
  { date: '2026-10-16', time: '09:00-12:00' }, { date: '2026-10-19', time: '09:00-12:00' },
  { date: '2026-10-20', time: '09:00-12:00' }, { date: '2026-10-21', time: '09:00-12:00' },
];
const G_TOPICS = ['Industrial Management Seminar', 'Operations Research I', 'Quality Control Systems', 'Supply Chain Fundamentals', 'Database Design', 'Business Analytics', 'Production Planning', 'Project Management', 'Financial Accounting', 'Marketing Principles', 'Human Resource Management', 'Business Law Essentials', 'Information Systems Strategy', 'Operations Simulation', 'Research Methodology in Industry'];
const COMPUTERS_TOPICS = ['Java Programming Laboratory', 'Data Structures Laboratory', 'Computer Networks Laboratory', 'Web Development Laboratory', 'Systems Administration Laboratory', 'Database Systems Laboratory'];

const planned = (seed: number): number => 25 + (seed * 37) % 115;

/** Clean managed roster: 40 courses, anchored by construction (see comments above). */
function cleanManaged(): CourseSpec[] {
  const courses: CourseSpec[] = [];
  let codeIndex = 0;
  const code = (): string => `0603${String(21001 + codeIndex++ * 7)}`;
  // 1. The sixteen G-cluster courses: all four cohorts, demand 15 + one full day.
  for (let i = 0; i < 15; i++) courses.push({ code: code(), name: G_TOPICS[i], sections: [{ section: '1', groups: [...GP], planned: planned(2101 + i) }] });
  courses.push({ code: code(), name: 'Industrial Project Exhibition', sections: [{ section: '1', groups: [...GP], planned: planned(2116) }] });
  // 2. The must-coincide same-time pair: disjoint cohorts, never sharing groups.
  const pairA = code(), pairB = code();
  courses.push({ code: pairA, name: 'Applied Statistics for Engineers', sections: [{ section: '1', groups: ['IAM-1R-DE-RA'], planned: planned(2201) }] });
  courses.push({ code: pairB, name: 'Engineering Mathematics I', sections: [{ section: '1', groups: ['ITS-1R-DE-RA'], planned: planned(2202) }] });
  // 3. The shared-group pair that must not overlap.
  const pairC = code(), pairD = code();
  courses.push({ code: pairC, name: 'Logistics Systems Analysis', sections: [{ section: '1', groups: ['LOG-3R-DE-RA'], planned: planned(2301) }] });
  courses.push({ code: pairD, name: 'Transportation Economics', sections: [{ section: '1', groups: ['LOG-3R-DE-RA'], planned: planned(2302) }] });
  // 4. Computer-lab cohort courses (scarce computer rooms; they never share cohorts with others).
  // Teaching rooms cycle over the three computer rooms that roominfo actually declares.
  for (let i = 0; i < COMPUTERS_TOPICS.length; i++) courses.push({ code: code(), name: COMPUTERS_TOPICS[i], room: ['C1-101', 'C1-102', 'C1-201'][i % 3], sections: [{ section: '1', groups: ['ITS-3R-DE-RA'], planned: 30 + (i * 7) % 30 }] });
  // 5. The large multi-section course (six sections; one scheduling unit, high weight).
  const big = code();
  courses.push({ code: big, name: 'Fundamentals of Digital Innovation', sections: [1, 2, 3, 4, 5, 6].map(n => ({ section: String(n), groups: [`AGE-${n}R-DE-RA`], planned: 55 + n * 3 })) });
  // 6. Two pre-dated managed courses (imported timings become fixed units).
  courses.push({ code: code(), name: 'Agricultural Machinery Design', sections: [{ section: '1', groups: ['AGE-1R-DE-RA'], planned: planned(2501) }], midterm: { date: '2026-08-18', time: '13:00-16:00' }, final: { date: '2026-10-15', time: '09:00-12:00' } });
  courses.push({ code: code(), name: 'Soil and Water Engineering', sections: [{ section: '1', groups: ['AGE-2R-DE-RA'], planned: planned(2502) }], midterm: { date: '2026-08-26', time: '09:00-12:00' }, final: { date: '2026-10-22', time: '13:00-16:00' } });
  // 7. Seeded filler around the anchors so the schedule looks like a real faculty.
  const FILLER_COHORTS = ['IAM-1R-DE-RB', 'IAM-3R-DE-RA', 'CNS-1R-DE-RA', 'CNS-3R-DE-RB', 'AGE-3R-DE-RA', 'AGE-4R-DE-RA', 'LOG-1R-DE-RB', 'LOG-4R-DE-RA'];
  const FILLER_TOPICS = ['Technical Writing', 'Engineering Economics', 'Applied Probability', 'Materials Engineering', 'Instrumentation Basics', 'Safety Management', 'Digital Marketing', 'Entrepreneurship Foundations', 'Quality Auditing', 'Process Improvement', 'Innovation Tools', 'Technical Presentations'];
  const random = makeRandom(20260905);
  for (let i = 0; i < FILLER_TOPICS.length; i++) {
    const groups = random() < 0.35 && i + 1 < FILLER_TOPICS.length
      ? [FILLER_COHORTS[i % FILLER_COHORTS.length], FILLER_COHORTS[(i + 1) % FILLER_COHORTS.length]]
      : [FILLER_COHORTS[i % FILLER_COHORTS.length]];
    const doubled = random() < 0.25;
    courses.push(doubled
      ? { code: code(), name: FILLER_TOPICS[i], sections: [{ section: '1', groups, planned: planned(2601 + i) }, { section: '2', groups: [FILLER_COHORTS[(i + 2) % FILLER_COHORTS.length]], planned: planned(2602 + i) }] }
      : { code: code(), name: FILLER_TOPICS[i], sections: [{ section: '1', groups, planned: planned(2601 + i) }] });
  }
  return courses;
}

/** Clean context roster: 6 G-cluster service courses + 4 general service courses. */
function cleanContext(): CourseSpec[] {
  const courses: CourseSpec[] = [];
  const serviceNames = ['Calculus for Technology', 'Foundation Physics', 'Applied Statistics I', 'Technical English I', 'Academic Writing', 'Communication Skills'];
  serviceNames.forEach((name, i) => courses.push({
    code: `0402${String(20101 + i * 7)}`, name,
    sections: [{ section: '1', groups: [...GP], planned: planned(3001 + i) }],
    midterm: GCTX_SLOTS[i], final: GCTX_FINAL_SLOTS[i],
  }));
  const general = [['Physics Laboratory I', 'CNS-1R-DE-RA', '2026-08-19', '2026-10-16'], ['Physics Laboratory II', 'CNS-3R-DE-RB', '2026-08-21', '2026-10-19'], ['English for Workplace', 'IAM-1R-DE-RB', '2026-08-24', '2026-10-20'], ['Basic Japanese', 'LOG-1R-DE-RB', '2026-08-27', '2026-10-23']] as const;
  general.forEach(([name, group, mt, ft], i) => courses.push({
    code: `0402${String(20201 + i * 7)}`, name,
    sections: [{ section: '1', groups: [group], planned: planned(3101 + i) }],
    midterm: { date: mt, time: SESSIONS[i % 2] }, final: { date: ft, time: SESSIONS[(i + 1) % 2] },
  }));
  return courses;
}

function cleanRules(managed: CourseSpec[]): RuleRow[] {
  const byName = (name: string): string => managed.find(c => c.name === name)!.code;
  return [
    { fullDay: [byName('Industrial Project Exhibition')] },
    { sameTime: [byName('Applied Statistics for Engineers'), byName('Engineering Mathematics I')] },
  ];
}

// The clean room set: three scarce computer rooms among fifteen ordinary rooms.
function cleanRooms(): { name: string; zones?: string; computer?: boolean }[] {
  return [
    { name: 'หอประชุมดอกรัก', zones: 'ก ข ค ง' },
    { name: 'B1-101', zones: 'A B C' }, { name: 'B1-102', zones: 'D E F' }, { name: 'B1-201', zones: 'A B C' }, { name: 'B1-202' },
    { name: 'B2-101' }, { name: 'B2-102' }, { name: 'B2-201' }, { name: 'B2-202' },
    { name: 'B3-101' }, { name: 'B3-201' }, { name: 'B4-101' }, { name: 'B4-201' },
    { name: 'C1-101', computer: true }, { name: 'C1-102', computer: true }, { name: 'C1-201', computer: true },
  ];
}

function generateClean(): CourseSpec[] {
  const dir = resolve(outRoot, 'clean');
  mkdirSync(dir, { recursive: true });
  const managed = cleanManaged();
  writeWorkbook(dir, 'managed.xlsx', FITM, MANAGED_DEPT, managed, 1);
  writeWorkbook(dir, 'context.xlsx', CONTEXT_FACULTY, CONTEXT_DEPT, cleanContext(), 31);
  writeRules(dir, cleanRules(managed));
  writeRooms(dir, cleanRooms());
  writeManifest(dir, { managed: 'managed.xlsx', context: 'context.xlsx', prefix: '0603', referencePrefix: '0402' });
  // Invariants the generator promises; a violation means the anchor design is broken.
  const sameTimePair = cleanRules(managed).find(r => r.sameTime)!.sameTime!;
  const groupsOf = (code: string): string[] => managed.find(c => c.code === code)!.sections.flatMap(s => s.groups);
  const shared = groupsOf(sameTimePair[0]).filter(g => groupsOf(sameTimePair[1]).includes(g));
  if (shared.length) throw new Error(`same-time pair must not share student groups (shared: ${shared.join(',')})`);
  return managed;
}

// ---------------------------------------------------------------------------
// Error scenarios (import-valid mutations of the clean dataset)
// ---------------------------------------------------------------------------
function scenarioFiles(scenario: string, managed: CourseSpec[], mutate: { managed?: (courses: CourseSpec[]) => CourseSpec[]; rules?: (rows: RuleRow[]) => RuleRow[] }): void {
  const dir = resolve(outRoot, 'errors', scenario);
  mkdirSync(dir, { recursive: true });
  const mutatedManaged = mutate.managed?.(structuredClone(managed)) ?? structuredClone(managed);
  const mutatedRules = mutate.rules?.(cleanRules(structuredClone(managed))) ?? cleanRules(mutatedManaged);
  writeWorkbook(dir, 'managed.xlsx', FITM, MANAGED_DEPT, mutatedManaged, 1);
  writeWorkbook(dir, 'context.xlsx', CONTEXT_FACULTY, CONTEXT_DEPT, cleanContext(), 31);
  writeRules(dir, mutatedRules);
  writeRooms(dir, cleanRooms());
  writeManifest(dir, { managed: 'managed.xlsx', context: 'context.xlsx', prefix: '0603', referencePrefix: '0402' });
}

function generateErrors(managed: CourseSpec[]): void {
  // stale-rule: an exclusion row referencing a course absent from the managed source.
  scenarioFiles('stale-rule', managed, { rules: rows => [...rows, { excludeMidterm: ['099999999'] }] });
  // same-time-contradiction: the must-coincide pair now shares one student group, so the
  // courses import cleanly and the contradiction only surfaces as solver diagnostics.
  scenarioFiles('same-time-contradiction', managed, {
    managed: courses => {
      const pair = courses.find(c => c.name === 'Engineering Mathematics I')!;
      pair.sections[0].groups = [courses.find(c => c.name === 'Applied Statistics for Engineers')!.sections[0].groups[0]];
      return courses;
    },
  });
  // combined: both of the above plus a repeated same-time row (info-level duplicate).
  scenarioFiles('combined', managed, {
    managed: courses => {
      const pair = courses.find(c => c.name === 'Engineering Mathematics I')!;
      pair.sections[0].groups = [courses.find(c => c.name === 'Applied Statistics for Engineers')!.sections[0].groups[0]];
      return courses;
    },
    rules: rows => {
      const sameTime = rows.find(r => r.sameTime)!.sameTime!;
      return [...rows, { excludeMidterm: ['099999999'] }, { sameTime: [...sameTime] }];
    },
  });
}

// ---------------------------------------------------------------------------
// Import-failure scenarios (blocking mutations; verified --inspect exit 2)
// ---------------------------------------------------------------------------
function importFailureFiles(scenario: string, managed: CourseSpec[], mutate: {
  managed?: (courses: CourseSpec[], original: CourseSpec[]) => CourseSpec[];
  rooms?: (rooms: { name: string; zones?: string; computer?: boolean }[]) => { name: string; zones?: string; computer?: boolean }[];
}): void {
  const dir = resolve(outRoot, 'import-failures', scenario);
  mkdirSync(dir, { recursive: true });
  const managedClone = structuredClone(managed);
  const mutatedManaged = mutate.managed?.(managedClone, managed) ?? managedClone;
  writeWorkbook(dir, 'managed.xlsx', FITM, MANAGED_DEPT, mutatedManaged, 1);
  writeWorkbook(dir, 'context.xlsx', CONTEXT_FACULTY, CONTEXT_DEPT, cleanContext(), 31);
  writeRules(dir, cleanRules(mutatedManaged));
  writeRooms(dir, mutate.rooms?.(cleanRooms()) ?? cleanRooms());
  writeManifest(dir, { managed: 'managed.xlsx', context: 'context.xlsx', prefix: '0603', referencePrefix: '0402' });
}

function generateImportFailures(managed: CourseSpec[]): void {
  // malformed-course-code: a filler row whose code is not nine digits.
  importFailureFiles('malformed-course-code', managed, {
    managed: courses => {
      const filler = courses.find(c => c.name === 'Technical Writing')!;
      filler.code = '0603-1101';
      return courses;
    },
  });
  // missing-student-groups: a filler row with an empty student-group cell.
  importFailureFiles('missing-student-groups', managed, {
    managed: courses => {
      const filler = courses.find(c => c.name === 'Technical Writing')!;
      filler.sections[0].groups = [];
      return courses;
    },
  });
  // invalid-exam-timing: a filler row whose midterm time cannot be parsed.
  importFailureFiles('invalid-exam-timing', managed, {
    managed: courses => {
      const filler = courses.find(c => c.name === 'Technical Writing')!;
      filler.midterm = { date: '2026-08-19', time: '๙:00-12:00' };
      return courses;
    },
  });
  // fourth slot, preferred per the plan: a room-source rejection (duplicate room name).
  importFailureFiles('duplicate-room', managed, {
    rooms: rooms => [...rooms, { name: 'B1-101', zones: 'A B C' }],
  });
}

// ---------------------------------------------------------------------------
// Benchmark fixtures (pinned sizes)
// ---------------------------------------------------------------------------
// The large fixture is pinned from the 2026-09-05 real-fixture sizing run
// (run-records.json, sizing-real-fixtures): 189 managed courses / 238 managed rows,
// 111 context courses / 160 context rows = 300 courses / 398 section rows total.
// Medium is the half-scale point: 100 managed / 126 rows, 59 context / 85 rows.
const LARGE = { managedCourses: 189, managedDoubles: 49, contextCourses: 111, contextDoubles: 49 };
const MEDIUM = { managedCourses: 100, managedDoubles: 26, contextCourses: 59, contextDoubles: 26 };
const BENCH_COHORTS = ['IAM-1R-DE-RA', 'IAM-2R-DE-RA', 'IAM-3R-DE-RA', 'ITS-1R-DE-RA', 'ITS-2R-DE-RA', 'ITS-3R-DE-RA', 'CNS-1R-DE-RA', 'CNS-2R-DE-RA', 'CNS-3R-DE-RA', 'AGE-1R-DE-RA', 'AGE-2R-DE-RA', 'AGE-3R-DE-RA', 'LOG-1R-DE-RA', 'LOG-2R-DE-RA', 'LOG-3R-DE-RA', 'IBM-1R-DE-RA', 'IBM-2R-DE-RA', 'ISE-1R-DE-RA', 'ISE-2R-DE-RA', 'ICS-1R-DE-RA', 'SCM-1R-DE-RA', 'SCM-2R-DE-RA', 'IOM-1R-DE-RA', 'IOM-2R-DE-RA'];
const BENCH_TOPICS = ['Industrial Management', 'Operations Management', 'Quality Management', 'Supply Chain Management', 'Marketing Management', 'Financial Accounting', 'Cost Accounting', 'Business Data Analytics', 'Project Management', 'Human Resource Management', 'Production Planning', 'Business Law', 'Computer Programming', 'Data Structures', 'Database Systems', 'Computer Networks', 'Software Engineering', 'Information Security', 'Web Development', 'Mobile Application Development', 'Data Science', 'Artificial Intelligence', 'Operating Systems', 'Cloud Computing', 'Construction Materials', 'Structural Analysis', 'Construction Management', 'Building Codes and Regulations', 'Construction Site Safety', 'Building Information Modeling', 'Concrete Technology', 'Construction Estimating', 'Surveying', 'Construction Equipment', 'Building Maintenance', 'Infrastructure Design', 'Agricultural Machinery', 'Irrigation Engineering', 'Soil and Water Engineering', 'Post-Harvest Technology', 'Farm Power', 'Agricultural Structures', 'Precision Farming', 'Bio-Process Engineering', 'Renewable Energy in Agriculture', 'Agricultural Robotics', 'Food Process Engineering', 'Water Resource Management', 'Logistics Management', 'Transportation Systems', 'Warehouse Operations', 'Freight Distribution', 'Inventory Control', 'Port and Terminal Management', 'Cold Chain Logistics', 'E-Commerce Fulfillment', 'Fleet Management', 'Customs and Trade Compliance', 'Logistics Information Systems', 'Urban Delivery Systems'];

function benchmarkCourses(scale: { managedCourses: number; managedDoubles: number; contextCourses: number; contextDoubles: number }, managedPrefix: string, contextPrefix: string, seed: number): { managed: CourseSpec[]; context: CourseSpec[] } {
  const random = makeRandom(seed);
  const managed: CourseSpec[] = [];
  for (let i = 0; i < scale.managedCourses; i++) {
    const first = BENCH_COHORTS[Math.floor(random() * BENCH_COHORTS.length)];
    const groups = random() < 0.28 ? [first, BENCH_COHORTS[Math.floor(random() * BENCH_COHORTS.length)]].filter((g, index, all) => all.indexOf(g) === index) : [first];
    if (groups.length > 1 && groups[0] === groups[1]) groups.pop();
    const twoSections = i < scale.managedDoubles;
    managed.push(twoSections
      ? { code: `${managedPrefix}${String(10101 + i * 7)}`, name: BENCH_TOPICS[i % BENCH_TOPICS.length] + (i >= BENCH_TOPICS.length ? ` ${Math.floor(i / BENCH_TOPICS.length) + 1}` : ''), sections: [{ section: '1', groups, planned: planned(4001 + i) }, { section: '2', groups: [BENCH_COHORTS[(i + 5) % BENCH_COHORTS.length]], planned: planned(4101 + i) }] }
      : { code: `${managedPrefix}${String(10101 + i * 7)}`, name: BENCH_TOPICS[i % BENCH_TOPICS.length] + (i >= BENCH_TOPICS.length ? ` ${Math.floor(i / BENCH_TOPICS.length) + 1}` : ''), sections: [{ section: '1', groups, planned: planned(4001 + i) }] });
  }
  // Context courses: pre-dated into both windows without cohort clashes (greedy, seeded scan start).
  const context: CourseSpec[] = [];
  const mtSlots = slotsOf(MT_DATES), ftSlots = slotsOf(FT_DATES);
  const occupied = new Map<string, Set<string>>();
  const free = (groups: string[], key: string): boolean => groups.every(g => !occupied.get(g)?.has(key));
  const claim = (groups: string[], key: string): void => { for (const g of groups) { if (!occupied.has(g)) occupied.set(g, new Set()); occupied.get(g)!.add(key); } };
  for (let i = 0; i < scale.contextCourses; i++) {
    const groups = [BENCH_COHORTS[Math.floor(random() * BENCH_COHORTS.length)]];
    const twoSections = i < scale.contextDoubles;
    const course: CourseSpec = {
      code: `${contextPrefix}${String(20101 + i * 7)}`, name: BENCH_TOPICS[(i + 30) % BENCH_TOPICS.length] + (i + 30 >= BENCH_TOPICS.length ? ` ${Math.floor((i + 30) / BENCH_TOPICS.length) + 1}` : ''),
      sections: twoSections
        ? [{ section: '1', groups, planned: planned(5001 + i) }, { section: '2', groups: [BENCH_COHORTS[(i + 11) % BENCH_COHORTS.length]], planned: planned(5101 + i) }]
        : [{ section: '1', groups, planned: planned(5001 + i) }],
    };
    for (const [type, slots] of [['midterm', mtSlots], ['final', ftSlots]] as const) {
      const start = (i * 3) % slots.length;
      for (let k = 0; k <= slots.length; k++) {
        const slot = slots[(start + k) % slots.length];
        const key = `${type}:${slot.date}:${slot.time}`;
        const allGroups = course.sections.flatMap(s => s.groups);
        if (!free(allGroups, key)) continue;
        claim(allGroups, key);
        (course as Record<string, unknown>)[type] = slot;
        break;
      }
    }
    context.push(course);
  }
  return { managed, context };
}

function benchmarkRules(managed: CourseSpec[]): RuleRow[] {
  // Three same-time pairs on provably disjoint cohorts + two full-day courses, so the
  // benchmark still exercises unit merging without introducing contradictions.
  const rows: RuleRow[] = [];
  const usedGroups = new Set<string>();
  const eligible = managed.filter(c => {
    const groups = c.sections.flatMap(s => s.groups);
    if (groups.length !== 1 || usedGroups.has(groups[0]) || c.sections.length !== 1) return false;
    usedGroups.add(groups[0]);
    return true;
  });
  const groupsOf = (course: CourseSpec): string[] => course.sections.flatMap(s => s.groups);
  const taken = new Set<string>();
  for (let i = 0; rows.length < 3 && i < eligible.length; i++) {
    const a = eligible[i];
    const b = eligible.find(c => c !== a && !taken.has(c.code) && !groupsOf(c).some(g => groupsOf(a).includes(g)));
    if (!b) continue;
    rows.push({ sameTime: [a.code, b.code] });
    taken.add(a.code); taken.add(b.code);
  }
  for (const course of managed.filter(c => !taken.has(c.code) && c.sections.length === 1).slice(0, 2)) rows.push({ fullDay: [course.code] });
  return rows;
}

function benchmarkRooms(count: number, computers: number): { name: string; zones?: string; computer?: boolean }[] {
  const rooms: { name: string; zones?: string; computer?: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    const wing = `B${1 + Math.floor(i / 4)}`;
    rooms.push({ name: `${wing}-${101 + i % 4}${i >= count - computers ? '' : ''}`, zones: i % 3 === 0 ? 'A B C' : undefined, computer: i >= count - computers });
  }
  return rooms;
}

function generateBenchmark(name: string, scale: { managedCourses: number; managedDoubles: number; contextCourses: number; contextDoubles: number }, rooms: number, computers: number, seed: number): void {
  const dir = resolve(outRoot, 'benchmark', name);
  mkdirSync(dir, { recursive: true });
  const prefix = '0603', contextPrefix = '0402';
  const { managed, context } = benchmarkCourses(scale, prefix, contextPrefix, seed);
  writeWorkbook(dir, 'managed.xlsx', FITM, MANAGED_DEPT, managed, 1);
  writeWorkbook(dir, 'context.xlsx', CONTEXT_FACULTY, CONTEXT_DEPT, context, managed.length + 1);
  writeRules(dir, benchmarkRules(managed));
  writeRooms(dir, benchmarkRooms(rooms, computers));
  writeManifest(dir, { managed: 'managed.xlsx', context: 'context.xlsx', prefix, referencePrefix: contextPrefix });
  const managedRows = managed.reduce((n, c) => n + c.sections.length, 0);
  const contextRows = context.reduce((n, c) => n + c.sections.length, 0);
  console.log(`benchmark/${name}: ${managed.length} managed courses (${managedRows} rows), ${context.length} context courses (${contextRows} rows), ${rooms} rooms (${computers} computer)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const only = process.argv[2];
if (only === undefined || only === 'all') {
  const managed = generateClean();
  generateErrors(managed);
  generateImportFailures(managed);
  generateBenchmark('medium', MEDIUM, 16, 3, 99001);
  // Seed 5 keeps every cohort's combined managed/context midterm demand within the
  // 24 session slots in the inclusive exam period. The previous seed accidentally
  // overloaded LOG-1R-DE-RA (27 events) and ISE-2R-DE-RA (25 events), making a
  // supposedly clean large benchmark unschedulable while preserving all row counts.
  generateBenchmark('large', LARGE, 24, 4, 5);
  const count = (courses: CourseSpec[]): number => courses.reduce((n, c) => n + c.sections.length, 0);
  console.log(`clean: ${managed.length} managed courses (${count(managed)} rows), ${cleanContext().length} context courses (${count(cleanContext())} rows), ${cleanRooms().length} rooms (3 computer)`);
} else if (only === 'large') {
  // A targeted mode keeps a fixture repair from rewriting unrelated evidence.
  generateBenchmark('large', LARGE, 24, 4, 5);
} else {
  throw new Error(`Unknown generation target: ${only}; use "all" or "large"`);
}
