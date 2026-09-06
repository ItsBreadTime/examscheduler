// Regenerates the synthetic example dataset in tests/fixtures/synthetic — the files
// behind the website's "Use example files" button. Every course, group, person, room
// and roster entry is invented; the real registrar fixtures in tests/fixtures are
// never served through the app. Output is deterministic (no randomness) and sized to
// roughly match the real Testfiles volume (~190 managed courses, ~400 section rows,
// 66 proctors). The managed faculty's courses carry NO exam dates — the app's solver
// generates them at scheduling time, mirroring the real export where only the other
// faculties' context courses arrive pre-dated.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';

const outDir = resolve(import.meta.dirname, '../tests/fixtures/synthetic');
mkdirSync(outDir, { recursive: true });

// Exam windows match the demo periods wired into SourceImport.loadExample.
const MT_DAYS = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'];
const FT_DAYS = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'];
const SESSIONS = ['09:00-12:00', '13:00-16:00'];
const be = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${String(Number(y) + 543).slice(2)}`; };
const be4 = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${Number(y) + 543}`; };
type Timing = { date: string; time: string };
const slotsOf = (days: string[]): Timing[] => days.flatMap(date => SESSIONS.map(time => ({ date, time })));
const MT = slotsOf(MT_DAYS), FT = slotsOf(FT_DAYS);

interface Sec { n: string; groups: string[]; planned: number }
interface Course { code: string; name: string; secs: Sec[]; midterm?: 'auto'; final?: 'auto' }
interface Block { faculty: string; dept: string; courses: Course[] }

const s = (n: string, groups: string[], planned: number): Sec => ({ n, groups, planned });
const MODIFIERS = ['Principles of ', 'Fundamentals of ', 'Applied ', 'Advanced ', 'Introduction to ', 'Selected Topics in ', 'Seminar in ', 'Current Issues in '];
const groupOf = (program: string, year: number, half: 'RA' | 'RB') => `${program}-${year}R-DE-${half}`;
const plannedOf = (seed: number) => 25 + (seed * 37) % 115;

