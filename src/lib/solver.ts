import type { ExamEvent, ExamTiming, Project } from './types.ts';
import { compare, timingsOverlap, weekend } from './time.ts';

export interface SchedulingUnit {
  id: string; members: ExamEvent[]; groups: string[]; candidates: ExamTiming[];
}
interface Slot { timing: ExamTiming; day: number; avoided: boolean; overlaps: number[] }
interface Variable {
  unit: SchedulingUnit; slots: number[]; slotSet: Set<number>; neighbors: number[];
  groups: number[]; weight: number; fullDay: number; blocks: Int32Array;
  available: number; preferred: number;
}
// Lexicographic: avoid restricted days, then student burden, then simultaneous room demand.
// One pair costs 10 on the same day or 3 on adjacent days, regardless of ownership.
type Cost = [number, number, number];
const compareCost = (a: Cost, b: Cost) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const timingKey = (t: ExamTiming) => `${t.date}:${t.startMinutes}:${t.endMinutes}`;

/** Deterministic weighted partial constraint search; an upper bound never chooses a loser. */
export function solveUnits(project: Project, units: SchedulingUnit[]) {
  const { settings } = project;
  const slots: Slot[] = [], slotIds = new Map<string, number>();
  const intern = (timing: ExamTiming) => {
    const key = timingKey(timing);
    let id = slotIds.get(key);
    if (id === undefined) {
      id = slots.length; slotIds.set(key, id);
      slots.push({ timing, day: Date.parse(timing.date) / 86400000, overlaps: [],
        avoided: (settings.weekendPolicy === 'only_if_necessary' && weekend(timing.date)) ||
          (settings.holidayPolicy === 'only_if_necessary' && settings.holidays.includes(timing.date)) });
    }
    return id;
  };
  const groupIds = new Map<string, number>();
  const groupId = (group: string) => {
    if (!groupIds.has(group)) groupIds.set(group, groupIds.size);
    return groupIds.get(group)!;
  };
  const orderedUnits = [...units].sort((a, b) => compare(a.id, b.id));
  for (const unit of orderedUnits) for (const timing of unit.candidates) intern(timing);
  const fixed = project.events.filter(e => e.timing);
  for (const event of fixed) intern(event.timing!);
  const byDay = new Map<number, number[]>();
  slots.forEach((slot, id) => {
    if (!byDay.has(slot.day)) byDay.set(slot.day, []);
    byDay.get(slot.day)!.push(id);
  });
  for (const ids of byDay.values()) for (const a of ids) {
    slots[a].overlaps = ids.filter(b => timingsOverlap(slots[a].timing, slots[b].timing));
  }
  const variables: Variable[] = orderedUnits.map(unit => {
    const candidates = [...new Set(unit.candidates.map(intern))].sort((a, b) =>
      slots[a].day - slots[b].day || slots[a].timing.startMinutes - slots[b].timing.startMinutes || slots[a].timing.endMinutes - slots[b].timing.endMinutes);
    const moving = unit.members.filter(e => e.required && !e.timing);
    return { unit, slots: candidates, slotSet: new Set(candidates), neighbors: [],
      groups: moving.flatMap(e => e.studentGroups.map(groupId)), weight: moving.length,
      fullDay: Number(unit.members.some(e => e.fullDay)), blocks: new Int32Array(slots.length),
      available: candidates.length, preferred: candidates.filter(s => !slots[s].avoided).length };
  });
  // Build the conflict graph from group membership, excluding non-overlapping windows.
  const byGroup = new Map<string, number[]>();
  variables.forEach((v, i) => { for (const group of v.unit.groups) {
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push(i);
  } });
  const neighbors = variables.map(() => new Set<number>());
  for (const ids of byGroup.values()) for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
    const i = ids[a], j = ids[b];
    if (neighbors[i].has(j)) continue;
    if (variables[i].slots.some(s => slots[s].overlaps.some(t => variables[j].slotSet.has(t)))) {
      neighbors[i].add(j); neighbors[j].add(i);
    }
  }
  variables.forEach((v, i) => { v.neighbors = [...neighbors[i]].sort((a, b) => a - b); });
  const priority = new Int32Array(variables.length);
  variables.map((_, i) => i).sort((a, b) => {
    const u = variables[a], v = variables[b];
    return v.weight - u.weight || v.fullDay - u.fullDay || v.neighbors.length - u.neighbors.length || v.groups.length - u.groups.length || a - b;
  }).forEach((i, rank) => { priority[i] = rank; });
  const components: number[][] = [], seen = new Set<number>();
  for (let i = 0; i < variables.length; i++) if (!seen.has(i)) {
    const component = [i]; seen.add(i);
    for (let j = 0; j < component.length; j++) for (const next of variables[component[j]].neighbors) if (!seen.has(next)) {
      seen.add(next); component.push(next);
    }
    components.push(component.sort((a, b) => a - b));
  }

  const groupDays: Map<number, number>[] = [];
  const concurrent = new Int32Array(slots.length);
  const assigned = new Int32Array(variables.length).fill(-1);
  let cost: Cost = [0, 0, 0];
  const changeGroup = (g: number, day: number, delta: number) => {
    const counts = groupDays[g] ??= new Map();
    const count = (counts.get(day) ?? 0) + delta;
    if (count) counts.set(day, count); else counts.delete(day);
  };
  for (const event of fixed) {
    const s = intern(event.timing!);
    for (const group of event.studentGroups) changeGroup(groupId(group), slots[s].day, 1);
    if (event.ownership === 'managed') for (const overlap of slots[s].overlaps) concurrent[overlap]++;
  }
  const marginal = (i: number, s: number): Cost => {
    const v = variables[i], slot = slots[s];
    let burden = 0;
    for (const group of v.groups) {
      const counts = groupDays[group];
      burden += 10 * (counts?.get(slot.day) ?? 0) + 3 * ((counts?.get(slot.day - 1) ?? 0) + (counts?.get(slot.day + 1) ?? 0));
    }
    return [slot.avoided ? v.weight : 0, burden, v.weight * concurrent[s]];
  };
  const shift = (i: number, s: number, delta: 1 | -1) => {
    const v = variables[i];
    if (delta > 0) {
      const add = marginal(i, s); cost = [cost[0] + add[0], cost[1] + add[1], cost[2] + add[2]];
    }
    for (const group of v.groups) changeGroup(group, slots[s].day, delta);
    for (const overlap of slots[s].overlaps) concurrent[overlap] += delta * v.weight;
    if (delta < 0) {
      const sub = marginal(i, s); cost = [cost[0] - sub[0], cost[1] - sub[1], cost[2] - sub[2]];
    }
    for (const n of v.neighbors) {
      const other = variables[n];
      for (const overlap of slots[s].overlaps) if (other.slotSet.has(overlap)) {
        const before = other.blocks[overlap]; other.blocks[overlap] += delta;
        if (before === 0 || other.blocks[overlap] === 0) {
          other.available -= delta;
          if (!slots[overlap].avoided) other.preferred -= delta;
        }
      }
    }
    assigned[i] = delta > 0 ? s : -1;
  };
  const orderedSlots = (i: number, allowAvoided: boolean) => variables[i].slots
    .filter(s => !variables[i].blocks[s] && (allowAvoided || !slots[s].avoided))
    .map(s => ({ s, cost: marginal(i, s) }))
    .sort((a, b) => compareCost(a.cost, b.cost) || slots[a.s].day - slots[b.s].day ||
      slots[a.s].timing.startMinutes - slots[b.s].timing.startMinutes || slots[a.s].timing.endMinutes - slots[b.s].timing.endMinutes);

  // Interval packing is an optimistic capacity bound, valid for duplicate/overlapping sessions,
  // arbitrary fixed restrictions and full-day exams. Top weights preserve same-time bundles.
  const upperBound = (ids: number[], allowAvoided: boolean) => {
    const groups = new Map<string, number[]>();
    let total = 0;
    for (const i of ids) {
      total += variables[i].weight;
      for (const group of variables[i].unit.groups) {
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group)!.push(i);
      }
    }
    const deficits: { ids: number[]; loss: number }[] = [];
    for (const members of groups.values()) {
      const candidates = [...new Set(members.flatMap(i => variables[i].slots.filter(s => allowAvoided || !slots[s].avoided)))];
      candidates.sort((a, b) => slots[a].day - slots[b].day || slots[a].timing.endMinutes - slots[b].timing.endMinutes || slots[a].timing.startMinutes - slots[b].timing.startMinutes);
      let capacity = 0, day = -Infinity, end = -Infinity;
      for (const s of candidates) {
        const slot = slots[s];
        if (slot.day !== day || slot.timing.startMinutes >= end) {
          capacity++; day = slot.day; end = slot.timing.endMinutes;
        }
      }
      const weights = members.map(i => variables[i].weight).sort((a, b) => b - a);
      const loss = weights.slice(capacity).reduce((a, b) => a + b, 0);
      if (loss) deficits.push({ ids: members, loss });
    }
    // Sum only disjoint deficits: overlapping cohorts cannot be charged twice for one omission.
    const used = new Set<number>();
    for (const deficit of deficits.sort((a, b) => b.loss - a.loss || a.ids[0] - b.ids[0])) {
      if (deficit.ids.some(i => used.has(i))) continue;
      total -= deficit.loss; deficit.ids.forEach(i => used.add(i));
    }
    return total;
  };

  let visitedNodes = 0, improvementEvaluations = 0, improvementMoves = 0, exchangeMoves = 0;
  let coverageUpperBound = 0, avoidedEventLowerBound = 0, coverageOptimal = true, budgetExhausted = false;
  // Keep quality work available even when feasibility consumes its entire allocation.
  const feasibilityBudget = Math.max(1, Math.floor(settings.searchBudget * 0.6));
  let remainingSize = variables.length;
  for (const component of components) {
    const allowance = Math.max(0, Math.floor((feasibilityBudget - visitedNodes) * component.length / remainingSize));
    remainingSize -= component.length;
    const limit = visitedNodes + allowance;
    const allUpper = upperBound(component, true), preferredUpper = upperBound(component, false);
    const initialAvoided = cost[0];
    let bestWeight = 0, bestCost: Cost = [...cost], best = component.map(() => -1);
    let weight = 0;
    const remember = () => {
      if (weight > bestWeight || (weight === bestWeight && compareCost(cost, bestCost) < 0)) {
        bestWeight = weight; bestCost = [...cost]; best = component.map(i => assigned[i]);
      }
    };
    const search = (allowAvoided: boolean, cap: number, upper: number, minAvoided: number) => {
      const active = new Set(component);
      const initialAvoided = cost[0];
      let cut = false;
      const visit = (): void => {
        remember();
        if (bestWeight === upper && bestCost[0] - initialAvoided === minAvoided) return;
        let potential = weight, choice = -1, size = Infinity;
        for (const i of active) {
          const v = variables[i], domain = allowAvoided ? v.available : v.preferred;
          if (!domain) continue; // An empty domain cannot revive deeper in this branch.
          potential += v.weight;
          if (domain < size || (domain === size && priority[i] < priority[choice])) {
            choice = i; size = domain;
          }
        }
        if (choice < 0 || potential < bestWeight || (potential === bestWeight && cost[0] >= bestCost[0])) return;
        if (visitedNodes >= cap) { cut = true; return; }
        visitedNodes++;
        const i = choice, v = variables[i]; active.delete(i);
        for (const { s } of orderedSlots(i, allowAvoided)) {
          shift(i, s, 1); weight += v.weight;
          visit();
          weight -= v.weight; shift(i, s, -1);
          if (bestWeight === upper && bestCost[0] - initialAvoided === minAvoided) break;
          if (visitedNodes >= cap) { cut = true; break; }
        }
        // Omitting a placeable unit can improve total coverage (e.g. one full-day vs two exams).
        if (!(bestWeight === upper && bestCost[0] - initialAvoided === minAvoided)) visit();
        active.add(i);
      };
      visit(); return !cut;
    };
    const hasAvoided = component.some(i => variables[i].preferred !== variables[i].available);
    const firstLimit = hasAvoided ? visitedNodes + Math.ceil(allowance / 2) : limit;
    let complete = search(false, firstLimit, preferredUpper, 0);
    if (hasAvoided && bestWeight < allUpper) {
      // Extend the weekday solution before restarting DFS. Reusing placements saves effort for
      // constrained windows and gives small budgets a useful complete timetable much sooner.
      best.forEach((s, j) => { if (s >= 0) { shift(component[j], s, 1); weight += variables[component[j]].weight; } });
      while (visitedNodes < limit && weight < allUpper) {
        let choice = -1;
        for (const i of component) if (assigned[i] < 0 && variables[i].available > 0 &&
          (choice < 0 || variables[i].available < variables[choice].available ||
            (variables[i].available === variables[choice].available && priority[i] < priority[choice]))) choice = i;
        if (choice < 0) break;
        visitedNodes++;
        const target = orderedSlots(choice, true)[0].s;
        shift(choice, target, 1); weight += variables[choice].weight;
      }
      remember();
      for (const i of component) if (assigned[i] >= 0) shift(i, assigned[i], -1);
      weight = 0;
      // Even an inexact preferred bound remains a safe lower bound on avoided event count.
      complete = search(true, limit, allUpper, Math.max(0, allUpper - preferredUpper));
    }
    const proved = bestWeight === allUpper || complete;
    coverageOptimal &&= proved;
    coverageUpperBound += complete ? bestWeight : allUpper;
    avoidedEventLowerBound += complete ? bestCost[0] - initialAvoided : Math.max(0, bestWeight - preferredUpper);
    budgetExhausted ||= !complete && !proved;
    // Greedy seeds from a few deterministic orderings: the DFS stops once coverage and
    // avoided days are proven, so its remembered burden can be a poor basin for the
    // improvement pass. remember() keeps whichever of DFS/greedy is better; coverage,
    // determinism and the budget contract are unaffected. Only the relocation shape of
    // the solution changes, never legality. Components whose search was cut off by the
    // budget are left alone: an honest cutoff must not be quietly repaired for free.
    if (proved || complete) {
      const sharedGroupPairs = (i: number) => {
        const groups = new Set(variables[i].unit.groups);
        return variables[i].neighbors.reduce((sum, j) => sum + variables[j].unit.groups.filter(g => groups.has(g)).length, 0);
      };
      const availableNow = new Map(component.map(i => [i, variables[i].available]));
      const greedy = (order: number[]) => {
        for (const i of order) {
          const v = variables[i];
          const pickSlot = orderedSlots(i, false)[0] ?? orderedSlots(i, true)[0];
          if (pickSlot) { shift(i, pickSlot.s, 1); weight += v.weight; }
        }
        remember();
        for (const i of component) if (assigned[i] >= 0) { shift(i, assigned[i], -1); weight -= variables[i].weight; }
      };
      for (const order of [
        [...component].sort((a, b) => sharedGroupPairs(b) - sharedGroupPairs(a) || variables[b].weight - variables[a].weight || a - b),
        [...component].sort((a, b) => variables[b].fullDay - variables[a].fullDay || availableNow.get(a)! - availableNow.get(b)! || a - b),
        [...component].sort((a, b) => variables[b].weight - variables[a].weight || variables[b].groups.length - variables[a].groups.length || a - b),
      ]) greedy(order);
    }
    best.forEach((s, j) => { if (s >= 0) shift(component[j], s, 1); });
  }

  // All remaining effort is available to improvement. Exchanges remove both endpoints before
  // checking legality and measuring the exact joint delta, so fixed and moving burden agree.
  const improvementBudget = settings.searchBudget - visitedNodes;
  const spend = () => {
    if (improvementEvaluations >= improvementBudget) return false;
    improvementEvaluations++; return true;
  };
  const blockers = (i: number, s: number) => variables[i].neighbors.filter(j =>
    assigned[j] >= 0 && slots[s].overlaps.includes(assigned[j]));
  // Coverage repair has a separate small slice; hopeless omissions cannot starve spread work.
  const repairLimit = Math.floor(improvementBudget / 4);
  for (let i = 0; i < variables.length && improvementEvaluations < repairLimit; i++) if (assigned[i] < 0) {
    const v = variables[i];
    for (const s of [...v.slots].sort((a, b) => compareCost(marginal(i, a), marginal(i, b)))) {
      if (improvementEvaluations >= repairLimit || !spend()) break;
      const blocked = blockers(i, s);
      if (!blocked.length) { shift(i, s, 1); break; }
      if (blocked.length !== 1) continue;
      const j = blocked[0], old = assigned[j]; shift(j, old, -1); shift(i, s, 1);
      const target = orderedSlots(j, true)[0]?.s;
      if (target !== undefined) { shift(j, target, 1); break; }
      shift(i, s, -1); shift(j, old, 1);
    }
  }
  let improved = true;
  while (improved && improvementEvaluations < improvementBudget) {
    improved = false;
    for (let i = 0; i < variables.length && improvementEvaluations < improvementBudget; i++) {
      const old = assigned[i], v = variables[i];
      if (old < 0 || v.slots.length < 2) continue;
      shift(i, old, -1);
      let target = old, bestDelta = marginal(i, old);
      for (const s of v.slots) {
        if (s === old || v.blocks[s]) continue;
        if (!spend()) break;
        const delta = marginal(i, s);
        if (compareCost(delta, bestDelta) < 0) { target = s; bestDelta = delta; }
      }
      shift(i, target, 1);
      if (target !== old) { improvementMoves++; improved = true; }
    }
    // Give every unit a relocation pass before trying more expensive exchanges. Divide the
    // remaining exchange effort fairly so one saturated cohort cannot consume it all.
    for (let i = 0; i < variables.length && improvementEvaluations < improvementBudget; i++) {
      const old = assigned[i], v = variables[i];
      if (old < 0 || v.slots.length < 2) continue;
      const before: Cost = [...cost];
      const exchangeLimit = improvementEvaluations + Math.ceil((improvementBudget - improvementEvaluations) / (variables.length - i));
      // Escape relocation minima with a legal exchange, including full-day/session differences.
      for (const s of v.slots) {
        if (s === old || !v.blocks[s]) continue;
        if (improvementEvaluations >= exchangeLimit || !spend()) break;
        const blocked = blockers(i, s);
        if (blocked.length !== 1) continue;
        const j = blocked[0], other = variables[j], previous = assigned[j];
        shift(i, old, -1); shift(j, previous, -1);
        if (v.blocks[s]) { shift(j, previous, 1); shift(i, old, 1); continue; }
        shift(i, s, 1);
        let replacement = -1;
        for (const t of other.slots) {
          if (other.blocks[t]) continue;
          if (improvementEvaluations >= exchangeLimit || !spend()) break;
          const delta = marginal(j, t);
          const candidate: Cost = [cost[0] + delta[0], cost[1] + delta[1], cost[2] + delta[2]];
          if (compareCost(candidate, before) < 0) { replacement = t; break; }
        }
        if (replacement >= 0) {
          shift(j, replacement, 1); improvementMoves++; exchangeMoves++; improved = true; break;
        }
        shift(i, s, -1); shift(j, previous, 1); shift(i, old, 1);
      }
    }
  }
  const result = new Map<string, ExamTiming>();
  variables.forEach((v, i) => { if (assigned[i] >= 0) result.set(v.unit.id, slots[assigned[i]].timing); });
  const scheduledWeight = variables.reduce((sum, v, i) => sum + (assigned[i] >= 0 ? v.weight : 0), 0);
  if (scheduledWeight === coverageUpperBound) coverageOptimal = true;
  return {
    assignments: result,
    blockedCandidates: new Map(variables.map(v => [v.unit.id, v.slots.filter(s => v.blocks[s] > 0).length])),
    search: { visitedNodes, budget: settings.searchBudget, feasibilityBudget, budgetExhausted, improvementMoves,
      improvementEvaluations, exchangeMoves, components: components.length, coverageUpperBound,
      coverageOptimal, avoidedEventLowerBound, avoidedDaysOptimal: coverageOptimal && cost[0] === avoidedEventLowerBound,
      improvementBudgetExhausted: improvementEvaluations >= improvementBudget },
  };
}
