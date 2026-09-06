import type { CourseExamRule, ExamType, SameTimeGroup, Section, ValidationIssue } from './types.ts';
import type { Spreadsheet } from './import/spreadsheet.ts';
import { compare, normalize, unique } from './time.ts';
import { issue } from './issues.ts';
export function parseRules(input: Spreadsheet) {
  const rules: CourseExamRule[] = [], issues: ValidationIssue[] = [];
  for (const sheet of input.sheets) {
    let header: string[] | undefined;
    for (const [i, row] of sheet.rows.entries()) {
      const cells = row.map(normalize);
      if (cells.some(c => c.includes('ไม่มีสอบกลางภาค'))) { header = cells; continue; }
      if (!cells.some(Boolean)) continue;
      if (!header) { issues.push(issue('INVALID_RULE_HEADER', 'Expected the university rule table header', { sourceRefs: [{ artifactId: input.artifact.id, sheet: sheet.name, row: i + 1 }] })); continue; }
      const sameIndex = header.findIndex(h => h.includes('ตรงกัน'));
      for (let c = 0; c < header.length; c++) {
        if (!cells[c] || (sameIndex >= 0 && c > sameIndex)) continue;
        const label = header[c];
        const sourceRef = { artifactId: input.artifact.id, sheet: sheet.name, row: i + 1, column: c + 1 };
        const base = { courseCodes: [cells[c]], sourceRef };
        if (c === sameIndex) rules.push({ ...base, courseCodes: cells.slice(c).filter(Boolean), action: 'same_time' });
        else if (label.includes('ไม่มีสอบกลางภาค')) rules.push({ ...base, action: 'exclude_from_central_schedule', examType: 'midterm' });
        else if (label.includes('ไม่มีสอบปลายภาค')) rules.push({ ...base, action: 'no_exam', examType: 'final' });
        else if (label === 'ไม่มีสอบ') rules.push({ ...base, action: 'no_exam' });
        else if (label.includes('สองช่วง')) rules.push({ ...base, action: 'full_day' });
        else issues.push(issue('UNKNOWN_RULE_COLUMN', `Unrecognized rule column: ${label}`, { sourceRefs: [sourceRef] }));
      }
    }
  }
  return { rules, issues };
}
export const applies = (r: CourseExamRule, code: string, type: ExamType) => r.courseCodes.includes(code) && (!r.examType || r.examType === type);
export function reconcileRules(rules: CourseExamRule[], sections: Section[]) {
  const active = new Set(sections.filter(s => s.sourceRole === 'managed').map(s => s.courseCode));
  const issues: ValidationIssue[] = [], groups: SameTimeGroup[] = [];
  const references: { courseCode: string; status: string; sourceRef: CourseExamRule['sourceRef'] }[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    const key = `${r.action}:${r.examType ?? '*'}:${unique(r.courseCodes).join(',')}`;
    const duplicate = seen.has(key); seen.add(key);
    if (duplicate) issues.push(issue('DUPLICATE_RULE', 'Repeated rule has no additional scheduling effect', { severity: 'info', blocking: false, courseCodes: r.courseCodes, sourceRefs: [r.sourceRef] }));
    for (const code of unique(r.courseCodes)) {
      const status = !/^\d{9}$/.test(code) ? 'invalid_code' : !active.has(code) ? 'missing_course' : duplicate ? 'duplicate' : 'active';
      references.push({ courseCode: code, status, sourceRef: r.sourceRef });
      if (status === 'invalid_code' || status === 'missing_course') issues.push(issue(status === 'invalid_code' ? 'INVALID_RULE_CODE' : 'STALE_RULE_REFERENCE', status === 'invalid_code' ? 'Rule course codes must contain exactly nine digits' : 'Rule refers to a course absent from managed sources', { severity: 'warning', blocking: false, courseCodes: [code], sourceRefs: [r.sourceRef] }));
    }
    if (r.action === 'same_time' && r.courseCodes.some(c => active.has(c)) && r.courseCodes.some(c => !active.has(c))) issues.push(issue('SAME_TIME_GROUP_PARTIALLY_STALE', 'Only active managed courses participate in this same-time group', { severity: 'warning', blocking: false, courseCodes: r.courseCodes, sourceRefs: [r.sourceRef] }));
  }
  for (const type of ['midterm', 'final'] as ExamType[]) {
    const graph = new Map<string, Set<string>>();
    const sameRules = rules.filter(r => r.action === 'same_time' && (!r.examType || r.examType === type));
    // Normalize the entire valid graph first, then project onto active courses.
    for (const r of sameRules) {
      const codes = unique(r.courseCodes.filter(c => /^\d{9}$/.test(c)));
      for (const code of codes) { if (!graph.has(code)) graph.set(code, new Set()); for (const other of codes) graph.get(code)!.add(other); }
    }
    const visited = new Set<string>();
    for (const start of [...graph.keys()].sort(compare)) {
      if (visited.has(start)) continue;
      const component: string[] = [], queue = [start];
      while (queue.length) { const code = queue.pop()!; if (visited.has(code)) continue; visited.add(code); component.push(code); queue.push(...graph.get(code)!); }
      const codes = component.filter(c => active.has(c)).sort(compare);
      if (codes.length > 1) groups.push({ examType: type, courseCodes: codes, sourceRefs: sameRules.filter(r => r.courseCodes.some(c => component.includes(c))).map(r => r.sourceRef) });
    }
    for (const code of [...active].sort(compare)) {
      const relevant = rules.filter(r => applies(r, code, type));
      const excluded = relevant.some(r => ['no_exam', 'exclude_from_central_schedule'].includes(r.action));
      if (excluded && relevant.some(r => r.action === 'full_day' || r.action === 'same_time')) {
        issues.push(issue('CONTRADICTORY_RULES', `${type} is both excluded and constrained to an examination`, { courseCodes: [code], sourceRefs: relevant.map(r => r.sourceRef) }));
        references.filter(r => r.courseCode === code && r.status === 'active').forEach(r => { r.status = 'contradictory'; });
      }
    }
  }
  return { groups, issues, references };
}
