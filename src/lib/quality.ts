import type { ExamType, Project } from './types.ts';
import { weekend } from './time.ts';
// Quality facts are counts, never verdicts: the same numbers are shown in the audit bundle,
// the CLI and the AuditView so every surface agrees on student burden (plan §43).
export interface ScheduleQuality {
  scheduledManagedEvents: number;
  sameDayPairs: number; groupsWithSameDayExams: number; groupsWithThreeSameDayExams: number;
  consecutiveDayPairs: number; groupsWithConsecutiveDayExams: number;
  peakConcurrentExams: number; weekendExams: number; holidayExams: number;
  daysUsed: Partial<Record<ExamType, number>>;
}
const dayShift = (date: string, days: number) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
/** One schedule-quality computation for the scheduler result, the audit bundle and the UI. */
export function scheduleQuality(project: Project): ScheduleQuality {
  const timed = project.events.filter(e => e.timing);
  const managed = timed.filter(e => e.ownership === 'managed');
  const byGroup = new Map<string, { date: string; startMinutes: number; endMinutes: number }[]>();
  for (const event of timed) for (const group of event.studentGroups) {
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group)!.push(event.timing!);
  }
  let sameDayPairs = 0, consecutiveDayPairs = 0, sameDayGroups = 0, threeDayGroups = 0, consecutiveGroups = 0;
  for (const exams of byGroup.values()) {
    const perDate = new Map<string, number>();
    for (const timing of exams) perDate.set(timing.date, (perDate.get(timing.date) ?? 0) + 1);
    if ([...perDate.values()].some(count => count >= 2)) sameDayGroups++;
    if ([...perDate.values()].some(count => count >= 3)) threeDayGroups++;
    for (const count of perDate.values()) sameDayPairs += count * (count - 1) / 2;
    const dates = [...perDate.keys()];
    let groupConsecutive = false;
    for (const date of dates) if (perDate.has(dayShift(date, 1))) { consecutiveDayPairs += (perDate.get(date) ?? 0) * (perDate.get(dayShift(date, 1)) ?? 0); groupConsecutive = true; }
    if (groupConsecutive) consecutiveGroups++;
  }
  let peakConcurrentExams = 0;
  const byDate = new Map<string, { startMinutes: number; endMinutes: number }[]>();
  for (const event of managed) {
    if (!byDate.has(event.timing!.date)) byDate.set(event.timing!.date, []);
    byDate.get(event.timing!.date)!.push(event.timing!);
  }
  for (const sessions of byDate.values()) {
    const starts = sessions.map(s => s.startMinutes).sort((a, b) => a - b);
    const ends = sessions.map(s => s.endMinutes).sort((a, b) => a - b);
    let active = 0;
    // Endpoints need their own order: a full-day exam can outlive several shorter exams.
    // Process endings first at equal times because touching intervals do not overlap.
    for (let i = 0, j = 0; i < starts.length;) {
      if (starts[i] < ends[j]) { peakConcurrentExams = Math.max(peakConcurrentExams, ++active); i++; }
      else { active--; j++; }
    }
  }
  const daysUsed: Partial<Record<ExamType, number>> = {};
  for (const type of ['midterm', 'final'] as ExamType[]) daysUsed[type] = new Set(managed.filter(e => e.examType === type).map(e => e.timing!.date)).size;
  return {
    scheduledManagedEvents: managed.length,
    sameDayPairs, groupsWithSameDayExams: sameDayGroups, groupsWithThreeSameDayExams: threeDayGroups,
    consecutiveDayPairs, groupsWithConsecutiveDayExams: consecutiveGroups,
    peakConcurrentExams, weekendExams: managed.filter(e => weekend(e.timing!.date)).length,
    holidayExams: managed.filter(e => project.settings.holidays.includes(e.timing!.date)).length,
    daysUsed,
  };
}