// Managed faculty: five departments, one or two programs each, sized like the real
// 06.xlsx (189 courses, ~238 section rows). Rules.csv shapes the generated schedule:
// exclusions, full-day courses and same-time pairs whose members never share groups.
const MANAGED_DEPTS: { prefix: string; dept: string; programs: string[]; count: number; serialBase: number; topics: string[] }[] = [
  {
    prefix: '0601', dept: 'ภาควิชาการจัดการอุตสาหกรรม', programs: ['IAM', 'IOM', 'IBM'], count: 45, serialBase: 10101,
    topics: ['Industrial Management', 'Operations Management', 'Quality Management', 'Supply Chain Management', 'Marketing Management', 'Financial Accounting', 'Cost Accounting', 'Business Data Analytics', 'Project Management', 'Human Resource Management', 'Production Planning', 'Business Law'],
  },
  {
    prefix: '0602', dept: 'ภาควิชาเทคโนโลยีสารสนเทศ', programs: ['ITS', 'ISE', 'ICS'], count: 45, serialBase: 20101,
    topics: ['Computer Programming', 'Data Structures', 'Database Systems', 'Computer Networks', 'Software Engineering', 'Information Security', 'Web Development', 'Mobile Application Development', 'Data Science', 'Artificial Intelligence', 'Operating Systems', 'Cloud Computing'],
  },
  {
    prefix: '0603', dept: 'ภาควิชาการออกแบบและบริหารงานก่อสร้าง', programs: ['CNS'], count: 30, serialBase: 30101,
    topics: ['Construction Materials', 'Structural Analysis', 'Construction Management', 'Building Codes and Regulations', 'Construction Site Safety', 'Building Information Modeling', 'Concrete Technology', 'Construction Estimating', 'Surveying', 'Construction Equipment', 'Building Maintenance', 'Infrastructure Design'],
  },
  {
    prefix: '0604', dept: 'ภาควิชาวิศวกรรมเกษตรเพื่ออุตสาหกรรม', programs: ['AGE'], count: 30, serialBase: 40101,
    topics: ['Agricultural Machinery', 'Irrigation Engineering', 'Soil and Water Engineering', 'Post-Harvest Technology', 'Farm Power', 'Agricultural Structures', 'Precision Farming', 'Bio-Process Engineering', 'Renewable Energy in Agriculture', 'Agricultural Robotics', 'Food Process Engineering', 'Water Resource Management'],
  },
  {
    prefix: '0605', dept: 'ภาควิชาวิศวกรรมโลจิสติกส์และระบบโครงข่าย', programs: ['LOG', 'SCM'], count: 39, serialBase: 50101,
    topics: ['Logistics Management', 'Transportation Systems', 'Warehouse Operations', 'Freight Distribution', 'Inventory Control', 'Port and Terminal Management', 'Cold Chain Logistics', 'E-Commerce Fulfillment', 'Fleet Management', 'Customs and Trade Compliance', 'Logistics Information Systems', 'Urban Delivery Systems'],
  },
];
const FITM = 'คณะเทคโนโลยีและการจัดการอุตสาหกรรม';
const managedBlocks: Block[] = MANAGED_DEPTS.map(dept => ({
  faculty: FITM, dept: dept.dept,
  courses: Array.from({ length: dept.count }, (_, i) => {
    const year = (i % 4) + 1, program = dept.programs[i % dept.programs.length];
    const name = (i < dept.topics.length ? '' : MODIFIERS[Math.floor(i / dept.topics.length) % MODIFIERS.length]) + dept.topics[i % dept.topics.length];
    const code = `${dept.prefix}${dept.serialBase + i * 7}`;
    const secs: Sec[] = [];
    if (i % 4 === 1) {
      secs.push(s('1', [groupOf(program, year, 'RA')], plannedOf(dept.serialBase + i)), s('2', [groupOf(program, year, 'RB')], plannedOf(dept.serialBase + i + 1)));
    } else {
      const groups = [groupOf(program, year, 'RA')];
      if (i % 9 === 0 && dept.programs.length > 1) groups.push(groupOf(dept.programs[(i + 1) % dept.programs.length], year, 'RA'));
      secs.push(s('1', groups, plannedOf(dept.serialBase + i)));
    }
    return { code, name, secs };
  }),
}));

