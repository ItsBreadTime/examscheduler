import type { ExamEvent, ExamTiming, Project, ValidationReport } from './types.ts';
import { compare, dates, sameTiming, weekend } from './time.ts';
import { reconcileRules } from './rules.ts';
import { assignResources } from './resources.ts';
import type { ResourceSummary } from './resources.ts';
import { validateProject } from './validator.ts';

export interface RepairAttempt { eventId: string; from: string; to: string; accepted: boolean; reason?: string }
export interface RepairResult {
  project: Project; validation: ValidationReport; attempts: RepairAttempt[];
  failuresBefore: number; failuresAfter: number; budgetExhausted: boolean; summary: ResourceSummary;
}
const failures = (summary: ResourceSummary) => summary.roomsUnassigned + summary.positionsUnfilled;
const timingKey = (t?: ExamTiming) => t ? `${t.date} ${t.startMinutes}-${t.endMinutes}` : 'unscheduled';
/**
 * Plan §8/§37: time scheduling and resource allocation stay separate phases. When resources fail
 * (no free room, unfilled proctor positions), the repair engine tries bounded local timing moves
 * of flexible managed exams and reassigns resources. A move is accepted only when it reduces
 * resource failures without creating a student-group conflict or breaking the same-time rules.
 */
export function repairResources(input: Project): RepairResult {
  let current = assignResources(input);
  let project = current.project;
  const before = failures(current.summary);
  const attempts: RepairAttempt[] = [];
  const { settings } = project;
  const budget = Math.min(settings.searchBudget, 200);
  let spent = 0;
  const groups = reconcileRules(project.rules, project.sections).groups;
  /** A repairable unit: a single generated event or a whole same-time group, with no manual or imported member. */
  const flexibleMembers = (event: ExamEvent): ExamEvent[] | null => {
    if (event.ownership !== 'managed' || event.timingOrigin !== 'generated' || project.locks[event.id]) return null;
    const group = groups.find(g => g.examType === event.examType && g.courseCodes.includes(event.courseCode));
    const members = project.events.filter(e => e.ownership === 'managed' && e.examType === event.examType && (group ? group.courseCodes.includes(e.courseCode) : e.id === event.id) && (e.timing || e.required));
    return members.every(m => m.timingOrigin === 'generated' && !project.locks[m.id]) ? members : null;
  };
  const shapeOk = (event: ExamEvent, t: ExamTiming) => (event.fullDay ? (t.startMinutes === settings.fullDay.startMinutes && t.endMinutes === settings.fullDay.endMinutes) : settings.sessions.some(s => s.startMinutes === t.startMinutes && s.endMinutes === t.endMinutes)) && !(settings.weekendPolicy === 'never' && weekend(t.date)) && !(settings.holidayPolicy === 'never' && settings.holidays.includes(t.date));
  for (;;) {
    const failing = project.events
      .filter(e => e.ownership === 'managed' && e.timing && flexibleMembers(e) && (!e.roomAssignments.length && project.rooms.length || e.proctorAssignments.length < (project.rooms.find(r => r.id === e.roomAssignments[0])?.proctorsRequired ?? 0)))
      .sort((a, b) => compare(a.id, b.id));
    if (!failing.length || spent >= budget) break;
    let moved: { event: ExamEvent; members: ExamEvent[] } | null = null;
    for (const event of failing) {
      if (spent >= budget) break;
      const members = flexibleMembers(event)!;
      const ids = new Set(members.map(m => m.id));
      const period = settings.periods[event.examType];
      const candidates = dates(period.start, period.end)
        .flatMap(date => (event.fullDay ? [settings.fullDay] : settings.sessions).map(t => ({ date, ...t })))
        .filter(t => shapeOk(event, t) && !sameTiming(t, event.timing) && !(settings.weekendPolicy === 'only_if_necessary' && weekend(t.date)) && !(settings.holidayPolicy === 'only_if_necessary' && settings.holidays.includes(t.date)))
        .sort((a, b) => Number(weekend(a.date)) - Number(weekend(b.date)) || compare(a.date, b.date) || a.startMinutes - b.startMinutes);
      for (const candidate of candidates) {
        spent++;
        const trialProject = structuredClone(project);
        for (const member of trialProject.events.filter(e => ids.has(e.id))) { member.timing = { ...candidate }; member.roomAssignments = []; member.proctorAssignments = []; }
        const trial = assignResources(trialProject);
        const blocking = trial.validation.issues.filter(i => i.blocking && i.origin !== 'resource' && i.eventIds.some(id => ids.has(id)));
        const accepted = !blocking.length && failures(trial.summary) < failures(current.summary);
        attempts.push({ eventId: event.id, from: timingKey(event.timing), to: timingKey(candidate), accepted, reason: blocking.length ? 'student conflict' : undefined });
        if (accepted) { project = trial.project; current = trial; moved = { event, members }; break; }
      }
      if (moved) break;
    }
    if (!moved) break;
  }
  return { project, validation: validateProject(project), attempts, failuresBefore: before, failuresAfter: failures(current.summary), budgetExhausted: spent >= budget, summary: current.summary };
}
