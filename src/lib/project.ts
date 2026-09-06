import type { AcademicTerm, Project, SchedulerSettings, SourceRole, ValidationIssue } from './types.ts';
import { readSpreadsheet } from './import/spreadsheet.ts';
import { detectTerm, parseCourses } from './import/courses.ts';
import { parseRules } from './rules.ts';
import { parseRooms } from './import/rooms.ts';
import { parseProctors } from './import/proctors.ts';
import { assertSettings, buildEvents } from './model.ts';
import { issue } from './issues.ts';
import { dates, weekend } from './time.ts';
import { validateProject } from './validator.ts';
export interface InputFile { name: string; bytes: Uint8Array }
export interface ProjectInput {
  courseSources: (InputFile & { role: SourceRole; expectedPrefix?: string })[];
  rules?: InputFile; references?: (InputFile & { kind: 'rooms' | 'proctors' })[];
  settings: SchedulerSettings; locks?: Project['locks']; importedAt?: string;
}
function sameAcademicTerm(a: AcademicTerm, b: AcademicTerm): boolean {
  return a.academicYearBE === b.academicYearBE && a.semester === b.semester;
}
export async function importProject(input: ProjectInput): Promise<Project> {
  assertSettings(input.settings);
  const project: Project = { schemaVersion: 1, artifacts: [], sections: [], rules: [], importIssues: [], settings: structuredClone(input.settings), events: [], locks: structuredClone(input.locks ?? {}), rooms: [], proctors: [] };
  for (const source of input.courseSources) {
    const workbook = await readSpreadsheet(source.bytes, source.name, 'course', input.importedAt);
    if (project.artifacts.some(a => a.id === workbook.artifact.id)) { project.importIssues.push(issue('DUPLICATE_SOURCE', 'The same course source was supplied more than once; duplicate was not imported', { sourceRefs: [{ artifactId: workbook.artifact.id }] })); continue; }
    const parsed = parseCourses(workbook, source.role, source.expectedPrefix);
    project.artifacts.push(parsed.artifact); project.sections.push(...parsed.sections); project.importIssues.push(...parsed.issues);
  }
  if (input.rules) {
    const workbook = await readSpreadsheet(input.rules.bytes, input.rules.name, 'rules', input.importedAt);
    const parsed = parseRules(workbook); project.rules = parsed.rules; project.importIssues.push(...parsed.issues); project.artifacts.push(workbook.artifact);
  }
  if (!project.sections.some(s => s.sourceRole === 'managed')) project.importIssues.push(issue('NO_MANAGED_COURSES', 'At least one managed course source is required'));
  const roles = new Map<string, Set<string>>();
  const sectionKeys = new Set<string>();
  for (const section of project.sections) {
    if (!roles.has(section.courseCode)) roles.set(section.courseCode, new Set()); roles.get(section.courseCode)!.add(section.sourceRole);
    const key = `${section.sourceRole}:${section.courseCode}:${section.sectionNumber}`;
    if (sectionKeys.has(key)) project.importIssues.push(issue('DUPLICATE_SECTION', 'Course section appears in more than one source row', { courseCodes: [section.courseCode], sourceRefs: [section.sourceRef] }));
    sectionKeys.add(key);
  }
  for (const [code, found] of roles) if (found.size > 1) project.importIssues.push(issue('SOURCE_ROLE_CONFLICT', 'Course is present in managed and context sources', { courseCodes: [code], sourceRefs: project.sections.filter(s => s.courseCode === code).map(s => s.sourceRef) }));
  const courseTerms = project.artifacts.filter(a => a.kind === 'course' && a.term).map(a => a.term!);
  for (const reference of input.references ?? []) {
    const workbook = await readSpreadsheet(reference.bytes, reference.name, reference.kind, input.importedAt);
    workbook.artifact.term = detectTerm(workbook.sheets.flatMap(s => s.rows.flat()).join(' '));
    project.artifacts.push(workbook.artifact);
    const sourceTerm = workbook.artifact.term;
    const termMismatch = !!sourceTerm && courseTerms.some(courseTerm => !sameAcademicTerm(courseTerm, sourceTerm));
    if (termMismatch) project.importIssues.push(issue(reference.kind === 'proctors' ? 'PROCTOR_SOURCE_TERM_MISMATCH' : 'SOURCE_TERM_MISMATCH', reference.kind === 'proctors'
      ? 'Proctor roster belongs to a different academic term; roster entries are ineligible for assignment and dated availability is quarantined'
      : 'Reference resource belongs to a different academic term; dated availability is not interpreted', { severity: 'warning', blocking: false, sourceRefs: [{ artifactId: workbook.artifact.id }] }));
    if (reference.kind === 'rooms') {
      if (project.rooms.length) { project.importIssues.push(issue('DUPLICATE_ROOM_SOURCE', 'Only one room file is imported; the later file was ignored', { sourceRefs: [{ artifactId: workbook.artifact.id }] })); continue; }
      const parsed = parseRooms(workbook);
      project.rooms = parsed.rooms; project.importIssues.push(...parsed.issues);
    } else {
      if (project.proctors.length) { project.importIssues.push(issue('DUPLICATE_PROCTOR_SOURCE', 'Only one proctor file is imported; the later file was ignored', { sourceRefs: [{ artifactId: workbook.artifact.id }] })); continue; }
      const parsed = parseProctors(workbook);
      const termCompatible = !termMismatch;
      const eligibility = {
        eligible: termCompatible,
        ...(sourceTerm ? { sourceTerm } : {}),
        ...(termCompatible ? {} : { reason: 'Proctor source belongs to a different academic term' }),
      };
      // Keep the roster visible for correction and audit, but make a known
      // wrong-term source ineligible until the operator reimports the current roster.
      project.proctors = parsed.proctors.map(proctor => ({ ...proctor, assignmentEligibility: eligibility }));
      project.importIssues.push(...parsed.issues);
      // Plan §33: dated duties inside a configured exam period become unavailability; anything older is quarantined.
      const inPeriod = (date: string) => (['midterm', 'final'] as const).some(t => { const p = project.settings.periods[t]; return date >= p.start && date <= p.end; });
      for (const duty of parsed.duties.filter(d => termCompatible && inPeriod(d.date))) project.proctors.find(p => p.id === duty.proctorId)?.availability.push({ available: false, date: duty.date, interval: duty.interval, sourceRef: duty.sourceRef });
      if (!termCompatible && parsed.matrixDates.length) project.importIssues.push(issue('PROCTOR_MATRIX_QUARANTINED', `The dated duty matrix (${parsed.matrixDates[0]} to ${parsed.matrixDates[parsed.matrixDates.length - 1]}) belongs to a different academic term and was not interpreted as current availability`, { severity: 'warning', blocking: false, sourceRefs: [{ artifactId: workbook.artifact.id }] }));
      else if (parsed.matrixDates.length && !parsed.matrixDates.some(inPeriod)) project.importIssues.push(issue('PROCTOR_MATRIX_QUARANTINED', `The dated duty matrix (${parsed.matrixDates[0]} to ${parsed.matrixDates[parsed.matrixDates.length - 1]}) belongs to a different exam period and was not interpreted as current availability`, { severity: 'warning', blocking: false, sourceRefs: [{ artifactId: workbook.artifact.id }] }));
      else if (parsed.duties.some(d => !inPeriod(d.date))) project.importIssues.push(issue('PROCTOR_MATRIX_QUARANTINED', 'Dated duties outside the configured exam periods were not interpreted as current availability', { severity: 'warning', blocking: false, sourceRefs: [{ artifactId: workbook.artifact.id }] }));
    }
  }
  project.events = buildEvents(project);
  return project;
}
/** Run during file input, before generation. Missing managed timings are expected here. */
export function inspectImport(project: Project) {
  const validation = validateProject(project);
  const issues: ValidationIssue[] = validation.issues.filter(i => i.type !== 'UNSCHEDULED_REQUIRED_EXAM' && i.type !== 'SAME_TIME_NOT_SATISFIED');
  const calendar = Object.entries(project.settings.periods).map(([examType, period]) => {
    const days = dates(period.start, period.end);
    return { examType, weekendDates: days.filter(weekend), holidayDates: days.filter(d => project.settings.holidays.includes(d)), weekendPolicy: project.settings.weekendPolicy, holidayPolicy: project.settings.holidayPolicy };
  });
  if (!project.settings.holidays.length) issues.push(issue('HOLIDAYS_NOT_CONFIGURED', 'No holiday dates were supplied. Institutional and public holidays are not inferred automatically.', { severity: 'warning', blocking: false }));
  return { sources: project.artifacts.map(a => ({ ...a, sectionCount: project.sections.filter(s => s.sourceRef.artifactId === a.id).length, courseCount: new Set(project.sections.filter(s => s.sourceRef.artifactId === a.id).map(s => s.courseCode)).size })), calendar, issues };
}
