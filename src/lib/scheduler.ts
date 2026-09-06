import type { ExamEvent, ExamTiming, Project, UnscheduledReason } from './types.ts';
import { assertSettings, buildEvents } from './model.ts';
import { reconcileRules } from './rules.ts';
import { compare, dates, sameTiming, timingsOverlap, unique, validTiming, weekend } from './time.ts';
import { scheduleQuality } from './quality.ts';
import { validateProject } from './validator.ts';
import { solveUnits } from './solver.ts';
interface Unit { id: string; members: ExamEvent[]; groups: string[]; candidates: ExamTiming[]; reason?: UnscheduledReason['reason']; totalCandidates: number }
export function scheduleProject(input: Project) {
  assertSettings(input.settings);
  const project = structuredClone(input);
  project.events = buildEvents(project);
  const { settings } = project;
  const fixed = project.events.filter(e => e.timing);
  const units: Unit[] = [], claimed = new Set<string>();
  const makeUnit = (members: ExamEvent[]) => {
    members.forEach(e => claimed.add(e.id));
    if (!members.some(e => e.required && !e.timing)) return;
    const required = members.filter(e => e.required || e.timing);
    const unit: Unit = { id: members.map(e => e.id).sort(compare).join('+'), members, groups: unique(members.flatMap(e => e.studentGroups)), candidates: [], totalCandidates: 0 };
    const period = settings.periods[members[0].examType];
    const fullDay = members.some(e => e.fullDay);
    const locked = members.filter(e => e.timing);
    let candidates: ExamTiming[];
    if (locked.length) candidates = [locked[0].timing!];
    else candidates = dates(period.start, period.end).flatMap(date => (fullDay ? [settings.fullDay] : settings.sessions).map(t => ({ date, ...t })));
    candidates = candidates.filter(t => validTiming(t) && t.date >= period.start && t.date <= period.end && !(settings.weekendPolicy === 'never' && weekend(t.date)) && !(settings.holidayPolicy === 'never' && settings.holidays.includes(t.date)) && (fullDay ? (t.startMinutes === settings.fullDay.startMinutes && t.endMinutes === settings.fullDay.endMinutes) : settings.sessions.some(s => s.startMinutes === t.startMinutes && s.endMinutes === t.endMinutes)));
    candidates = [...new Map(candidates.map(t => [`${t.date}:${t.startMinutes}:${t.endMinutes}`, t])).values()];
    unit.totalCandidates = candidates.length;
    const sharedWithin = required.some((a, i) => required.slice(i + 1).some(b => a.studentGroups.some(g => b.studentGroups.includes(g))));
    const inconsistentLocks = locked.some(e => !sameTiming(e.timing, locked[0].timing));
    if (sharedWithin || inconsistentLocks || members.some(e => !e.required && !e.timing)) unit.reason = 'SAME_TIME_CONTRADICTION';
    else if (members.some(e => e.blocked) || project.sections.some(s => s.invalidExams.includes(members[0].examType) && s.studentGroups.some(g => unit.groups.includes(g)))) unit.reason = 'SOURCE_DATA_INVALID';
    else if (!candidates.length) unit.reason = 'NO_CANDIDATES';
    const memberIds = new Set(members.map(e => e.id));
    const memberSections = new Set(members.flatMap(e => e.sectionIds));
    unit.candidates = candidates.filter(t => !fixed.some(e => !memberIds.has(e.id) && e.studentGroups.some(g => unit.groups.includes(g)) && timingsOverlap(e.timing!, t)) && !project.sections.some(s => !memberSections.has(s.id) && s.studentGroups.some(g => unit.groups.includes(g)) && Object.values(s.exams).some(exam => timingsOverlap(exam, t))));
    if (!unit.reason && !unit.candidates.length) unit.reason = 'FIXED_CONSTRAINTS';
    units.push(unit);
  };
  for (const group of reconcileRules(project.rules, project.sections).groups) makeUnit(project.events.filter(e => e.ownership === 'managed' && e.examType === group.examType && group.courseCodes.includes(e.courseCode)));
  for (const event of project.events) if (event.ownership === 'managed' && !claimed.has(event.id)) makeUnit([event]);
  const viable = units.filter(u => !u.reason);
  const { assignments, blockedCandidates, search } = solveUnits(project, viable);
  const unscheduled: UnscheduledReason[] = [];
  for (const u of units) {
    const timing = assignments.get(u.id);
    if (timing) for (const event of u.members) {
      if (!event.timing && event.required) { event.timing = { ...timing }; event.timingOrigin = 'generated'; }
    }
    else {
      const blocked = blockedCandidates.get(u.id) ?? 0;
      unscheduled.push({
        eventIds: u.members.filter(e => e.required && !e.timing).map(e => e.id),
        // These are conflicts with the returned timetable, not proof of global infeasibility.
        // coverageOptimal separately reports whether a maximum-coverage proof was obtained.
        reason: u.reason ?? (blocked === u.candidates.length ? 'STUDENT_CONFLICTS' : 'SEARCH_BUDGET_EXHAUSTED'),
        blockedCandidateCount: u.reason ? u.totalCandidates : u.totalCandidates - u.candidates.length + blocked,
      });
    }
  }
  // Data-term framing of the coverage bound: separate what the university's own data
  // makes impossible (rule contradictions, empty windows, fully-blocked candidates)
  // from what scheduling policy declined because membership could not be verified.
  // coverageOptimal is then readable as "optimal relative to what the data allows and
  // policy accepts", and maxPlaceableKnown names the bound that declination hides.
  let provablyImpossibleEvents = 0, policyDeclinedEvents = 0, policyDeclinedPlaceableEvents = 0;
  for (const u of unscheduled) {
    const events = u.eventIds.length;
    if (!events) continue;
    const declined = u.reason === 'SOURCE_DATA_INVALID';
    if (declined) policyDeclinedEvents += events;
    else if (u.reason === 'SAME_TIME_CONTRADICTION' || u.reason === 'NO_CANDIDATES' || u.reason === 'FIXED_CONSTRAINTS') provablyImpossibleEvents += events;
    // Unresolved units (STUDENT_CONFLICTS, SEARCH_BUDGET_EXHAUSTED) stay outside both
    // counts: their infeasibility is solver-relative, not data-proven.
  }
  for (const u of units) if (u.reason === 'SOURCE_DATA_INVALID' && u.candidates.length)
    policyDeclinedPlaceableEvents += u.members.filter(e => e.required && !e.timing).length;
  return {
    project, unscheduled,
    search: { ...search, provablyImpossibleEvents, policyDeclinedEvents,
      maxPlaceableKnown: search.coverageUpperBound + policyDeclinedPlaceableEvents },
    quality: scheduleQuality(project), validation: validateProject(project),
  };
}