// Context faculties keep real exam dates; the allocator below spreads them so no
// cohort sits two exams in one slot. Cohorts are the same invented programs the
// managed courses teach, plus the agricultural faculties' own cohorts.
const SERVICE_POOL = ['ITS-1R-DE-RA', 'IAM-1R-DE-RA', 'IOM-1R-DE-RA', 'CNS-1R-DE-RA', 'AGE-1R-DE-RA', 'LOG-1R-DE-RA', 'ITS-2R-DE-RA', 'IAM-2R-DE-RA', 'ISE-1R-DE-RA', 'CNS-2R-DE-RA', 'AGE-2R-DE-RA', 'LOG-2R-DE-RA'];
const LANG_POOL = ['ITS-1R-DE-RA', 'ITS-2R-DE-RA', 'IAM-1R-DE-RA', 'IAM-2R-DE-RA', 'IOM-1R-DE-RA', 'IOM-2R-DE-RA', 'CNS-1R-DE-RA', 'AGE-1R-DE-RA', 'LOG-1R-DE-RA', 'AGB-1R-DE-RA', 'AGP-1R-DE-RA', 'ISE-1R-DE-RA'];
const contextBlocks: { faculty: string; prefix: string; dept: string; serialBase: number; topics: string[]; cohorts: (i: number) => Sec[] }[] = [
  {
    faculty: 'คณะวิทยาศาสตร์ประยุกต์', prefix: '0402', dept: 'ภาควิชาคณิตศาสตร์', serialBase: 10101,
    topics: ['Foundation Mathematics', 'Linear Algebra', 'Calculus for Technology', 'Statistics for Technologists', 'Advanced Calculus', 'Differential Equations', 'Numerical Methods', 'Discrete Mathematics'],
    cohorts: i => i % 3 === 0
      ? [s('1', [SERVICE_POOL[(i * 3) % SERVICE_POOL.length]], plannedOf(1101 + i)), s('2', [SERVICE_POOL[(i * 3 + 5) % SERVICE_POOL.length]], plannedOf(1102 + i))]
      : [s('1', [SERVICE_POOL[(i * 3) % SERVICE_POOL.length]], plannedOf(1101 + i))],
  },
  {
    faculty: 'คณะวิทยาศาสตร์ประยุกต์', prefix: '0403', dept: 'ภาควิชาฟิสิกส์อุตสาหกรรมและอุปกรณ์การแพทย์', serialBase: 30101,
    topics: ['Industrial Physics', 'Electronics Fundamentals', 'Mechanics for Engineers', 'Optics and Instrumentation', 'Medical Device Physics'],
    cohorts: i => [s('1', [SERVICE_POOL[(i * 3 + 2) % SERVICE_POOL.length]], plannedOf(3101 + i))],
  },
  {
    faculty: 'คณะวิทยาศาสตร์ประยุกต์', prefix: '0405', dept: 'ภาควิชาสถิติประยุกต์', serialBase: 50101,
    topics: ['Applied Statistics I', 'Statistical Quality Control', 'Regression Analysis', 'Experimental Design', 'Data Visualization'],
    cohorts: i => [s('1', [SERVICE_POOL[(i * 3 + 4) % SERVICE_POOL.length]], plannedOf(5101 + i))],
  },
  {
    faculty: 'คณะอุตสาหกรรมเกษตรดิจิทัล', prefix: '0501', dept: 'ภาควิชาเทคโนโลยีอุตสาหกรรมเกษตรและการจัดการ', serialBase: 10101,
    topics: ['Smart Farming', 'Agricultural Logistics', 'Agro-Industrial Management', 'Farm Business Accounting', 'Agricultural Marketing', 'Post-Harvest Management', 'Agri-Supply Chains', 'Cooperative Management', 'Agricultural Policy', 'Rural Entrepreneurship', 'Farm Mechanization', 'Irrigation Management', 'Soil Science for Agriculture', 'Crop Production Systems', 'Livestock Production', 'Aquaculture Fundamentals', 'Agricultural Extension', 'Organic Farming', 'Greenhouse Technology', 'Agricultural Meteorology', 'Seed Technology', 'Plant Propagation', 'Agroforestry', 'Agricultural Waste Management', 'Climate-Smart Agriculture', 'Digital Agriculture Platforms'],
    cohorts: i => i % 8 === 3
      ? [s('1', [`AGB-${(i % 4) + 1}R-DE-RA`], plannedOf(2101 + i)), s('2', [`AGB-${(i % 4) + 1}R-DE-RB`], plannedOf(2102 + i))]
      : [s('1', [`AGB-${(i % 4) + 1}R-DE-RA`], plannedOf(2101 + i))],
  },
  {
    faculty: 'คณะอุตสาหกรรมเกษตรดิจิทัล', prefix: '0502', dept: 'ภาควิชาพัฒนาผลิตภัณฑ์อุตสาหกรรมเกษตร', serialBase: 20101,
    topics: ['Food Product Development', 'Packaging Technology', 'Food Chemistry', 'Food Microbiology', 'Sensory Evaluation', 'Food Safety Management', 'Product Design for Agriculture', 'Food Processing', 'Quality Assurance for Food', 'Nutrition Fundamentals', 'Functional Foods', 'Food Packaging Design', 'Agro-Product Branding', 'Consumer Behavior', 'Food Standards and Regulations', 'Cold Chain Products', 'Fermentation Technology', 'Minimal Processing', 'Food Additives', 'Shelf-Life Studies', 'Food Instrumental Analysis', 'Agro-Product Innovation', 'Traditional Food Products', 'Food Biotechnology', 'Culinary Science'],
    cohorts: i => i % 8 === 3
      ? [s('1', [`AGP-${(i % 4) + 1}R-DE-RA`], plannedOf(2201 + i)), s('2', [`AGP-${(i % 4) + 1}R-DE-RB`], plannedOf(2202 + i))]
      : [s('1', [`AGP-${(i % 4) + 1}R-DE-RA`], plannedOf(2201 + i))],
  },
  {
    faculty: 'คณะอุตสาหกรรมเกษตรดิจิทัล', prefix: '0506', dept: 'ภาควิชานวัตกรรมและเทคโนโลยีการพัฒนาผลิตภัณฑ์', serialBase: 60101,
    topics: ['Design Thinking for Products', 'Product Innovation Management', 'Materials for Product Development', 'Prototyping Workshop', 'Product Costing', 'Intellectual Property for Products', 'Sustainable Product Design', 'User Experience Design', 'Product Testing Methods', 'Manufacturing for Products', 'Product Lifecycle Management', 'Service Innovation', 'Innovation Policy', 'Technology Commercialization', 'Creative Product Portfolio', 'Product Photography and Media', 'E-Commerce for Products', 'Product Certification', 'Circular Economy Products', 'Ergonomics', 'Industrial Design Studio', 'Product Data Management'],
    cohorts: i => [s('1', [`AGT-${(i % 4) + 1}R-DE-RA`, ...(i % 7 === 0 ? ['AGE-3R-DE-RA'] : [])], plannedOf(2601 + i))],
  },
  {
    faculty: 'คณะศิลปศาสตร์ประยุกต์', prefix: '0801', dept: 'ภาควิชาภาษา', serialBase: 10101,
    topics: ['English for Communication I', 'English for Communication II', 'English for Workplace', 'Academic English', 'Basic Japanese', 'Basic Korean', 'Chinese for Beginners', 'English Presentation Skills', 'Technical Reading and Writing', 'English for Hospitality', 'Translation Fundamentals', 'Conversational French'],
    // Language courses run one section per served cohort, like the real export.
    cohorts: i => Array.from({ length: 3 + (i % 4) }, (_, k) => s(String(k + 1), [LANG_POOL[(i + k) % LANG_POOL.length]], plannedOf(8101 + i * 4 + k))),
  },
  {
    faculty: 'คณะศิลปศาสตร์ประยุกต์', prefix: '0802', dept: 'ภาควิชาสังคมศาสตร์', serialBase: 20101,
    topics: ['Society and Technology', 'Community Engagement', 'Labor Law Basics', 'Entrepreneurship and Society'],
    cohorts: i => [s('1', [LANG_POOL[i % LANG_POOL.length], LANG_POOL[(i + 5) % LANG_POOL.length]], plannedOf(8201 + i))],
  },
  {
    faculty: 'คณะศิลปศาสตร์ประยุกต์', prefix: '0803', dept: 'ภาควิชามนุษยศาสตร์', serialBase: 30101,
    topics: ['Local Heritage and Culture', 'Ethics in Technology', 'Thai Civilization', 'Aesthetics of Everyday Life'],
    cohorts: i => [s('1', [LANG_POOL[(i + 3) % LANG_POOL.length], LANG_POOL[(i + 8) % LANG_POOL.length]], plannedOf(8301 + i))],
  },
];
const contextBlocksOf = (faculty: string) => contextBlocks.filter(b => b.faculty === faculty).map(b => ({
  faculty: b.faculty, dept: b.dept,
  courses: b.topics.map((name, i) => ({ code: `${b.prefix}${b.serialBase + i * 7}`, name, secs: b.cohorts(i), midterm: 'auto' as const, final: 'auto' as const })),
}));
const CONTEXT: Block[] = [...contextBlocksOf('คณะวิทยาศาสตร์ประยุกต์'), ...contextBlocksOf('คณะอุตสาหกรรมเกษตรดิจิทัล'), ...contextBlocksOf('คณะศิลปศาสตร์ประยุกต์')];
const allCourses = [...managedBlocks, ...CONTEXT].flatMap(b => b.courses);

