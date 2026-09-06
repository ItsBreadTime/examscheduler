import type { AvailabilityConstraint, ExamTiming, TimeInterval } from './types.ts';
export const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const unique = (values: string[]) => [...new Set(values)].sort(compare);
export const normalize = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ');
export function validDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
export function parseDate(value: string): string | undefined {
  const text = value.trim();
  if (validDate(text)) return text;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (!m) return undefined;
  let year = Number(m[3]);
  // Thai university exports use two-digit Buddhist years (69 = 2569).
  if (year < 100) year += 2500;
  if (year >= 2400) year -= 543;
  const date = `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return validDate(date) ? date : undefined;
}
export function validInterval(t: TimeInterval): boolean {
  return Number.isInteger(t.startMinutes) && Number.isInteger(t.endMinutes) && t.startMinutes >= 0 && t.endMinutes <= 1440 && t.startMinutes < t.endMinutes;
}
export function validTiming(t: ExamTiming): boolean { return validDate(t.date) && validInterval(t); }
export function parseInterval(value: string): TimeInterval | undefined {
  const m = /^(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})(?:\s*น\.?)?$/.exec(value.trim());
  if (!m || +m[2] > 59 || +m[4] > 59) return undefined;
  const t = { startMinutes: +m[1] * 60 + +m[2], endMinutes: +m[3] * 60 + +m[4] };
  return validInterval(t) ? t : undefined;
}
export const overlaps = (a: TimeInterval, b: TimeInterval) => Math.max(a.startMinutes, b.startMinutes) < Math.min(a.endMinutes, b.endMinutes);
export const timingsOverlap = (a: ExamTiming, b: ExamTiming) => a.date === b.date && overlaps(a, b);
export const sameTiming = (a?: ExamTiming, b?: ExamTiming) => !!a && !!b && a.date === b.date && a.startMinutes === b.startMinutes && a.endMinutes === b.endMinutes;
export const weekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
export function dates(start: string, end: string): string[] {
  if (!validDate(start) || !validDate(end) || start > end) throw new Error('Invalid exam period');
  const result: string[] = [];
  for (let d = Date.parse(start); d <= Date.parse(end); d += 86400000) {
    if (result.length >= 366) throw new Error('Exam periods must be at most 366 days');
    result.push(new Date(d).toISOString().slice(0, 10));
  }
  return result;
}
export const weekDay = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
/** True when a structured unavailability constraint blocks this timing (plan §32/§34: free text is never interpreted). */
export function unavailable(constraint: AvailabilityConstraint, timing: ExamTiming): boolean {
  const dayApplies = constraint.date ? constraint.date === timing.date : constraint.dayOfWeek !== undefined ? weekDay(timing.date) === constraint.dayOfWeek : true;
  const timeApplies = constraint.interval ? overlaps(constraint.interval, timing) : true;
  return dayApplies && timeApplies;
}
