import type { ExamEvent, ExamType, Project, ValidationIssue } from '../lib/types.ts';
import { i18n, t } from './i18n.svelte.ts';

export const examLabel = (type: ExamType) => type === 'midterm' ? t('Midterm', 'กลางภาค') : t('Final', 'ปลายภาค');
export const clockTime = (minutes: number) => `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
const format = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(i18n.lang === 'th' ? 'th-TH' : 'en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
export const dateLabel = (date: string) => format(date, { day: 'numeric', month: 'short', year: 'numeric' });
export const shortDate = (date: string) => format(date, { weekday: 'short', day: 'numeric', month: 'short' });
export const timingLabel = (event: ExamEvent) => event.timing ? `${clockTime(event.timing.startMinutes)}–${clockTime(event.timing.endMinutes)}` : t('Unscheduled', 'ยังไม่ได้จัดตาราง');
export const courseName = (project: Project, code: string) => project.sections.find(s => s.courseCode === code)?.courseName ?? code;
// Scoped share snapshots (schedule permission) carry no artifact metadata; the id itself stays visible.
export const sourceLabel = (project: Project, id: string) => project.artifacts?.find(a => a.id === id)?.originalName ?? id;
export const eventStatus = (event: ExamEvent) => event.timingOrigin === 'imported' ? t('Fixed', 'กำหนดแล้ว') : event.timingOrigin === 'manual' ? t('Locked', 'ล็อกเวลา') : event.timing ? t('Scheduled', 'จัดแล้ว') : event.required ? t('Unscheduled', 'ยังไม่ได้จัดตาราง') : t('Excluded', 'ไม่จัดส่วนกลาง');
export const coverageNames: Record<string, [string, string]> = {
  imports: ['Course import', 'การนำเข้าข้อมูล'],
  canonicalEvents: ['Canonical events', 'ความถูกต้องของรายการสอบ'],
  studentOverlap: ['Student overlap', 'การซ้อนของกลุ่มนักศึกษา'],
  sameTimeRules: ['Same-time rules', 'เงื่อนไขสอบพร้อมกัน'],
  dateRanges: ['Exam period', 'ช่วงวันสอบ'],
  requiredExams: ['Required exams', 'การจัดวิชาที่ต้องสอบ'],
  fixedTimings: ['Fixed & locked timings', 'เวลาที่กำหนดและล็อกไว้'],
  fullDay: ['Full-day interval', 'ช่วงเวลาเต็มวัน'],
  calendarPolicy: ['Weekend & holiday policy', 'นโยบายวันหยุด'],
  roomCapacity: ['Room capacity', 'ความจุห้องสอบ'],
  roomDoubleBooking: ['Room double-booking', 'การจองห้องซ้อนกัน'],
  proctorAvailability: ['Proctor availability', 'ความพร้อมผู้คุมสอบ'],
  proctorDoubleBooking: ['Proctor double-booking', 'ผู้คุมสอบซ้อนกัน'],
  resourceIntegrity: ['Resource integrity', 'ความถูกต้องของทรัพยากร'],
  proctorStaffing: ['Proctor staffing', 'การจัดผู้คุมสอบ'],
};
export const coverageName = (key: string) => { const names = coverageNames[key]; return names ? t(names[0], names[1]) : t('Validation check', 'รายการตรวจสอบ'); };
const issueNames: Record<string, [string, string]> = {
  SOURCE_EXAM_CONFLICT: ['Source exam conflict', 'ตารางสอบต้นทางชนกัน'],
  STUDENT_GROUP_OVERLAP: ['Student conflict', 'กลุ่มนักศึกษาสอบซ้อน'],
  SAME_TIME_CONTRADICTION: ['Contradictory same-time rule', 'เงื่อนไขสอบพร้อมกันขัดแย้ง'],
  UNSCHEDULED_REQUIRED_EXAM: ['Unscheduled exam', 'วิชาที่ยังไม่ได้จัดตาราง'],
  STALE_RULE_REFERENCE: ['Course missing from source', 'ไม่พบวิชาในข้อมูลปัจจุบัน'],
  INVALID_RULE_CODE: ['Invalid course code', 'รหัสวิชาไม่ถูกต้อง'],
  MISSING_STUDENT_GROUPS: ['Missing student groups', 'ไม่มีกลุ่มนักศึกษา'],
  SOURCE_DATA_INVALID: ['Source needs correction', 'ต้องแก้ไขข้อมูลต้นทาง'],
  DUPLICATE_SECTION: ['Repeated section', 'ตอนเรียนซ้ำ'],
  DUPLICATE_RULE: ['Repeated rule', 'เงื่อนไขซ้ำ'],
  SAME_TIME_GROUP_PARTIALLY_STALE: ['Partially missing same-time group', 'กลุ่มสอบพร้อมกันมีวิชาที่ไม่พบ'],
  HOLIDAYS_NOT_CONFIGURED: ['Holidays not configured', 'ยังไม่ได้ระบุวันหยุด'],
  EXAM_ON_WEEKEND: ['Exam on a weekend', 'มีสอบในวันเสาร์หรืออาทิตย์'],
  EXAM_ON_HOLIDAY: ['Exam on a holiday', 'มีสอบในวันหยุด'],
  PROCTOR_SOURCE_TERM_MISMATCH: ['Proctor term mismatch', 'ภาคการศึกษาของผู้คุมสอบไม่ตรงกัน'],
  PROCTOR_INELIGIBLE: ['Quarantined proctor assignment', 'การจัดผู้คุมที่ถูกกักกัน'],
  PROCTOR_DEMAND_UNKNOWN: ['Unknown proctor demand', 'ไม่ทราบความต้องการผู้คุมสอบ'],
  PROCTOR_ASSIGNMENT_SEARCH_EXHAUSTED: ['Proctor assignment search limit', 'ถึงขีดจำกัดการค้นหาการจัดผู้คุมสอบ'],
  PROCTOR_REQUIREMENT_UNSATISFIED: ['Known proctor positions unfilled', 'ตำแหน่งผู้คุมที่ทราบยังจัดไม่ครบ'],
  COMPUTER_PROCTOR_MISSING: ['Computer proctor missing', 'ยังไม่มีผู้คุมที่มีทักษะคอมพิวเตอร์'],
  PROCTOR_SHEET_SKIPPED: ['Proctor sheet skipped', 'ข้ามชีตผู้คุมสอบ'],
  PROCTOR_MATRIX_QUARANTINED: ['Proctor duty matrix quarantined', 'กักกันตารางเวรผู้คุมสอบ'],
  DUPLICATE_ROOM_ID: ['Duplicate room identity', 'รหัสห้องสอบซ้ำ'],
  DUPLICATE_PROCTOR_ID: ['Duplicate proctor identity', 'รหัสผู้คุมสอบซ้ำ'],
  INVALID_RESOURCE_ID: ['Invalid resource identity', 'รหัสทรัพยากรไม่ถูกต้อง'],
  INVALID_PROCTOR_DEMAND: ['Invalid proctor demand', 'จำนวนผู้คุมสอบไม่ถูกต้อง'],
  DUPLICATE_ROOM_ASSIGNMENT: ['Duplicate room assignment', 'การจัดห้องสอบซ้ำ'],
  DUPLICATE_PROCTOR_ASSIGNMENT: ['Duplicate proctor assignment', 'การจัดผู้คุมสอบซ้ำ'],
  ROOM_ASSIGNMENT_CARDINALITY: ['Room assignment count', 'จำนวนห้องสอบที่จัดไม่ถูกต้อง'],
  RESOURCE_TIMING_INVALID: ['Resource timing invalid', 'เวลาทรัพยากรไม่ถูกต้อง'],
  ROOM_UNAVAILABLE: ['Room unavailable', 'ห้องสอบไม่ว่าง'],
  SOURCE_TERM_MISMATCH: ['Academic terms differ', 'ภาคการศึกษาของข้อมูลไม่ตรงกัน'],
  RESOURCE_SCHEDULING_NOT_IMPLEMENTED: ['Resource checks pending', 'ยังไม่ตรวจสอบห้องและผู้คุมสอบ'],
  OUTSIDE_PERIOD: ['Outside exam period', 'อยู่นอกช่วงสอบ'],
  FULL_DAY_REQUIRED: ['Full-day exam required', 'ต้องสอบเต็มวัน'],
  NO_EXAM_RULE_VIOLATED: ['No-exam rule violated', 'ขัดกับเงื่อนไขไม่มีสอบ'],
  SAME_TIME_NOT_SATISFIED: ['Same-time exams differ', 'เวลาสอบของกลุ่มไม่ตรงกัน'],
  INVALID_EXAM_TIMING: ['Invalid imported timing', 'วันหรือเวลาต้นทางไม่ถูกต้อง'],
  MALFORMED_COURSE_ROW: ['Invalid course row', 'แถวข้อมูลวิชาไม่ถูกต้อง'],
  CONTRADICTORY_RULES: ['Contradictory rules', 'เงื่อนไขขัดแย้ง'],
  COURSE_PREFIX_MISMATCH: ['Course prefix mismatch', 'รหัสวิชาไม่ตรงกับคำนำหน้าแหล่งข้อมูล'],
  DUPLICATE_EVENT: ['Duplicate event', 'รายการสอบซ้ำ'],
  DUPLICATE_PROCTOR_SOURCE: ['Duplicate proctor source', 'ไฟล์ผู้คุมสอบซ้ำ'],
  DUPLICATE_ROOM: ['Duplicate room', 'ห้องสอบซ้ำ'],
  DUPLICATE_ROOM_SOURCE: ['Duplicate room source', 'ไฟล์ห้องสอบซ้ำ'],
  DUPLICATE_SOURCE: ['Duplicate source', 'ไฟล์ต้นทางซ้ำ'],
  EVENT_MODEL_CHANGED: ['Event model changed', 'โครงสร้างรายการสอบเปลี่ยนแปลง'],
  EXCLUDED_EXAM_GENERATED: ['Excluded exam was generated', 'มีการจัดตารางให้วิชาที่ถูกยกเว้น'],
  FIXED_TIMING_CHANGED: ['Fixed timing changed', 'เวลาที่กำหนดไว้ถูกเปลี่ยน'],
  HOLIDAY_FORBIDDEN: ['Forbidden holiday exam', 'มีสอบในวันหยุดที่ห้ามจัดสอบ'],
  INVALID_COURSE_HEADER: ['Invalid course header', 'หัวตารางวิชาไม่ถูกต้อง'],
  INVALID_INTERVAL: ['Invalid interval', 'ช่วงเวลาไม่ถูกต้อง'],
  INVALID_ROOM_HEADER: ['Invalid room header', 'หัวตารางห้องสอบไม่ถูกต้อง'],
  INVALID_RULE_HEADER: ['Invalid rule header', 'หัวตารางเงื่อนไขไม่ถูกต้อง'],
  INVALID_SETTINGS: ['Invalid settings', 'การตั้งค่าไม่ถูกต้อง'],
  LOCK_NOT_SATISFIED: ['Manual lock not satisfied', 'ไม่เป็นไปตามเวลาที่ล็อกไว้'],
  MALFORMED_ROOM_PROCTOR_COUNT: ['Invalid room staffing count', 'จำนวนผู้คุมสอบในข้อมูลห้องไม่ถูกต้อง'],
  MISSING_EVENT: ['Missing event', 'รายการสอบหายไปจากตาราง'],
  NONSTANDARD_GENERATED_INTERVAL: ['Nonstandard generated interval', 'รายการสอบใช้ช่วงเวลาที่ไม่ได้ตั้งค่าไว้'],
  NO_COURSE_RECORDS: ['No course records', 'ไม่พบรายการวิชา'],
  NO_MANAGED_COURSES: ['No managed courses', 'ไม่มีวิชาที่จะจัดอัตโนมัติ'],
  NO_ROOM_RECORDS: ['No room records', 'ไม่พบรายการห้องสอบ'],
  PROCTOR_DOUBLE_BOOKED: ['Proctor double-booked', 'ผู้คุมสอบถูกจัดซ้อนเวลา'],
  PROCTOR_FREE_TEXT_NOTE: ['Unstructured proctor note', 'หมายเหตุผู้คุมสอบยังไม่ได้จัดโครงสร้าง'],
  PROCTOR_RECORD_CONFLICT: ['Conflicting proctor records', 'ข้อมูลผู้คุมสอบขัดแย้งกัน'],
  PROCTOR_ROSTER_SHEETS: ['Multiple proctor roster sheets', 'รวมชีตรายชื่อผู้คุมสอบหลายชีต'],
  PROCTOR_UNAVAILABLE: ['Proctor unavailable', 'ผู้คุมสอบไม่ว่าง'],
  ROOM_CAPACITY_EXCEEDED: ['Room capacity exceeded', 'จำนวนผู้สอบเกินความจุห้องสอบ'],
  ROOM_DOUBLE_BOOKED: ['Room double-booked', 'ห้องสอบถูกจัดซ้อนเวลา'],
  ROOM_PROCTOR_COUNT_MAPPING: ['Room staffing mapping', 'การตีความจำนวนผู้คุมจากข้อมูลห้อง'],
  ROOM_REQUIREMENT_UNSATISFIED: ['Room requirement not satisfied', 'ยังไม่ได้จัดห้องสอบ'],
  SOURCE_ROLE_CONFLICT: ['Source role conflict', 'ประเภทไฟล์ขัดแย้งกัน'],
  UNKNOWN_LOCK: ['Unknown lock', 'ไม่พบรายการสอบของเวลาที่ล็อกไว้'],
  UNKNOWN_PROCTOR: ['Unknown proctor', 'ไม่พบผู้คุมสอบ'],
  UNKNOWN_ROOM: ['Unknown room', 'ไม่พบห้องสอบ'],
  UNKNOWN_RULE_COLUMN: ['Unknown rule column', 'ไม่รู้จักคอลัมน์เงื่อนไข'],
  UNEXPECTED_EVENT: ['Unexpected event', 'พบรายการสอบที่ไม่มีในแบบจำลองต้นทาง'],
  WEEKEND_FORBIDDEN: ['Forbidden weekend exam', 'มีสอบในวันหยุดสุดสัปดาห์ที่ห้ามจัดสอบ'],
};
export const issueTitle = (issue: ValidationIssue) => { const names = issueNames[issue.type]; return names ? t(names[0], names[1]) : t('Validation finding', 'ข้อค้นพบ'); };

const candidateReasons: Record<string, [string, string]> = {
  ambiguous_identity: ['ambiguous identity', 'ข้อมูลประจำตัวซ้ำหรือกำกวม'],
  ineligible_roster: ['quarantined roster', 'รายชื่อถูกกักกัน'],
  unavailable: ['structurally unavailable', 'ไม่ว่างตามข้อมูลโครงสร้าง'],
  overlapping_duty: ['overlapping duty', 'มีหน้าที่ซ้อนเวลา'],
  not_selected: ['not selected by the assignment order', 'ไม่ได้เลือกตามลำดับการจัด'],
};
export const candidateReasonLabel = (reason: string) => { const names = candidateReasons[reason]; return names ? t(names[0], names[1]) : t('Unavailable for an unspecified reason', 'ไม่พร้อมใช้งานด้วยเหตุผลที่ไม่ระบุ'); };

const reasonSummary = (value: string) => value.split(', ').map(part => {
  const match = /^(\d+) (.+)$/.exec(part);
  const reason = match?.[2];
  return match && reason ? `${match[1]} ${candidateReasonLabel(reason)}` : t('No proctor roster imported', 'ยังไม่ได้นำเข้ารายชื่อผู้คุมสอบ');
}).join(', ');

/** Localizes validator/import diagnostics while preserving source values such as names, dates and IDs. */
export const issueMessage = (issue: ValidationIssue) => {
  const message = issue.message;
  const date = message.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  switch (issue.type) {
    case 'INVALID_SETTINGS':
      if (message.includes('Sessions')) return t('Sessions must be valid time intervals.', 'ช่วงเวลาสอบต้องเป็นช่วงเวลาที่ถูกต้อง');
      if (message.includes('weekend')) return t('The weekend policy is invalid.', 'นโยบายวันหยุดสุดสัปดาห์ไม่ถูกต้อง');
      if (message.includes('holiday')) return t('The holiday policy or holiday dates are invalid.', 'นโยบายวันหยุดหรือวันที่วันหยุดไม่ถูกต้อง');
      if (message.includes('Search budget')) return t('Solver effort must be a whole number from 1 to 1,000,000.', 'ระดับความพยายามต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 1,000,000');
      return t('Project settings are invalid. Check the calendar and session settings.', 'การตั้งค่าโครงการไม่ถูกต้อง กรุณาตรวจสอบช่วงวันสอบและช่วงเวลา');
    case 'INVALID_RESOURCE_ID':
      return message.startsWith('ROOM') ? t('A room identity must be a nonempty value.', 'ข้อมูลประจำตัวห้องสอบต้องไม่ว่าง') : t('A proctor identity must be a nonempty value.', 'ข้อมูลประจำตัวผู้คุมสอบต้องไม่ว่าง');
    case 'DUPLICATE_ROOM_ID': {
      const id = message.match(/ID (.+?) occurs/)?.[1] ?? '';
      return t(`Room ID ${id} appears more than once and is excluded from allocation.`, `รหัสห้องสอบ ${id} ซ้ำ จึงไม่นำไปใช้จัดห้อง`);
    }
    case 'DUPLICATE_PROCTOR_ID': {
      const id = message.match(/ID (.+?) occurs/)?.[1] ?? '';
      return t(`Proctor ID ${id} appears more than once and is excluded from allocation.`, `รหัสผู้คุมสอบ ${id} ซ้ำ จึงไม่นำไปใช้จัดผู้คุมสอบ`);
    }
    case 'INVALID_PROCTOR_DEMAND': {
      const room = message.match(/for (.+?) must be/)?.[1] ?? '';
      return t(`The proctor demand for ${room} must be a positive whole number.`, `จำนวนผู้คุมสอบของห้อง ${room} ต้องเป็นจำนวนเต็มบวก`);
    }
    case 'UNKNOWN_RULE_COLUMN': {
      const column = message.split(': ').slice(1).join(': ') || '';
      return t(`Unrecognized rule column: ${column}`, `ไม่รู้จักคอลัมน์เงื่อนไข: ${column}`);
    }
    case 'INVALID_EXAM_TIMING': {
      const parsed = message.match(/Cannot parse (midterm|final) timing: (.+)$/);
      const exam = parsed?.[1] === 'midterm' ? t('midterm', 'กลางภาค') : t('final', 'ปลายภาค');
      return parsed ? t(`Cannot parse the ${parsed[1]} exam timing: ${parsed[2]}`, `ไม่สามารถอ่านวันหรือเวลาสอบ${exam}: ${parsed[2]}`) : t('The imported exam timing is invalid.', 'วันหรือเวลาสอบจากไฟล์ต้นทางไม่ถูกต้อง');
    }
    case 'CONTRADICTORY_RULES': {
      const exam = message.match(/^(midterm|final)/)?.[1];
      const examLabel = exam === 'midterm' ? t('midterm', 'กลางภาค') : exam === 'final' ? t('final', 'ปลายภาค') : t('exam', 'การสอบ');
      return t(`The ${exam ?? 'exam'} is both excluded and constrained by an examination rule.`, `${examLabel}ถูกกำหนดทั้งให้ยกเว้นและให้มีการสอบตามเงื่อนไข`);
    }
    case 'PROCTOR_INELIGIBLE': {
      const name = message.match(/^(.+?) is quarantined/)?.[1] ?? '';
      return t(`${name} is quarantined from current assignments because the roster term does not match.`, `${name} ถูกกักกันจากการจัดปัจจุบัน เพราะภาคการศึกษาของรายชื่อไม่ตรงกัน`);
    }
    case 'PROCTOR_UNAVAILABLE': {
      const name = message.match(/^(.+?) is structurally unavailable/)?.[1] ?? '';
      return t(`${name} is structurally unavailable at this time.`, `${name} ไม่ว่างตามข้อมูลโครงสร้างในช่วงเวลานี้`);
    }
    case 'ROOM_UNAVAILABLE': {
      const room = message.match(/^(.+?) is unavailable/)?.[1] ?? '';
      return t(`${room} is unavailable on this date.`, `${room} ไม่ว่างในวันที่นี้`);
    }
    case 'ROOM_CAPACITY_EXCEEDED': {
      const values = message.match(/^(\d+) students exceed the (\d+) seats of (.+)$/);
      return values ? t(`${values[1]} students exceed the ${values[2]} seats of ${values[3]}.`, `ผู้สอบ ${values[1]} คนเกินความจุ ${values[2]} ที่นั่งของ ${values[3]}`) : t('The examination exceeds the room capacity.', 'จำนวนผู้สอบเกินความจุห้องสอบ');
    }
    case 'PROCTOR_DEMAND_UNKNOWN': {
      const room = message.match(/for (.+?);/)?.[1] ?? '';
      return room ? t(`Required proctor count is unknown for ${room}; enter the room staffing requirement.`, `ยังไม่ทราบจำนวนผู้คุมสอบของห้อง ${room} กรุณาระบุความต้องการผู้คุมสอบของห้อง`) : t('Proctor demand cannot be determined until a known room is assigned.', 'ยังระบุจำนวนผู้คุมสอบไม่ได้จนกว่าจะจัดห้องที่มีข้อมูลให้รายการสอบ');
    }
    case 'PROCTOR_REQUIREMENT_UNSATISFIED': {
      const values = message.match(/^(\d+) of (\d+) known proctor positions are filled in (.+?); (.+)$/);
      return values ? t(`${values[1]} of ${values[2]} known proctor positions are filled in ${values[3]}; ${reasonSummary(values[4])}.`, `จัดตำแหน่งผู้คุมสอบที่ทราบแล้ว ${values[1]} จาก ${values[2]} ตำแหน่งใน ${values[3]} สำเร็จ เหตุผลที่เหลือ: ${reasonSummary(values[4])}`) : t('Known proctor positions remain unfilled.', 'ยังจัดตำแหน่งผู้คุมสอบที่ทราบไม่ครบ');
    }
    case 'ROOM_DOUBLE_BOOKED': return date ? t(`${date}: one room hosts overlapping examinations.`, `${date}: ห้องสอบหนึ่งห้องถูกใช้กับรายการสอบที่เวลาซ้อนกัน`) : t('One room hosts overlapping examinations.', 'ห้องสอบหนึ่งห้องถูกใช้กับรายการสอบที่เวลาซ้อนกัน');
    case 'PROCTOR_DOUBLE_BOOKED': return date ? t(`${date}: one proctor invigilates overlapping examinations.`, `${date}: ผู้คุมสอบหนึ่งคนถูกจัดกับรายการสอบที่เวลาซ้อนกัน`) : t('One proctor is assigned to overlapping examinations.', 'ผู้คุมสอบหนึ่งคนถูกจัดกับรายการสอบที่เวลาซ้อนกัน');
    case 'STUDENT_GROUP_OVERLAP':
    case 'SOURCE_EXAM_CONFLICT': return date ? t(`${date}: overlapping examinations share student groups.`, `${date}: รายการสอบที่เวลาซ้อนกันมีกลุ่มนักศึกษาร่วมกัน`) : t('Overlapping examinations share student groups.', 'รายการสอบที่เวลาซ้อนกันมีกลุ่มนักศึกษาร่วมกัน');
    case 'EXAM_ON_WEEKEND': return date ? t(`The examination falls on a weekend: ${date}.`, `รายการสอบอยู่ในวันหยุดสุดสัปดาห์: ${date}`) : t('The examination falls on a weekend.', 'รายการสอบอยู่ในวันหยุดสุดสัปดาห์');
    case 'EXAM_ON_HOLIDAY': return date ? t(`The examination falls on a configured holiday: ${date}.`, `รายการสอบตรงกับวันหยุดที่ตั้งไว้: ${date}`) : t('The examination falls on a configured holiday.', 'รายการสอบตรงกับวันหยุดที่ตั้งไว้');
    case 'WEEKEND_FORBIDDEN': return t('The generated examination uses a forbidden weekend.', 'รายการสอบที่จัดอัตโนมัติอยู่ในวันหยุดสุดสัปดาห์ที่ห้ามจัดสอบ');
    case 'HOLIDAY_FORBIDDEN': return t('The generated examination uses a forbidden holiday.', 'รายการสอบที่จัดอัตโนมัติตรงกับวันหยุดที่ห้ามจัดสอบ');
    case 'PROCTOR_SHEET_SKIPPED': return t(`Sheets without a proctor roster header were not interpreted: ${message.split(': ').slice(1).join(': ')}`, `ไม่แปลผลชีตที่ไม่มีหัวตารางรายชื่อผู้คุมสอบ: ${message.split(': ').slice(1).join(': ')}`);
    case 'PROCTOR_ROSTER_SHEETS': return t(`Roster sheets were merged into one roster: ${message.split(': ').slice(1).join(': ')}`, `รวมชีตรายชื่อเป็นรายชื่อผู้คุมสอบชุดเดียว: ${message.split(': ').slice(1).join(': ')}`);
    case 'PROCTOR_FREE_TEXT_NOTE': {
      const note = message.split(' — ')[0];
      if (message.includes('no matching roster entry')) return t(`${note} — no matching roster entry.`, `${note} ไม่พบรายชื่อผู้คุมสอบที่ตรงกัน`);
      const detail = message.match(/: (.+)$/)?.[1] ?? note;
      return t(`Structured availability must be entered manually before this constraint is enforced: ${detail}`, `ต้องป้อนเวลาว่างแบบมีโครงสร้างด้วยตนเองก่อนจึงจะใช้เงื่อนไขนี้ได้: ${detail}`);
    }
    case 'PROCTOR_MATRIX_QUARANTINED':
      if (message.includes('different academic term')) return t(message, 'ตารางเวรที่มีวันที่อยู่คนละภาคการศึกษา จึงไม่ใช้เป็นเวลาว่างของภาคการศึกษาปัจจุบัน');
      if (message.includes('different exam period')) return t(message, 'ตารางเวรที่มีวันที่อยู่นอกช่วงสอบที่ตรงกัน จึงไม่ใช้เป็นเวลาว่างของช่วงสอบปัจจุบัน');
      return t('Dated duties outside the configured exam periods were not interpreted as current availability.', 'ไม่นำหน้าที่ที่อยู่นอกช่วงสอบที่ตั้งไว้ไปใช้เป็นเวลาว่างปัจจุบัน');
    case 'PROCTOR_SOURCE_TERM_MISMATCH': return t('The proctor source belongs to a different academic term from the course source.', 'ไฟล์ผู้คุมสอบมีภาคการศึกษาไม่ตรงกับไฟล์รายวิชา');
    case 'PROCTOR_ASSIGNMENT_SEARCH_EXHAUSTED': return t('Proctor reassignment reached its search limit; remaining shortages are not proven unavoidable.', 'การจัดผู้คุมสอบใหม่ถึงขีดจำกัดการค้นหา ปัญหาผู้คุมที่เหลือยังไม่ได้พิสูจน์ว่าเลี่ยงไม่ได้');
    case 'COMPUTER_PROCTOR_MISSING': return t('A computer room should have at least one computer-tagged proctor.', 'ห้องคอมพิวเตอร์ควรมีผู้คุมสอบที่มีทักษะคอมพิวเตอร์อย่างน้อยหนึ่งคน');
    case 'RESOURCE_SCHEDULING_NOT_IMPLEMENTED': return t('Room and proctor checks are pending because resource scheduling is not available.', 'ยังไม่ตรวจสอบห้องสอบและผู้คุมสอบเนื่องจากการจัดทรัพยากรยังไม่พร้อมใช้งาน');
    case 'NO_EXAM_RULE_VIOLATED': return t('An explicit no-exam rule conflicts with an assignment.', 'การจัดตารางขัดกับเงื่อนไขที่ระบุว่าไม่มีการสอบ');
    case 'INVALID_RULE_CODE': return t('Rule course codes must contain exactly nine digits.', 'รหัสวิชาในเงื่อนไขต้องมีตัวเลขเก้าหลักพอดี');
    case 'STALE_RULE_REFERENCE': return t('The rule refers to a course absent from managed sources.', 'เงื่อนไขอ้างถึงวิชาที่ไม่มีในไฟล์ที่จะจัดอัตโนมัติ');
    case 'DUPLICATE_EVENT': return t('The event ID appears more than once.', 'รหัสรายการสอบปรากฏมากกว่าหนึ่งครั้ง');
    case 'DUPLICATE_ROOM_ASSIGNMENT': return t('A room ID is repeated within this examination.', 'รหัสห้องสอบซ้ำภายในรายการสอบนี้');
    case 'DUPLICATE_PROCTOR_ASSIGNMENT': return t('A proctor ID is repeated within this examination.', 'รหัสผู้คุมสอบซ้ำภายในรายการสอบนี้');
    case 'ROOM_ASSIGNMENT_CARDINALITY': return t('An examination may occupy exactly one room.', 'รายการสอบหนึ่งรายการใช้ห้องสอบได้เพียงหนึ่งห้อง');
    case 'RESOURCE_TIMING_INVALID': return t('Room or proctor assignments require a valid examination date and interval.', 'การจัดห้องหรือผู้คุมสอบต้องมีวันและช่วงเวลาสอบที่ถูกต้อง');
    case 'ROOM_REQUIREMENT_UNSATISFIED': return t('No room is assigned to this scheduled examination.', 'ยังไม่ได้จัดห้องให้รายการสอบที่มีเวลาแล้ว');
    case 'UNKNOWN_PROCTOR': return t('The proctor assignment references a person absent from the roster.', 'การจัดผู้คุมสอบอ้างถึงบุคคลที่ไม่มีในรายชื่อ');
    case 'UNKNOWN_ROOM': return t('The room assignment references a room absent from the room source.', 'การจัดห้องสอบอ้างถึงห้องที่ไม่มีในไฟล์ห้องสอบ');
    case 'PROCTOR_RECORD_CONFLICT': return t('This proctor is described differently across sheets; the later record was kept.', 'ข้อมูลผู้คุมสอบคนนี้แตกต่างกันระหว่างชีต จึงเก็บข้อมูลจากระเบียนหลัง');
    case 'ROOM_PROCTOR_COUNT_MAPPING': return t('The room staffing value is interpreted as the number of proctors required per exam; seat capacity is not checked.', 'ตีความค่าจำนวนคนในข้อมูลห้องเป็นจำนวนผู้คุมสอบที่ต้องการต่อรายการสอบ โดยยังไม่ตรวจสอบความจุที่นั่ง');
    case 'INVALID_COURSE_HEADER': return t('Required course columns are missing.', 'ไม่มีคอลัมน์รายวิชาที่จำเป็น');
    case 'INVALID_ROOM_HEADER': return t('Expected a room table with a room column.', 'ต้องมีตารางห้องสอบที่มีคอลัมน์ห้องสอบ');
    case 'INVALID_RULE_HEADER': return t('Expected the university rule table header.', 'ไม่พบหัวตารางเงื่อนไขของมหาวิทยาลัย');
    case 'MALFORMED_ROOM_PROCTOR_COUNT': return t('The room staffing column must be a whole number.', 'คอลัมน์จำนวนผู้คุมสอบต้องเป็นจำนวนเต็ม');
    case 'DUPLICATE_ROOM': return t('The room name appears in more than one row; the later row was not imported.', 'ชื่อห้องสอบซ้ำหลายแถว จึงไม่นำเข้าแถวหลัง');
    case 'NO_ROOM_RECORDS': return t('The room file contains no room rows.', 'ไฟล์ห้องสอบไม่มีรายการห้อง');
    case 'DUPLICATE_SOURCE': return t('The same course source was supplied more than once; the duplicate was not imported.', 'มีไฟล์รายวิชาเดียวกันมากกว่าหนึ่งครั้ง จึงไม่นำเข้าไฟล์ซ้ำ');
    case 'NO_MANAGED_COURSES': return t('At least one managed course source is required.', 'ต้องมีไฟล์รายวิชาที่จะให้จัดอัตโนมัติอย่างน้อยหนึ่งไฟล์');
    case 'DUPLICATE_ROOM_SOURCE': return t('Only one room file is imported; the later file was ignored.', 'นำเข้าไฟล์ห้องสอบได้เพียงหนึ่งไฟล์ จึงไม่ใช้ไฟล์หลัง');
    case 'DUPLICATE_PROCTOR_SOURCE': return t('Only one proctor file is imported; the later file was ignored.', 'นำเข้าไฟล์ผู้คุมสอบได้เพียงหนึ่งไฟล์ จึงไม่ใช้ไฟล์หลัง');
    case 'SOURCE_ROLE_CONFLICT': return t('A course is present in both managed and context sources.', 'พบวิชาเดียวกันทั้งในไฟล์ที่จะจัดอัตโนมัติและไฟล์ที่จัดเวลาไว้แล้ว');
    case 'COURSE_PREFIX_MISMATCH': return t('The course does not match the declared source prefix.', 'รหัสวิชาไม่ตรงกับคำนำหน้าที่ระบุไว้ของแหล่งข้อมูล');
    case 'NO_COURSE_RECORDS': return t('No recognizable course records were found.', 'ไม่พบรายการวิชาที่อ่านได้');
    case 'MISSING_STUDENT_GROUPS': return t('Student overlap cannot be checked for this section.', 'ไม่สามารถตรวจสอบการซ้อนของกลุ่มนักศึกษาสำหรับตอนเรียนนี้');
    case 'MALFORMED_COURSE_ROW': return t('Expected a nine-digit text course code, course name and integer section.', 'ต้องมีรหัสวิชาแบบข้อความเก้าหลัก ชื่อวิชา และตอนเรียนเป็นจำนวนเต็ม');
    case 'SOURCE_TERM_MISMATCH': return t('The supplied sources belong to different academic terms.', 'ไฟล์ต้นทางที่นำเข้ามีภาคการศึกษาไม่ตรงกัน');
    case 'DUPLICATE_SECTION': return t('The course section appears in more than one source row.', 'ตอนเรียนปรากฏมากกว่าหนึ่งแถวในข้อมูลต้นทาง');
    case 'DUPLICATE_RULE': return t('The repeated rule has no additional scheduling effect.', 'เงื่อนไขที่ซ้ำไม่มีผลเพิ่มเติมต่อการจัดตาราง');
    case 'UNKNOWN_LOCK': return t('A manual lock references an unknown examination.', 'เวลาที่ล็อกไว้อ้างถึงรายการสอบที่ไม่รู้จัก');
    case 'INVALID_INTERVAL': return t('The examination date or time interval is invalid.', 'วันหรือช่วงเวลาสอบไม่ถูกต้อง');
    case 'LOCK_NOT_SATISFIED': return t('The manual lock is invalid or was not preserved.', 'เวลาที่ล็อกไว้ไม่ถูกต้องหรือไม่ได้รับการรักษาไว้');
    case 'FIXED_TIMING_CHANGED': return t('Imported or locked timing must be preserved exactly.', 'ต้องรักษาเวลาจากไฟล์ต้นทางหรือเวลาที่ล็อกไว้ให้ตรงเดิม');
    case 'MISSING_EVENT': return t('A canonical examination event is missing from the schedule.', 'รายการสอบตามแบบจำลองต้นทางหายไปจากตาราง');
    case 'UNEXPECTED_EVENT': return t('The event is not defined by the source model.', 'รายการสอบนี้ไม่มีอยู่ในแบบจำลองต้นทาง');
    case 'EVENT_MODEL_CHANGED': {
      const field = message.match(/^Event (.+?) differs/)?.[1] ?? 'field';
      return t(`Event ${field} differs from the canonical source model.`, `ข้อมูล ${field} ของรายการสอบไม่ตรงกับแบบจำลองต้นทาง`);
    }
    case 'EXCLUDED_EXAM_GENERATED': return t('An excluded examination was generated centrally.', 'มีการจัดรายการสอบที่ถูกยกเว้นเข้าสู่ตารางกลาง');
    case 'UNSCHEDULED_REQUIRED_EXAM': return t('A required examination remains unscheduled.', 'รายการสอบที่จำเป็นยังไม่ได้จัดตาราง');
    case 'OUTSIDE_PERIOD': return t('A managed examination lies outside its configured period.', 'รายการสอบที่จัดอยู่นอกช่วงสอบที่ตั้งไว้');
    case 'FULL_DAY_REQUIRED': return t('The examination must use the configured full-day interval.', 'รายการสอบต้องใช้ช่วงเวลาเต็มวันที่ตั้งไว้');
    case 'NONSTANDARD_GENERATED_INTERVAL': return t('The generated examination does not use a configured session.', 'รายการสอบที่จัดอัตโนมัติไม่ได้ใช้ช่วงเวลาที่ตั้งไว้');
    case 'SOURCE_DATA_INVALID': return t('Contradictory rules, missing groups or invalid section timings require reconciliation.', 'เงื่อนไขขัดแย้ง กลุ่มนักศึกษาหายไป หรือเวลาตอนเรียนไม่ถูกต้อง ต้องตรวจสอบและแก้ไข');
    case 'SAME_TIME_CONTRADICTION': return t('Same-time courses share student groups and cannot run simultaneously.', 'วิชาที่ต้องสอบพร้อมกันมีกลุ่มนักศึกษาร่วมกัน จึงจัดสอบพร้อมกันไม่ได้');
    case 'SAME_TIME_NOT_SATISFIED': return t('Same-time events must all share one exact timing.', 'รายการสอบในกลุ่มสอบพร้อมกันต้องใช้วันและเวลาเดียวกัน');
    case 'SAME_TIME_GROUP_PARTIALLY_STALE': return t('Only active managed courses participate in this same-time group.', 'เฉพาะวิชาที่จะจัดอัตโนมัติและยังใช้งานอยู่เท่านั้นที่เข้าร่วมกลุ่มสอบพร้อมกัน');
    case 'HOLIDAYS_NOT_CONFIGURED': return t('No holiday dates were supplied. Institutional and public holidays are not inferred automatically.', 'ยังไม่ได้ระบุวันหยุด ระบบไม่อนุมานวันหยุดของมหาวิทยาลัยหรือวันหยุดราชการโดยอัตโนมัติ');
    default: return t('Validation finding. See the source evidence for details.', 'พบข้อค้นพบ กรุณาดูหลักฐานจากไฟล์ต้นทางเพื่อดูรายละเอียด');
  }
};
export const severityLabel = (value: string) => value === 'error' ? t('Error', 'ข้อผิดพลาด') : value === 'warning' ? t('Warning', 'คำเตือน') : t('Info', 'ข้อมูล');
export const originLabel = (origin: ValidationIssue['origin']) => ({ source: t('Source', 'ต้นทาง'), generated: t('Generated', 'ผลการจัด'), manual: t('Manual', 'แก้ไขเอง'), resource: t('Resource', 'ทรัพยากร') })[origin];