// Fictional staff roster (sized like the real 66-entry roster). The xlsx instructor
// cells draw from the same people. Names combine invented first names and surnames.
const HONORIFICS = ['อ.ดร.', 'ผศ.ดร.', 'ผศ.', 'รศ.ดร.', 'อ.'];
const FIRST_M = ['วรากร', 'อภิชาติ', 'ธนากร', 'เกริกไกร', 'ศักดา', 'กฤษณะ', 'สถาพร', 'จิรายุ', 'พีระพงษ์', 'อติวิชญ์', 'ภาสกร', 'วรุฒ', 'ปุณณวิช', 'ธีรเดช', 'ภูมิรพี', 'เอกราช', 'อาทิตย์', 'วิศรุต', 'กิตติภูมิ', 'ณัฐวุฒิ', 'ศุภณัฐ', 'จักรพงษ์'];
const FIRST_F = ['พรทิพย์', 'กัญญา', 'ปวีณา', 'วิภาวี', 'ณัชชา', 'ชาลิสา', 'อารยา', 'ธัญญ์รภัสร์', 'มาลินี', 'สุภาวดี', 'พิมพ์ชนก', 'ธิดาทิพย์', 'ณิชานันท์', 'สายสุดา', 'จุไรรัตน์', 'กมลชนก', 'ชิดชนก', 'เบญจวรรณ', 'ศิริพรรณ', 'อาทิตยา', 'วลัยลักษณ์', 'สุชานาฏ'];
const SURNAMES = ['ศรีสุวรรณ', 'จันทร์เพ็ญ', 'บุญเรือง', 'แสงสุริยา', 'วัฒนกุล', 'มั่นคง', 'โพธิ์ทอง', 'นิลรัตน์', 'พงษ์ไพบูลย์', 'ฤทัยวัฒนา', 'ทองอินทร์', 'ปิ่นแก้ว', 'ชูเกียรติ', 'เพ็ชรแท่ง', 'สุขเกษม', 'กมลรัตน์', 'วงศ์สถาพร', 'ใจผดุง', 'ลืออำนวย', 'ทับทิมทอง', 'อ่อนน้อม', 'มีสุข', 'แสงหิรัญ', 'เกียรติศักดิ์', 'โพธิ์สีทอง', 'ฤทัยไชโย', 'วิริยะกร', 'แก้วมณี', 'สินธุทอง', 'ตั้งตรงจิตร', 'อยู่เย็น', 'พรหมมาลี', 'รุ่งเรืองกิจ', 'สายบัว', 'คำแสน', 'ดวงแก้ว', 'พัดชา'];
const ROSTER: { name: string; gender: string; computer: boolean }[] = [];
{
  const used = new Set<string>();
  for (let i = 0; ROSTER.length < 66; i++) {
    const female = i % 2 === 1;
    const first = (female ? FIRST_F : FIRST_M)[Math.floor(i / 2) % (female ? FIRST_F.length : FIRST_M.length)];
    const surname = SURNAMES[(i * 7 + Math.floor(i / 2)) % SURNAMES.length];
    const name = `${HONORIFICS[i % HONORIFICS.length]}${first} ${surname}`;
    if (used.has(name)) continue;
    used.add(name);
    ROSTER.push({ name, gender: female ? 'หญิง' : 'ชาย', computer: i % 3 === 0 });
  }
}
const INSTRUCTORS = ROSTER.map(r => r.name);

