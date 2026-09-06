import type { ExamEvent, ExamType, Project, SchedulerSettings, Section } from './types.ts';
/** Known seat demand of an event: registered enrollment first, planned as fallback, never invented. */
export const eventEnrollment = (sections: Section[], event: Pick<ExamEvent, 'sectionIds'>) => sections
  .filter(s => event.sectionIds.includes(s.id))
  .reduce((sum, s) => sum + (s.registeredEnrollment ?? s.plannedEnrollment ?? 0), 0);
import { applies, reconcileRules } from './rules.ts';
import { compare, dates, sameTiming, unique, validDate, validInterval } from './time.ts';
export function assertSettings(settings: SchedulerSettings) {
  for (const type of ['midterm', 'final'] as ExamType[]) dates(settings.periods[type].start, settings.periods[type].end);
  if (!settings.sessions.length || !settings.sessions.every(validInterval) || !validInterval(settings.fullDay)) throw new Error('Sessions must be valid time intervals');
  if (!['never', 'only_if_necessary', 'normal'].includes(settings.weekendPolicy)) throw new Error('Invalid weekend policy');
  if (!['never', 'only_if_necessary', 'normal'].includes(settings.holidayPolicy) || !settings.holidays.every(validDate)) throw new Error('Invalid holiday policy or holiday dates');
  if (!Number.isInteger(settings.searchBudget) || settings.searchBudget < 1 || settings.searchBudget > 1000000) throw new Error('Search budget must be an integer from 1 to 1000000');
}
export function defaultSettings(midterm: { start: string; end: string }, final: { start: string; end: string }): SchedulerSettings {
  return { periods: { midterm, final }, sessions: [{ startMinutes: 540, endMinutes: 720 }, { startMinutes: 780, endMinutes: 960 }], fullDay: { startMinutes: 540, endMinutes: 960 }, weekendPolicy: 'only_if_necessary', holidays: [], holidayPolicy: 'only_if_necessary', searchBudget: 20000 };
}
export function buildEvents(project: Pick<Project, 'sections' | 'rules' | 'locks'>): ExamEvent[] {
  const buckets = new Map<string, Section[]>();
  for (const section of project.sections) {
    const key = `${section.sourceRole}:${section.courseCode}`;
    if (!buckets.has(key)) buckets.set(key, []); buckets.get(key)!.push(section);
  }
  const events: ExamEvent[] = [];
  const sameGroups = reconcileRules(project.rules, project.sections).groups;
  for (const [key, sections] of [...buckets].sort(([a], [b]) => compare(a, b))) {
    const first = sections[0];
    for (const type of ['midterm', 'final'] as ExamType[]) {
      const relevant = first.sourceRole === 'managed' ? project.rules.filter(r => applies(r, first.courseCode, type)) : [];
      const excluded = relevant.some(r => ['no_exam', 'exclude_from_central_schedule'].includes(r.action));
      const linkedCodes = sameGroups.find(g => g.examType === type && g.courseCodes.includes(first.courseCode))?.courseCodes ?? [first.courseCode];
      const fullDay = first.sourceRole === 'managed' && project.rules.some(r => r.action === 'full_day' && linkedCodes.some(code => applies(r, code, type)));
      // Context sections with differing imported times remain distinct events.
      const parts: Section[][] = [];
      if (first.sourceRole === 'context') {
        for (const section of sections) {
          if (!section.exams[type]) continue;
          const part = parts.find(p => sameTiming(p[0].exams[type], section.exams[type]));
          if (part) part.push(section); else parts.push([section]);
        }
        parts.sort((a, b) => compare(JSON.stringify(a[0].exams[type]), JSON.stringify(b[0].exams[type])));
      } else parts.push(sections);
      for (const part of parts) {
        const timings = part.flatMap(s => s.exams[type] ? [s.exams[type]!] : []);
        const id = `${key}:${type}${first.sourceRole === 'context' ? `:${timings[0].date}:${timings[0].startMinutes}:${timings[0].endMinutes}` : ''}`;
        const inconsistent = timings.some(t => !sameTiming(t, timings[0]));
        const imported = timings[0];
        const lock = project.locks[id];
        events.push({ id, courseCode: first.courseCode, examType: type, sectionIds: part.map(s => s.id).sort(compare), studentGroups: unique(part.flatMap(s => s.studentGroups)),
          ownership: first.sourceRole, timing: imported || lock ? { ...(imported ?? lock)! } : undefined, timingOrigin: imported ? 'imported' : lock ? 'manual' : 'generated',
          roomAssignments: [], proctorAssignments: [], sourceRefs: part.map(s => s.sourceRef), required: first.sourceRole === 'managed' && !excluded,
          fullDay, blocked: inconsistent || part.some(s => s.invalidExams.includes(type) || !s.studentGroups.length) || (excluded && relevant.some(r => r.action === 'full_day' || r.action === 'same_time')),
        });
      }
    }
  }
  return events.sort((a, b) => compare(a.id, b.id));
}
