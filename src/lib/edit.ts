import type { ExamTiming, Project } from './types.ts';
import { reconcileRules } from './rules.ts';
import { sameTiming, validTiming } from './time.ts';
import { validateProject } from './validator.ts';

/** Preview an atomic manual edit. The caller commits only an accepted preview. */
export function previewTimingEdit(input: Project, eventId: string, timing: ExamTiming) {
  if (!validTiming(timing)) throw new Error('Choose a valid date and an end time after the start time.');
  const event = input.events.find(e => e.id === eventId);
  if (!event) throw new Error('The examination no longer exists.');
  if (event.ownership !== 'managed' || event.timingOrigin === 'imported') throw new Error('Imported examinations are fixed. Correct their source file instead.');
  const group = reconcileRules(input.rules, input.sections).groups.find(g => g.examType === event.examType && g.courseCodes.includes(event.courseCode));
  const members = input.events.filter(e => e.ownership === 'managed' && e.examType === event.examType && (group ? group.courseCodes.includes(e.courseCode) : e.id === eventId));
  if (members.some(e => e.blocked)) throw new Error('Resolve missing student groups or contradictory source data before assigning this examination.');
  if (members.some(e => e.timingOrigin === 'imported' && !sameTiming(e.timing, timing))) throw new Error('A course in this same-time group has a different fixed imported time.');
  const project = structuredClone(input);
  const affectedIds = members.map(e => e.id);
  for (const member of project.events.filter(e => affectedIds.includes(e.id))) {
    if (member.timingOrigin === 'imported') continue;
    member.timing = { ...timing }; member.timingOrigin = 'manual';
    // Moved exams release their rooms and proctors; resource assignment runs again after the commit.
    member.roomAssignments = []; member.proctorAssignments = [];
    project.locks[member.id] = { ...timing };
  }
  const validation = validateProject(project);
  const blockingIssues = validation.issues.filter(i => i.blocking && i.eventIds.some(id => affectedIds.includes(id)));
  return { project, validation, affectedIds, blockingIssues, accepted: blockingIssues.length === 0 };
}