// Pack each cohort's context exams across the whole window instead of the first days:
// scan starts rotate per course and wrap around on cohort clashes.
const occupied = new Map<string, Set<string>>();
const free = (gs: string[], key: string) => gs.every(g => !occupied.get(g)?.has(key));
const claim = (gs: string[], key: string) => { for (const g of gs) { if (!occupied.has(g)) occupied.set(g, new Set()); occupied.get(g)!.add(key); } };
const timings = new Map<string, Timing>();
const ordinalOf = new Map(allCourses.map((c, i) => [c, i + 1]));
for (const type of ['midterm', 'final'] as const) {
  const slots = type === 'midterm' ? MT : FT;
  for (const course of allCourses) {
    if (course[type] !== 'auto') continue;
    const groups = [...new Set(course.secs.flatMap(sec => sec.groups))];
    const start = (ordinalOf.get(course)! * 3) % slots.length;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[(start + i) % slots.length];
      const key = `${type}:${slot.date}:${slot.time}`;
      if (!free(groups, key)) continue;
      claim(groups, key);
      timings.set(`${course.code}:${type}`, slot);
      break;
    }
    if (!timings.has(`${course.code}:${type}`)) throw new Error(`No free slot for ${course.code} ${type}`);
  }
}

const LANGS = ['TH', 'F', 'S'];
const teachingTime = (o: number) => SESSIONS[o % 2];
const teachingRoom = (o: number) => `1-B${1 + (o % 3)}-${10 + (o % 9)}`;
const teachersOf = (o: number) => [INSTRUCTORS[o % INSTRUCTORS.length], ...(o % 5 === 0 ? [INSTRUCTORS[(o + 7) % INSTRUCTORS.length]] : [])];

