import type { ExamEvent, ExamTiming, Project, Proctor, RoomResource, ValidationIssue, ValidationReport } from './types.ts';
import { eventEnrollment } from './model.ts';
import { compare, timingsOverlap, unavailable, validTiming } from './time.ts';
import { validateProject } from './validator.ts';
import { assignedRoom, proctorEligible, uniqueResources, validAssignedProctors, validProctorDemand } from './resource-model.ts';
import { issue } from './issues.ts';

export const proctorAvailable = (proctor: Proctor, timing: ExamTiming) => !proctor.availability.some(a => unavailable(a, timing));

export interface ResourceSummary {
  scheduledManagedEvents: number; roomsAssigned: number; roomsUnassigned: number;
  proctorPositions: number; positionsFilled: number; positionsUnfilled: number; computerRuleApplied: boolean;
  eventsWithUnknownProctorDemand: number; roomsWithUnknownProctorDemand: number;
  eventsWithUnfilledProctorPositions: number; eligibleProctors: number; ineligibleProctors: number;
}
/** Known positions are separate from unknown demand; invalid people never inflate coverage. */
export function summarizeAssignedResources(project: Project): ResourceSummary {
  const timed = project.events.filter(e => e.ownership === 'managed' && e.timing && validTiming(e.timing));
  let proctorPositions = 0, positionsFilled = 0, eventsWithUnknownProctorDemand = 0, eventsWithUnfilledProctorPositions = 0;
  for (const event of timed) {
    const required = assignedRoom(project, event)?.proctorsRequired;
    if (!validProctorDemand(required)) { eventsWithUnknownProctorDemand++; continue; }
    const filled = Math.min(validAssignedProctors(project, event).length, required);
    proctorPositions += required; positionsFilled += filled;
    if (filled < required) eventsWithUnfilledProctorPositions++;
  }
  const eligibleProctors = uniqueResources(project.proctors).filter(p => proctorEligible(project, p)).length;
  const roomsAssigned = timed.filter(e => assignedRoom(project, e)).length;
  return {
    scheduledManagedEvents: timed.length, roomsAssigned, roomsUnassigned: timed.length - roomsAssigned,
    proctorPositions, positionsFilled, positionsUnfilled: proctorPositions - positionsFilled,
    eventsWithUnknownProctorDemand,
    roomsWithUnknownProctorDemand: uniqueResources(project.rooms).filter(r => !validProctorDemand(r.proctorsRequired)).length,
    eventsWithUnfilledProctorPositions, eligibleProctors,
    ineligibleProctors: new Set(project.proctors.map(p => p.id)).size - eligibleProctors,
    computerRuleApplied: !!project.settings.computerProctorRule,
  };
}

/**
 * Deterministic room allocation followed by bounded augmenting proctor reassignment.
 * A later position can reclaim a proctor if every displaced duty can be refilled.
 * Multiple interval conflicts are moved atomically; context duties are immutable reservations.
 * Cost ordering prefers capability, total load, same-day load and consecutive duties. This is
 * a feasibility repair heuristic for arbitrary intervals, not a global minimum-cost proof.
 */
