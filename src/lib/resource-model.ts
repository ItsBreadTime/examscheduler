import type { ExamEvent, Project, Proctor, RoomResource } from './types.ts';
import { timingsOverlap, unavailable, validTiming } from './time.ts';

/** Ambiguous identities are excluded rather than selecting an arbitrary duplicate record. */
export function uniqueResources<T extends { id: string }>(resources: T[]): T[] {
  const counts = new Map<string, number>();
  for (const resource of resources) counts.set(resource.id, (counts.get(resource.id) ?? 0) + 1);
  return resources.filter(resource => typeof resource.id === 'string' && resource.id.trim() && counts.get(resource.id) === 1);
}

export const validProctorDemand = (value: number | undefined): value is number => Number.isSafeInteger(value) && value! > 0;

/** Recheck artifact terms so older saved snapshots cannot bypass import quarantine. */
export function proctorEligible(project: Project, proctor: Proctor): boolean {
  if (proctor.assignmentEligibility?.eligible === false) return false;
  const terms = project.artifacts.filter(a => a.kind === 'course' && a.term).map(a => a.term!);
  const refs = [proctor.sourceRef, ...(proctor.sourceRefs ?? [])];
  const sourceTerms = [proctor.assignmentEligibility?.sourceTerm, ...project.artifacts.filter(a => refs.some(r => r.artifactId === a.id)).map(a => a.term)].filter(t => t !== undefined);
  return !sourceTerms.some(source => terms.some(term => term.academicYearBE !== source.academicYearBE || term.semester !== source.semester));
}

export function assignedRoom(project: Project, event: ExamEvent): RoomResource | undefined {
  return event.roomAssignments.length === 1 ? uniqueResources(project.rooms).find(r => r.id === event.roomAssignments[0]) : undefined;
}

/** Count distinct, valid people only; invalid restored assignments cannot inflate staffing. */
export function validAssignedProctors(project: Project, event: ExamEvent): Proctor[] {
  if (!event.proctorAssignments.length || !event.timing || !validTiming(event.timing)) return [];
  return uniqueResources(project.proctors).filter(p => event.proctorAssignments.includes(p.id)
    && proctorEligible(project, p)
    && !p.availability.some(a => unavailable(a, event.timing!))
    && !project.events.some(other => other !== event && other.timing && validTiming(other.timing)
      && other.proctorAssignments.includes(p.id) && timingsOverlap(other.timing, event.timing!)));
}