const blank = (n: number) => Array<string>(n).fill('');
const exam = (code: string, type: 'midterm' | 'final') => timings.get(`${code}:${type}`);
function courseRow(course: Course, o: number) {
  const mt = exam(course.code, 'midterm'), ft = exam(course.code, 'final');
  return course.secs.map((sec, i) => {
    const row = blank(22);
    if (i === 0) { row[0] = course.code; row[3] = course.name; }
    row[4] = '3'; row[5] = '3'; row[6] = '0'; row[7] = '6';
    row[8] = sec.n; row[9] = String(sec.planned); row[10] = '';
    row[11] = LANGS[o % 3]; row[12] = teachingTime(o); row[13] = teachingRoom(o);
    row[14] = teachersOf(o).join('\n'); row[15] = sec.groups.join('\n');
    if (mt) { row[16] = be(mt.date); row[17] = mt.time; }
    if (ft) { row[18] = be(ft.date); row[19] = ft.time; }
    return row;
  });
}
const HEADER = ['  รหัสวิชา', '', '', 'ชื่อวิชา', 'หน่วยกิต', '', '', '', 'ตอน', 'จำนวน นศ.', '', 'วัน', 'เวลาเรียน', 'สถานที่', 'อาจารย์ผู้สอน', 'กลุ่มนักศึกษา', 'สอบกลางภาค', '', 'สอบปลายภาค', '', '', ''];
const SUBHEADER = ['', '', '', '', 'รวม', 'ท.', 'ป.', 'ศ.', '', 'เปิด', 'ลง', '', '', '', '', '', 'วัน', 'เวลา', 'วัน', 'เวลา', '', ''];
function workbookAoa(blocks: Block[]) {
  const rows: string[][] = [];
  const masthead = blank(22);
  masthead[2] = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าพระนครเหนือ'; masthead[13] = 'รายงานระเบียนขบวนวิชา';
  const system = blank(22);
  system[2] = 'ระบบตารางสอนตารางสอบ'; system[13] = 'มจพ. วิทยาเขตปราจีนบุรี ภาคการศึกษาที่ 1/2569';
  rows.push(masthead, system, blank(22), blank(22), blank(22), blank(22));
  for (const block of blocks) {
    const heading = blank(22);
    heading[0] = block.faculty; heading[13] = block.dept;
    rows.push(heading, blank(22), HEADER, SUBHEADER);
    for (const course of block.courses) {
      const o = ordinalOf.get(course)!;
      for (const row of courseRow(course, o)) rows.push(row);
      rows.push(blank(22));
    }
  }
  const footer = blank(22);
  footer[0] = 'ตารางสอน-สอบปัจจุบัน (REG-R40-01-22)'; footer[13] = '01/06/2026 09:00'; footer[19] = 'Page'; footer[20] = '1/1';
  rows.push(footer);
  return rows;
}
const writeWorkbook = (name: string, blocks: Block[]) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(workbookAoa(blocks)), 'Sheet');
  // The ESM xlsx build cannot write to paths directly; emit a buffer instead.
  writeFileSync(resolve(outDir, name), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
};
writeWorkbook('06.xlsx', managedBlocks);
writeWorkbook('04.xlsx', CONTEXT.filter(b => b.faculty === 'คณะวิทยาศาสตร์ประยุกต์'));
writeWorkbook('05.xlsx', CONTEXT.filter(b => b.faculty === 'คณะอุตสาหกรรมเกษตรดิจิทัล'));
writeWorkbook('08.xlsx', CONTEXT.filter(b => b.faculty === 'คณะศิลปศาสตร์ประยุกต์'));

