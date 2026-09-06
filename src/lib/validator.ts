import type { ExamEvent, Project, ValidationIssue, ValidationReport } from './types.ts';
import { issue } from './issues.ts';
import { assertSettings, buildEvents, eventEnrollment } from './model.ts';
import { applies, reconcileRules } from './rules.ts';
import { compare, sameTiming, timingsOverlap, unavailable, validTiming, weekend } from './time.ts';
import { assignedRoom, proctorEligible, uniqueResources, validAssignedProctors, validProctorDemand } from './resource-model.ts';

/** Issue types each validation-coverage row reports on; exported so views can tally findings per check. */
export const coverageChecks: Record<string, string[]> = {
  imports: ['MALFORMED_COURSE_ROW', 'INVALID_EXAM_TIMING', 'NO_COURSE_RECORDS', 'SOURCE_TERM_MISMATCH', 'MISSING_STUDENT_GROUPS', 'SOURCE_DATA_INVALID'],
  canonicalEvents: ['MISSING_EVENT', 'UNEXPECTED_EVENT', 'EVENT_MODEL_CHANGED', 'DUPLICATE_EVENT'],
  studentOverlap: ['SOURCE_EXAM_CONFLICT', 'STUDENT_GROUP_OVERLAP', 'MISSING_STUDENT_GROUPS'],
  sameTimeRules: ['SAME_TIME_NOT_SATISFIED', 'SAME_TIME_CONTRADICTION', 'CONTRADICTORY_RULES'],
  dateRanges: ['OUTSIDE_PERIOD'],
  requiredExams: ['UNSCHEDULED_REQUIRED_EXAM', 'MISSING_EVENT'],
  fixedTimings: ['FIXED_TIMING_CHANGED', 'LOCK_NOT_SATISFIED', 'UNKNOWN_LOCK'],
  fullDay: ['FULL_DAY_REQUIRED'],
  calendarPolicy: ['WEEKEND_FORBIDDEN', 'HOLIDAY_FORBIDDEN'],
  roomCapacity: ['ROOM_CAPACITY_EXCEEDED'], roomDoubleBooking: ['ROOM_DOUBLE_BOOKED', 'UNKNOWN_ROOM', 'ROOM_UNAVAILABLE'], proctorAvailability: ['PROCTOR_UNAVAILABLE', 'PROCTOR_INELIGIBLE', 'RESOURCE_TIMING_INVALID'], proctorDoubleBooking: ['PROCTOR_DOUBLE_BOOKED', 'UNKNOWN_PROCTOR'],
  resourceIntegrity: ['DUPLICATE_ROOM_ID', 'DUPLICATE_PROCTOR_ID', 'INVALID_RESOURCE_ID', 'INVALID_PROCTOR_DEMAND', 'DUPLICATE_ROOM_ASSIGNMENT', 'DUPLICATE_PROCTOR_ASSIGNMENT', 'ROOM_ASSIGNMENT_CARDINALITY', 'RESOURCE_TIMING_INVALID'],
  proctorStaffing: ['PROCTOR_REQUIREMENT_UNSATISFIED', 'PROCTOR_DEMAND_UNKNOWN', 'COMPUTER_PROCTOR_MISSING', 'PROCTOR_ASSIGNMENT_SEARCH_EXHAUSTED'],
};

