import type { AcademicTerm, ExamType, Section, SourceRole, ValidationIssue } from '../types.ts';
import type { Spreadsheet } from './spreadsheet.ts';
import { normalize, parseDate, parseInterval, unique } from '../time.ts';
import { issue } from '../issues.ts';
export function detectTerm(text: string): AcademicTerm | undefined {
  const m = /ภาค(?:การ)?ศึกษาที่\s*(\d+)\s*\/\s*(\d{4})/.exec(text) ?? /ภาคเรียนที่\s*(\d+)\s*ปีการศึกษา\s*(\d{4})/.exec(text);
  return m ? { semester: +m[1], academicYearBE: +m[2], campus: /วิทยาเขต([^\s]+)/.exec(text)?.[1] } : undefined;
}
export function parseCourses(input: Spreadsheet, role: SourceRole, expectedPrefix?: string) {
  if (!['managed', 'context'].includes(role)) throw new Error('Course source role must be managed or context');
  const sections: Section[] = [], issues: ValidationIssue[] = [];
  const terms: AcademicTerm[] = [];
  for (const sheet of input.sheets) {
    let columns: Record<string, number> | undefined;
    let code = '', name = '', faculty = '', department = '';
    for (const [index, row] of sheet.rows.entries()) {
      const cells = row.map(c => normalize(String(c))), joined = cells.join(' ');
      if (joined.includes('ตารางสอน-สอบปัจจุบัน (REG-')) { columns = undefined; code = ''; name = ''; continue; }
      const term = detectTerm(joined); if (term) terms.push(term);
      const heading = cells.find(c => c.startsWith('คณะ'));
      if (heading) { faculty = heading; department = cells.find(c => c.startsWith('ภาควิชา')) ?? ''; code = ''; name = ''; columns = undefined; continue; }
      const at = (label: string) => cells.indexOf(label);
      if (at('รหัสวิชา') >= 0 || at('courseCode') >= 0) {
        const thai = at('รหัสวิชา') >= 0;
        columns = Object.fromEntries(Object.entries(thai ? {
          code: 'รหัสวิชา', name: 'ชื่อวิชา', section: 'ตอน', groups: 'กลุ่มนักศึกษา', midterm: 'สอบกลางภาค', final: 'สอบปลายภาค',
          planned: 'จำนวน นศ.', registered: '__none', day: 'วัน', time: 'เวลาเรียน', room: 'สถานที่', instructors: 'อาจารย์ผู้สอน',
        } : { code: 'courseCode', name: 'courseName', section: 'sectionNumber', groups: 'studentGroups', midterm: 'midtermDate', final: 'finalDate', planned: 'plannedEnrollment', registered: 'registeredEnrollment', day: 'teachingDay', time: 'teachingTime', room: 'teachingRoom', instructors: 'instructors' }).map(([key, label]) => [key, at(label)]));
        columns.midtermTime = thai ? columns.midterm + 1 : at('midtermTime');
        columns.finalTime = thai ? columns.final + 1 : at('finalTime');
        if (thai) columns.registered = columns.planned + 1;
        if (['code', 'name', 'section', 'groups'].some(k => columns![k] < 0)) { issues.push(issue('INVALID_COURSE_HEADER', 'Required course columns are missing', { sourceRefs: [{ artifactId: input.artifact.id, sheet: sheet.name, row: index + 1 }] })); columns = undefined; }
        continue;
      }
      if (!columns) continue;
      const get = (key: string) => cells[columns![key]] ?? '';
      // Ignore blank lines and the Thai export's secondary column headings.
      if (!joined.trim() || (!get('code') && !get('section'))) continue;
      const sourceRef = { artifactId: input.artifact.id, sheet: sheet.name, row: index + 1 };
      if (get('code')) { code = get('code'); name = get('name'); }
      else if (get('name')) name = get('name');
      if (!/^\d{9}$/.test(code) || !/^\d+$/.test(get('section')) || !name) {
        issues.push(issue('MALFORMED_COURSE_ROW', 'Expected a nine-digit text course code, course name and integer section', { courseCodes: [code], sourceRefs: [sourceRef] })); continue;
      }
      if (expectedPrefix && !code.startsWith(expectedPrefix)) issues.push(issue('COURSE_PREFIX_MISMATCH', 'Course does not match the declared source prefix', { courseCodes: [code], sourceRefs: [sourceRef] }));
      const count = (key: string) => /^\d+$/.test(get(key)) ? Number(get(key)) : undefined;
      const rawStudentGroups = row[columns.groups] ?? '';
      const section: Section = {
        id: `${input.artifact.id}:${sheet.name}:${index + 1}`, courseCode: code, courseName: name, sectionNumber: Number(get('section')),
        rawStudentGroups, studentGroups: unique(rawStudentGroups.split(/[\n\r;,]+/).map(normalize).filter(Boolean)), faculty, department,
        plannedEnrollment: count('planned'), registeredEnrollment: count('registered'), teachingDay: get('day'), teachingTime: get('time'), teachingRoom: get('room'),
        instructors: unique((row[columns.instructors] ?? '').split(/[\r\n]+/).map(normalize).filter(Boolean)), sourceRole: role, sourceRef, exams: {}, invalidExams: [],
      };
      if (!section.studentGroups.length) issues.push(issue('MISSING_STUDENT_GROUPS', 'Student overlap cannot be checked for this section', { courseCodes: [code], sourceRefs: [sourceRef] }));
      for (const type of ['midterm', 'final'] as ExamType[]) {
        const d = get(type), t = get(`${type}Time`);
        if (!d && !t) continue;
        const date = parseDate(d), interval = parseInterval(t);
        if (date && interval) section.exams[type] = { date, ...interval };
        else { section.invalidExams.push(type); issues.push(issue('INVALID_EXAM_TIMING', `Cannot parse ${type} timing: ${d} ${t}`, { courseCodes: [code], sourceRefs: [{ ...sourceRef, field: type, column: columns[type] + 1 }] })); }
      }
      sections.push(section);
    }
  }
  if (!sections.length) issues.push(issue('NO_COURSE_RECORDS', 'No recognizable course records were found', { sourceRefs: [{ artifactId: input.artifact.id }] }));
  if (terms.length) input.artifact.term = terms[0];
  if (terms.some(t => t.semester !== terms[0].semester || t.academicYearBE !== terms[0].academicYearBE)) issues.push(issue('SOURCE_TERM_MISMATCH', 'Workbook contains multiple academic terms', { sourceRefs: [{ artifactId: input.artifact.id }] }));
  return { artifact: input.artifact, sections, issues };
}