// University rule table: same column semantics as the real registrar file. Every
// referenced code must exist in the managed source and same-time members must never
// share student groups; excluded/no-final/no-exam courses stay undated.
const managedCourses = managedBlocks.flatMap(b => b.courses);
const pick = (n: number) => managedCourses[n].code;
const rulesRows: string[][] = [
  ['ไม่มีสอบกลางภาค/สอบนอกตาราง', 'ไม่มีสอบปลายภาค', 'ไม่มีสอบ', 'วิชาเดียวแต่สอบสองช่วง  (กำหนดให้เป็น 9.00-16.00 น.)', 'ให้มีวัน เวลา สอบ ตรงกัน', '', '', '', '', '', ''],
];
for (const code of [pick(2), pick(7), pick(47)]) rulesRows.push([code, ...blank(10)]);
for (const code of [pick(5), pick(8), pick(50), pick(55), pick(76), pick(93), pick(98), pick(111), pick(118)]) rulesRows.push(['', code, ...blank(9)]);
for (const code of [pick(11), pick(117)]) rulesRows.push(['', '', code, ...blank(8)]);
for (const code of [pick(63), pick(84)]) rulesRows.push(['', '', '', code, ...blank(7)]);
rulesRows.push(['', '', '', '', pick(58), pick(95), ...blank(5)]);
rulesRows.push(['', '', '', '', pick(6), pick(152), ...blank(5)]);
writeFileSync(resolve(outDir, 'rules.csv'), '\uFEFF' + rulesRows.map(r => r.join(',')).join('\n') + '\n');

const roomRows = [
  ['ห้อง', 'แถว', 'จำนวนคน', 'คอม'],
  ['หอประชุมดอกรัก', 'ก ข ค ง', '4', ''],
  ['B1-101', 'A B C', '3', ''], ['B1-102', 'D E F', '3', ''], ['B1-201', 'A B C', '3', ''], ['B1-202', '', '2', ''],
  ['B2-101', '', '2', ''], ['B2-102', '', '2', ''], ['B2-201', '', '2', ''],
  ['B3-101', '', '2', ''], ['B3-201', '', '2', ''],
  ['B4-101', '', '2', ''], ['B4-201', '', '2', ''],
  ['C1-101', '', '3', 'ใช่'], ['C1-102', '', '3', 'ใช่'], ['C2-101', '', '4', 'ใช่'],
];
writeFileSync(resolve(outDir, 'roominfo.csv'), '\uFEFF' + roomRows.map(r => r.join(',')).join('\n') + '\n');

// Fictional proctor roster. The title text carries the academic term (1/2569) so the
// roster stays eligible; the trailing free-text note demonstrates note handling.
const NOTE_OWNER = ROSTER[27].name;
const NOTE = `${NOTE_OWNER} วันเสาร์ไม่ได้`;
const MT_DATES = [['จ', '2026-08-17'], ['อ', '2026-08-18'], ['พ', '2026-08-19'], ['พฤ', '2026-08-20'], ['ศ', '2026-08-21'], ['ส', '2026-08-22']] as const;
const proctorWidth = 20;
const headerRow = ['กรรมการ', 'เพศ', 'คอม', 'สถานะ'];
const bandRow = ['', '', '', ''];
MT_DATES.forEach(([day, iso]) => { headerRow.push(`${day}.${be4(iso)}`, ''); bandRow.push('9-12', '13-16'); });
headerRow.push(...blank(2), NOTE); bandRow.push(...blank(4));
const proctorRows: string[][] = [blank(proctorWidth), ['ตารางคุมสอบกลางภาคเรียนที่ 1 ปีการศึกษา 2569', ...blank(proctorWidth - 1)], blank(proctorWidth), headerRow, bandRow];
for (const { name, gender, computer } of ROSTER) proctorRows.push([name, gender, computer ? 'ใช่' : '', 'อาจารย์', ...blank(proctorWidth - 4)]);
writeFileSync(resolve(outDir, 'proctors.csv'), '\uFEFF' + proctorRows.map(r => r.join(',')).join('\n') + '\n');

const sectionCount = allCourses.reduce((n, c) => n + c.secs.length, 0);
console.log(`Wrote synthetic example fixtures to ${outDir}: ${allCourses.length} courses, ${sectionCount} section rows, ${ROSTER.length} proctors`);