export function validateProject(project: Project): ValidationReport {
  const issues: ValidationIssue[] = [...project.importIssues, ...reconcileRules(project.rules, project.sections).issues];
  let settingsValid = true;
  try { assertSettings(project.settings); } catch (error) { settingsValid = false; issues.push(issue('INVALID_SETTINGS', String(error))); }
  const baseline = buildEvents(project), expected = new Map(baseline.map(e => [e.id, e]));
  const events = [...project.events].sort((a, b) => compare(a.id, b.id));
  const actual = new Map<string, ExamEvent>();
  const add = (type: string, message: string, members: ExamEvent[], extra: Partial<ValidationIssue> = {}) => {
    issues.push(issue(type, message, { origin: members.some(e => e.timingOrigin === 'generated') ? 'generated' : members.some(e => e.timingOrigin === 'manual') ? 'manual' : 'source', eventIds: members.map(e => e.id), courseCodes: members.map(e => e.courseCode), sourceRefs: members.flatMap(e => e.sourceRefs), ...extra }));
  };
  const terms = project.artifacts.filter(a => a.kind === 'course' && a.term);
  const roomIds = new Set(project.rooms.map(r => r.id));
  const proctorMap = new Map(project.proctors.map(p => [p.id, p]));
  for (const [kind, resources] of [['ROOM', project.rooms], ['PROCTOR', project.proctors]] as const) {
    const ids = new Set<string>();
    for (const resource of resources) {
      if (typeof resource.id !== 'string' || !resource.id.trim()) issues.push(issue('INVALID_RESOURCE_ID', `${kind} identity must be a nonempty string`, { origin: 'resource', sourceRefs: [resource.sourceRef] }));
      if (ids.has(resource.id)) issues.push(issue(`DUPLICATE_${kind}_ID`, `${kind} ID ${resource.id} occurs more than once and is excluded from allocation`, { origin: 'resource', sourceRefs: resources.filter(r => r.id === resource.id).map(r => r.sourceRef) }));
      ids.add(resource.id);
    }
  }
  for (const room of project.rooms) if (room.proctorsRequired !== undefined && !validProctorDemand(room.proctorsRequired)) issues.push(issue('INVALID_PROCTOR_DEMAND', `Proctor demand for ${room.name} must be a positive safe integer`, { origin: 'resource', sourceRefs: [room.sourceRef] }));
  // Resource integrity is independent of canonical ownership, rooms, and source timing checks.
  for (const event of events) {
    const extra = { origin: 'resource' as const };
    if (event.roomAssignments.some(id => !roomIds.has(id))) add('UNKNOWN_ROOM', 'Room assignment references a room absent from the room source', [event], extra);
    if (event.proctorAssignments.some(id => !proctorMap.has(id))) add('UNKNOWN_PROCTOR', 'Proctor assignment references a person absent from the roster', [event], extra);
    if (new Set(event.roomAssignments).size !== event.roomAssignments.length) add('DUPLICATE_ROOM_ASSIGNMENT', 'A room ID is repeated within this examination', [event], extra);
    if (new Set(event.proctorAssignments).size !== event.proctorAssignments.length) add('DUPLICATE_PROCTOR_ASSIGNMENT', 'A proctor ID is repeated within this examination', [event], extra);
    if (event.roomAssignments.length > 1) add('ROOM_ASSIGNMENT_CARDINALITY', 'An examination may occupy exactly one room', [event], extra);
    if (!event.timing || !validTiming(event.timing)) {
      if (event.roomAssignments.length || event.proctorAssignments.length) add('RESOURCE_TIMING_INVALID', 'Resource assignments require a valid examination date and interval', [event], extra);
      continue;
    }
    const assigned = uniqueResources(project.proctors).filter(p => event.proctorAssignments.includes(p.id));
    for (const p of assigned) {
      if (!proctorEligible(project, p)) add('PROCTOR_INELIGIBLE', `${p.displayName} is quarantined from current assignments; import a current-term roster`, [event], { ...extra, sourceRefs: [...event.sourceRefs, ...(p.sourceRefs ?? [p.sourceRef])] });
      const blocked = p.availability.filter(a => unavailable(a, event.timing!));
      if (blocked.length) add('PROCTOR_UNAVAILABLE', `${p.displayName} is structurally unavailable at this time`, [event], { ...extra, sourceRefs: [...event.sourceRefs, p.sourceRef, ...blocked.flatMap(a => a.sourceRef ? [a.sourceRef] : [])] });
    }
    for (const room of project.rooms.filter(r => event.roomAssignments.includes(r.id))) {
      if (room.unavailableDates.includes(event.timing.date)) add('ROOM_UNAVAILABLE', `${room.name} is unavailable on this date`, [event], { ...extra, sourceRefs: [...event.sourceRefs, room.sourceRef] });
      const enrollment = eventEnrollment(project.sections, event);
      if (room.capacity !== undefined && enrollment > room.capacity) add('ROOM_CAPACITY_EXCEEDED', `${enrollment} students exceed the ${room.capacity} seats of ${room.name}`, [event], extra);
    }
    if ((expected.get(event.id)?.ownership ?? event.ownership) !== 'managed') continue;
    const room = assignedRoom(project, event);
    const warning = { ...extra, severity: 'warning' as const, blocking: false };
    if (project.rooms.length && !event.roomAssignments.length) add('ROOM_REQUIREMENT_UNSATISFIED', 'No room is assigned to this scheduled examination', [event], warning);
    if (!validProctorDemand(room?.proctorsRequired) && (project.rooms.length || project.proctors.length || event.roomAssignments.length)) {
      add('PROCTOR_DEMAND_UNKNOWN', room ? `Required proctor count is unknown for ${room.name}; enter the room staffing requirement` : 'Proctor demand cannot be determined until one known room is assigned', [event], { ...warning, sourceRefs: [...event.sourceRefs, ...(room ? [room.sourceRef] : [])] });
    }
    const validAssigned = validAssignedProctors(project, event);
    if (project.settings.computerProctorRule && room?.tags.includes('computer') && !validAssigned.some(p => p.tags.includes('computer'))) add('COMPUTER_PROCTOR_MISSING', 'A computer room should be invigilated by at least one computer-tagged proctor', [event], warning);
    if (validProctorDemand(room?.proctorsRequired) && validAssigned.length < room.proctorsRequired) {
      const uniqueIds = new Set(uniqueResources(project.proctors).map(p => p.id));
      const blockedCandidates = [...new Map(project.proctors.map(p => [p.id, p])).values()].filter(p => !validAssigned.some(a => a.id === p.id)).map(p => {
        const records = project.proctors.filter(record => record.id === p.id);
        const constraints = records.flatMap(record => record.availability.filter(a => unavailable(a, event.timing!)));
        const overlapping = events.filter(e => e !== event && e.proctorAssignments.includes(p.id) && e.timing && validTiming(e.timing) && timingsOverlap(e.timing, event.timing!));
        const reasons = [!uniqueIds.has(p.id) ? 'ambiguous_identity' : '', records.some(record => !proctorEligible(project, record)) ? 'ineligible_roster' : '', constraints.length ? 'unavailable' : '', overlapping.length ? 'overlapping_duty' : ''].filter(Boolean);
        if (!reasons.length) reasons.push('not_selected');
        return { proctorId: String(p.id), reasons, eventIds: overlapping.map(e => e.id), sourceRefs: [...records.flatMap(record => [record.sourceRef, ...(record.sourceRefs ?? [])]), ...constraints.flatMap(a => a.sourceRef ? [a.sourceRef] : []), ...overlapping.flatMap(e => e.sourceRefs)] };
      });
      const counts = new Map<string, number>();
      for (const candidate of blockedCandidates) for (const reason of candidate.reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
      const explanation = project.proctors.length ? [...counts].map(([reason, count]) => `${count} ${reason.replaceAll('_', ' ')}`).join(', ') : 'no proctor roster imported';
      add('PROCTOR_REQUIREMENT_UNSATISFIED', `${validAssigned.length} of ${room.proctorsRequired} known proctor positions are filled in ${room.name}; ${explanation}`, [event], { ...warning, sourceRefs: [...event.sourceRefs, room.sourceRef, ...blockedCandidates.flatMap(p => p.sourceRefs)], blockedCandidates });
    }
  }
  for (const artifact of terms.slice(1)) if (artifact.term!.semester !== terms[0].term!.semester || artifact.term!.academicYearBE !== terms[0].term!.academicYearBE) issues.push(issue('SOURCE_TERM_MISMATCH', 'Course sources belong to different academic terms', { sourceRefs: [{ artifactId: artifact.id }, { artifactId: terms[0].id }] }));
  for (const event of events) {
    if (actual.has(event.id)) add('DUPLICATE_EVENT', 'Event ID appears more than once', [event]);
    actual.set(event.id, event);
    const original = expected.get(event.id);
    if (!original) { add('UNEXPECTED_EVENT', 'Event is not defined by the source model', [event]); continue; }    for (const field of ['courseCode', 'examType', 'ownership', 'sectionIds', 'studentGroups', 'required', 'fullDay', 'blocked', 'timingOrigin'] as const) {
      if (JSON.stringify(event[field]) !== JSON.stringify(original[field])) add('EVENT_MODEL_CHANGED', `Event ${field} differs from the canonical source model`, [event]);
    }
    if (original.timing && !sameTiming(original.timing, event.timing)) add('FIXED_TIMING_CHANGED', 'Imported or locked timing must be preserved exactly', [original], { origin: original.timingOrigin === 'manual' ? 'manual' : 'source' });
    if (event.timing && !validTiming(event.timing)) add('INVALID_INTERVAL', 'Exam date or time interval is invalid', [event]);
    if (event.timing && validTiming(event.timing)) {
      if (weekend(event.timing.date)) add('EXAM_ON_WEEKEND', `Exam falls on a weekend: ${event.timing.date}`, [event], { severity: 'warning', blocking: false });
      if (project.settings.holidays.includes(event.timing.date)) add('EXAM_ON_HOLIDAY', `Exam falls on a configured holiday: ${event.timing.date}`, [event], { severity: 'warning', blocking: false });
    }
    if (event.required && !event.timing) add('UNSCHEDULED_REQUIRED_EXAM', 'Required examination remains unscheduled', [event]);
    if (original.blocked) add('SOURCE_DATA_INVALID', 'Contradictory rules, missing groups or invalid/inconsistent section timings require reconciliation', [original], { origin: 'source' });
    if (event.timing && original.ownership === 'managed') {
      if (project.rules.some(r => applies(r, original.courseCode, original.examType) && r.action === 'no_exam')) add('NO_EXAM_RULE_VIOLATED', 'Explicit no-exam rule conflicts with an assignment', [event]);
      if (!original.required && event.timingOrigin === 'generated') add('EXCLUDED_EXAM_GENERATED', 'Excluded examination was generated centrally', [event]);
      if (settingsValid) {
        const period = project.settings.periods[original.examType];
        if (event.timing.date < period.start || event.timing.date > period.end) add('OUTSIDE_PERIOD', 'Managed exam lies outside its configured period', [event]);
        if (original.fullDay && (event.timing.startMinutes !== project.settings.fullDay.startMinutes || event.timing.endMinutes !== project.settings.fullDay.endMinutes)) add('FULL_DAY_REQUIRED', 'Exam must use the configured full-day interval', [event]);
        if (event.timingOrigin === 'generated' && project.settings.weekendPolicy === 'never' && weekend(event.timing.date)) add('WEEKEND_FORBIDDEN', 'Generated exam uses a forbidden weekend', [event]);
        if (event.timingOrigin === 'generated' && project.settings.holidayPolicy === 'never' && project.settings.holidays.includes(event.timing.date)) add('HOLIDAY_FORBIDDEN', 'Generated exam uses a forbidden holiday', [event]);
        if (event.timingOrigin === 'generated' && !original.fullDay && !project.settings.sessions.some(t => t.startMinutes === event.timing!.startMinutes && t.endMinutes === event.timing!.endMinutes)) add('NONSTANDARD_GENERATED_INTERVAL', 'Generated exam does not use a configured session', [event]);
      }
    }

  }
  for (const event of baseline) if (!actual.has(event.id)) add('MISSING_EVENT', 'Canonical exam event is missing from the schedule', [event]);
  for (const [id, timing] of Object.entries(project.locks)) {
    const event = expected.get(id);
    if (!event) issues.push(issue('UNKNOWN_LOCK', 'Manual lock references an unknown event', { origin: 'manual', eventIds: [id] }));
    else if (!validTiming(timing) || !sameTiming(actual.get(id)?.timing, timing)) add('LOCK_NOT_SATISFIED', 'Manual lock is invalid or not preserved', [event], { origin: 'manual' });
  }
  // Use source-derived groups and ownership so fabricated output cannot hide collisions.
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    const a = events[i], b = events[j], ca = expected.get(a.id), cb = expected.get(b.id);
    if (!a.timing || !b.timing || !validTiming(a.timing) || !validTiming(b.timing) || !timingsOverlap(a.timing, b.timing)) continue;
    if (a.roomAssignments.some(id => b.roomAssignments.includes(id))) add('ROOM_DOUBLE_BOOKED', `${a.timing.date}: one room hosts overlapping examinations`, [a, b], { origin: 'resource' });
    if (a.proctorAssignments.some(id => b.proctorAssignments.includes(id))) add('PROCTOR_DOUBLE_BOOKED', `${a.timing.date}: one proctor invigilates overlapping examinations`, [a, b], { origin: 'resource' });
    if (!ca || !cb) continue;
    const shared = ca.studentGroups.filter(g => cb.studentGroups.includes(g));
    if (shared.length) add(a.timingOrigin === 'imported' && b.timingOrigin === 'imported' ? 'SOURCE_EXAM_CONFLICT' : 'STUDENT_GROUP_OVERLAP', `${a.timing.date}: overlapping exams share student groups`, [a, b], { studentGroups: shared });
  }
  for (const group of reconcileRules(project.rules, project.sections).groups) {
    const members = baseline.filter(e => e.ownership === 'managed' && e.examType === group.examType && group.courseCodes.includes(e.courseCode));
    if (members.some((a, i) => members.slice(i + 1).some(b => a.studentGroups.some(g => b.studentGroups.includes(g))))) add('SAME_TIME_CONTRADICTION', 'Same-time courses share student groups and cannot run simultaneously', members, { origin: 'source', sourceRefs: group.sourceRefs });
    const assigned = members.map(e => actual.get(e.id));
    if (assigned.some(e => e?.timing) && assigned.some(e => !sameTiming(e?.timing, assigned.find(a => a?.timing)?.timing))) add('SAME_TIME_NOT_SATISFIED', 'Same-time events must all share one exact timing', members, { sourceRefs: group.sourceRefs });
  }
  // Severity first (errors, then warnings, then info) so the report leads with what blocks; id order stays stable within a tier.
  const severityRank = (s: ValidationIssue['severity']) => s === 'error' ? 0 : s === 'warning' ? 1 : 2;
  const deduped = [...new Map(issues.map(i => [i.id, i])).values()].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || compare(a.id, b.id));
  const check = (types: string[]) => deduped.some(i => types.includes(i.type)) ? 'failed' as const : 'passed' as const;
  const disabled = (key: string, types: string[]) => !types.length || (key === 'dateRanges' && !settingsValid) || (key === 'roomDoubleBooking' && !project.rooms.length) || (key === 'roomCapacity' && !project.rooms.some(r => r.capacity !== undefined)) || (['proctorAvailability', 'proctorDoubleBooking'].includes(key) && !project.proctors.length) || (key === 'proctorStaffing' && !project.rooms.length && !project.proctors.length && !events.some(e => e.roomAssignments.length || e.proctorAssignments.length));
  // Seat capacity is only reported when a room actually declares it — not_checked cannot masquerade as passed.
  return { overallStatus: deduped.some(i => i.severity === 'error') ? 'invalid' : deduped.length ? 'valid_with_warnings' : 'valid', issues: deduped, coverage: Object.fromEntries(Object.entries(coverageChecks).map(([key, types]) => [key, check(types) === 'failed' ? 'failed' as const : disabled(key, types) ? 'not_checked' as const : 'passed' as const])) };
}