export function assignResources(input: Project): { project: Project; summary: ResourceSummary; issues: ValidationIssue[]; validation: ValidationReport } {
  const project = structuredClone(input);
  for (const event of project.events) if (event.ownership === 'managed') { event.roomAssignments = []; event.proctorAssignments = []; }
  const rooms = uniqueResources(project.rooms).sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id));
  const needing = project.events
    .filter(e => e.ownership === 'managed' && e.timing && validTiming(e.timing))
    .sort((a, b) => compare(a.timing!.date, b.timing!.date) || a.timing!.startMinutes - b.timing!.startMinutes || a.timing!.endMinutes - b.timing!.endMinutes || compare(a.id, b.id));
  const context = project.events.filter(e => e.ownership !== 'managed' && e.timing && validTiming(e.timing));
  const busy = new Map<string, ExamTiming[]>();
  for (const room of rooms) busy.set(room.id, context.filter(e => e.roomAssignments.includes(room.id)).map(e => e.timing!));
  const knowsCapacity = rooms.some(r => r.capacity !== undefined);
  const roomOrder = knowsCapacity ? [...rooms].sort((a, b) => (a.capacity ?? Number.MAX_SAFE_INTEGER) - (b.capacity ?? Number.MAX_SAFE_INTEGER) || compare(a.name, b.name) || compare(a.id, b.id)) : rooms;
  const seatOrder = knowsCapacity ? [...needing].sort((a, b) => eventEnrollment(project.sections, b) - eventEnrollment(project.sections, a) || compare(a.id, b.id)) : needing;
  for (const event of seatOrder) {
    const fits = (room: RoomResource) => room.capacity === undefined || room.capacity >= eventEnrollment(project.sections, event);
    const room = roomOrder.find(r => !r.unavailableDates.includes(event.timing!.date) && fits(r) && !busy.get(r.id)!.some(t => timingsOverlap(t, event.timing!)));
    if (room) { event.roomAssignments = [room.id]; busy.get(room.id)!.push(event.timing!); }
  }
  const proctors = uniqueResources(project.proctors).filter(p => proctorEligible(project, p)).sort((a, b) => compare(a.displayName, b.displayName) || compare(a.id, b.id));
  const fixedDuties = new Map(proctors.map(p => [p.id, context.filter(e => e.proctorAssignments.includes(p.id)).map(e => e.timing!)]));
  const slots: { event: ExamEvent; preferComputer: boolean; candidates: Proctor[] }[] = [];
  for (const event of needing) {
    const room = rooms.find(r => r.id === event.roomAssignments[0]);
    if (!validProctorDemand(room?.proctorsRequired)) continue;
    const candidates = proctors.filter(p => proctorAvailable(p, event.timing!) && !fixedDuties.get(p.id)!.some(t => timingsOverlap(t, event.timing!)));
    // More positions than distinct people can never be filled; keep full demand in the summary.
    for (let i = 0; i < Math.min(room.proctorsRequired, candidates.length); i++) slots.push({ event, preferComputer: i === 0 && !!project.settings.computerProctorRule && room.tags.includes('computer'), candidates });
  }
  let owners: (string | undefined)[] = Array(slots.length).fill(undefined);
  const conflicts = (slot: number, id: string) => slots.flatMap((other, i) => i !== slot && owners[i] === id && timingsOverlap(other.event.timing!, slots[slot].event.timing!) ? [i] : []);
  const ranked = (slot: number) => {
    const target = slots[slot];
    const cost = (p: Proctor) => {
      const duties = [...fixedDuties.get(p.id)!, ...slots.flatMap((s, i) => owners[i] === p.id && i !== slot ? [s.event.timing!] : [])];
      const today = duties.filter(t => t.date === target.event.timing!.date);
      return [Number(target.preferComputer && !p.tags.includes('computer')), duties.length, today.length,
        today.filter(t => t.endMinutes === target.event.timing!.startMinutes || t.startMinutes === target.event.timing!.endMinutes).length];
    };
    const costs = new Map(target.candidates.map(p => [p.id, cost(p)]));
    return [...target.candidates].sort((a, b) => {
      const ac = costs.get(a.id)!, bc = costs.get(b.id)!;
      for (let i = 0; i < ac.length; i++) if (ac[i] !== bc[i]) return ac[i] - bc[i];
      return compare(a.displayName, b.displayName) || compare(a.id, b.id);
    });
  };
  // Fast first pass; repair only positions that could not take a free person.
  for (let slot = 0; slot < slots.length; slot++) owners[slot] = ranked(slot).find(p => !conflicts(slot, p.id).length)?.id;
  let remaining = Number.isInteger(project.settings.searchBudget) ? Math.max(1, Math.min(project.settings.searchBudget, 100000)) : 20000;
  let exhausted = false;
  const augment = (slot: number, locked: Set<number>, requireComputer = false): boolean => {
    if (locked.size >= 256) { exhausted = true; return false; }
    const chain = new Set([...locked, slot]);
    // Prefer an immediate free alternative before recursively disturbing another duty.
    const candidates = ranked(slot).filter(p => !requireComputer || p.tags.includes('computer')).sort((a, b) => Number(!!conflicts(slot, a.id).length) - Number(!!conflicts(slot, b.id).length));
    for (const candidate of candidates) {
      if (remaining-- <= 0) { exhausted = true; return false; }
      const displaced = conflicts(slot, candidate.id);
      if (displaced.some(i => chain.has(i))) continue;
      const before = [...owners];
      owners[slot] = candidate.id;
      for (const i of displaced) owners[i] = undefined;
      let success = true;
      // Refills completed in this transaction must survive all subsequent refills.
      const protectedSlots = new Set(chain);
      for (const i of displaced) {
        if (!augment(i, protectedSlots)) { success = false; break; }
        protectedSlots.add(i);
      }
      if (success) return true;
      owners = before;
    }
    return false;
  };
  let improved: boolean;
  do {
    improved = false;
    for (let slot = 0; slot < slots.length && remaining > 0; slot++) if (!owners[slot] && augment(slot, new Set())) improved = true;
  } while (improved && remaining > 0);
  // Interval graphs need more than a single augmenting path: dropping one long duty can
  // admit two shorter duties. Search only overlap components with vacancies, retaining
  // the best complete snapshot at every cutoff. Independent dates never share this search.
  const unseen = new Set(slots.map((_, i) => i));
  while (unseen.size && remaining > 0) {
    const component = [unseen.values().next().value!]; unseen.delete(component[0]);
    for (let i = 0; i < component.length; i++) for (const j of unseen) {
      if (timingsOverlap(slots[component[i]].event.timing!, slots[j].event.timing!)) { unseen.delete(j); component.push(j); }
    }
    if (component.every(i => owners[i])) continue;
    const commonStart = Math.max(...component.map(i => slots[i].event.timing!.startMinutes));
    const commonEnd = Math.min(...component.map(i => slots[i].event.timing!.endMinutes));
    const upperBound = commonStart < commonEnd ? Math.min(component.length, new Set(component.flatMap(i => slots[i].candidates.map(p => p.id))).size) : component.length;
    let best = [...owners], bestCount = component.filter(i => owners[i]).length;
    if (bestCount >= upperBound) continue;
    const order = [...component].sort((a, b) => slots[a].candidates.length - slots[b].candidates.length
      || (slots[a].event.timing!.endMinutes - slots[a].event.timing!.startMinutes) - (slots[b].event.timing!.endMinutes - slots[b].event.timing!.startMinutes) || a - b);
    for (const i of component) owners[i] = undefined;
    const search = (depth: number, filled: number) => {
      if (filled > bestCount) { bestCount = filled; best = [...owners]; }
      if (bestCount >= upperBound || filled + order.length - depth <= bestCount || depth === order.length) return;
      if (remaining-- <= 0 || depth >= 256) { exhausted = true; return; }
      const slot = order[depth];
      for (const p of ranked(slot)) if (!conflicts(slot, p.id).length) {
        owners[slot] = p.id; search(depth + 1, filled + 1); owners[slot] = undefined;
        if (bestCount >= upperBound || remaining <= 0) return;
      }
      search(depth + 1, filled);
    };
    search(0, 0);
    owners = best;
  }
  // Improve the opt-in capability preference without sacrificing a filled position.
  for (let slot = 0; slot < slots.length && remaining > 0; slot++) {
    if (!slots[slot].preferComputer || !owners[slot]) continue;
    if (slots.some((s, i) => s.event === slots[slot].event && proctors.some(p => p.id === owners[i] && p.tags.includes('computer')))) continue;
    const before = [...owners]; owners[slot] = undefined;
    if (!augment(slot, new Set(), true)) owners = before;
  }
  for (const [i, slot] of slots.entries()) if (owners[i]) slot.event.proctorAssignments.push(owners[i]!);
  for (const event of needing) event.proctorAssignments.sort(compare);
  const validation = validateProject(project);
  if (exhausted || (remaining <= 0 && owners.some(id => !id))) {
    validation.issues.push(issue('PROCTOR_ASSIGNMENT_SEARCH_EXHAUSTED', 'Proctor reassignment reached its search limit; remaining shortages are not proven unavoidable', { severity: 'warning', blocking: false, origin: 'resource' }));
    validation.coverage.proctorStaffing = 'failed';
    if (validation.overallStatus === 'valid') validation.overallStatus = 'valid_with_warnings';
  }
  return { project, summary: summarizeAssignedResources(project), issues: validation.issues.filter(i => i.origin === 'resource'), validation };
}
