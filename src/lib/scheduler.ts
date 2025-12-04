import type { 
  Subject, 
  ExamSlot, 
  ScheduledExam, 
  ScheduleResult, 
  Rules, 
  ExamPeriod,
  ScheduleConflict
} from './types';
import { generateSlots, getExamDates, parseThaiDate } from './types';
import { checkSlotConflicts, validateSchedule } from './conflicts';
import { groupSubjectsByCode } from './parser';

export interface SchedulerOptions {
  midtermPeriod: ExamPeriod;
  finalPeriod: ExamPeriod;
  rules: Rules;
}

// Parse time string to determine slot type
function parseTimeToSlot(timeStr: string): 'morning' | 'afternoon' | null {
  if (!timeStr) return null;
  
  // Extract start hour
  const match = timeStr.match(/^(\d{1,2}):/);
  if (!match) return null;
  
  const hour = parseInt(match[1], 10);
  
  if (hour >= 8 && hour < 12) return 'morning';
  if (hour >= 12) return 'afternoon';
  
  return null;
}

// Create exam slot from date and time strings
function createSlotFromStrings(dateStr: string, timeStr: string): ExamSlot | null {
  if (!dateStr) return null;
  
  const slotTime = parseTimeToSlot(timeStr);
  if (!slotTime) return null;
  
  return {
    date: dateStr,
    time: slotTime,
    timeDisplay: slotTime === 'morning' ? '09:00-12:00' : '13:00-16:00'
  };
}

// Get subjects that need scheduling (from 060.csv, without existing schedule)
export function getSubjectsNeedingSchedule(
  subjects: Subject[],
  rules: Rules,
  examType: 'midterm' | 'final'
): Subject[] {
  // Get the no-exam list based on exam type
  const noExamCodes = examType === 'midterm' 
    ? [...rules.noMidterm, ...rules.noExam]
    : [...rules.noFinal, ...rules.noExam];
  
  return subjects.filter(subject => {
    // Only schedule subjects from 060.csv
    if (subject.source !== 'schedulable') return false;
    
    // Skip subjects that don't need this exam
    if (noExamCodes.includes(subject.code)) return false;
    
    // Skip subjects that already have schedule for this exam type
    if (examType === 'midterm' && subject.midtermDate) return false;
    if (examType === 'final' && subject.finalDate) return false;
    
    return true;
  });
}

// Get fixed schedule from 040.csv and 080.csv
export function getFixedSchedule(subjects: Subject[]): ScheduledExam[] {
  const scheduled: ScheduledExam[] = [];
  
  for (const subject of subjects) {
    if (subject.source !== 'fixed') continue;
    
    // Add midterm if scheduled
    if (subject.midtermDate) {
      const slot = createSlotFromStrings(subject.midtermDate, subject.midtermTime || '09:00');
      if (slot) {
        scheduled.push({ subject, slot, examType: 'midterm' });
      }
    }
    
    // Add final if scheduled
    if (subject.finalDate) {
      const slot = createSlotFromStrings(subject.finalDate, subject.finalTime || '09:00');
      if (slot) {
        scheduled.push({ subject, slot, examType: 'final' });
      }
    }
  }
  
  return scheduled;
}

// Get pre-scheduled exams from 060.csv that already have dates
export function getPreScheduled060(subjects: Subject[]): ScheduledExam[] {
  const scheduled: ScheduledExam[] = [];
  
  for (const subject of subjects) {
    if (subject.source !== 'schedulable') continue;
    
    // Add midterm if already scheduled
    if (subject.midtermDate) {
      const slot = createSlotFromStrings(subject.midtermDate, subject.midtermTime || '09:00');
      if (slot) {
        scheduled.push({ subject, slot, examType: 'midterm' });
      }
    }
    
    // Add final if already scheduled
    if (subject.finalDate) {
      const slot = createSlotFromStrings(subject.finalDate, subject.finalTime || '09:00');
      if (slot) {
        scheduled.push({ subject, slot, examType: 'final' });
      }
    }
  }
  
  return scheduled;
}

// Schedule exams using a balanced algorithm with conflict checking
export function scheduleExams(
  subjects: Subject[],
  options: SchedulerOptions
): ScheduleResult {
  const { rules, midtermPeriod, finalPeriod } = options;
  
  // Generate available slots (weekdays first)
  const midtermDates = getExamDates(midtermPeriod, false);
  const finalDates = getExamDates(finalPeriod, false);
  const midtermSlots = generateSlots(midtermDates);
  const finalSlots = generateSlots(finalDates);
  
  // Also prepare weekend slots as fallback
  const midtermWeekendDates = getExamDates(midtermPeriod, true).filter(d => d.getDay() === 0 || d.getDay() === 6);
  const finalWeekendDates = getExamDates(finalPeriod, true).filter(d => d.getDay() === 0 || d.getDay() === 6);
  const midtermWeekendSlots = generateSlots(midtermWeekendDates);
  const finalWeekendSlots = generateSlots(finalWeekendDates);
  
  // Start with fixed schedules (040, 080)
  const scheduled: ScheduledExam[] = [
    ...getFixedSchedule(subjects),
    ...getPreScheduled060(subjects)
  ];
  
  const unscheduled: Subject[] = [];
  const allConflicts: ScheduleConflict[] = [];
  
  // Group subjects by code to ensure same exam time for all sections
  const groupedSubjects = groupSubjectsByCode(subjects);
  
  // Build same-time constraint map
  const sameTimeMap = buildSameTimeMap(rules.sameTimeGroups, groupedSubjects);
  
  // Track slot usage for load balancing
  const slotUsage = new Map<string, number>();
  
  // Track which dates have full-day exams (both slots used)
  const fullDayDates = new Map<string, Set<string>>(); // date -> Set of exam types using full day
  
  // Initialize slot usage from already scheduled exams
  for (const exam of scheduled) {
    const key = `${exam.slot.date}-${exam.slot.time}-${exam.examType}`;
    slotUsage.set(key, (slotUsage.get(key) || 0) + 1);
  }
  
  // Process each exam type
  for (const examType of ['midterm', 'final'] as const) {
    let slots = examType === 'midterm' ? midtermSlots : finalSlots;
    const weekendSlots = examType === 'midterm' ? midtermWeekendSlots : finalWeekendSlots;
    const needsScheduling = getSubjectsNeedingSchedule(subjects, rules, examType);
    
    // Group by subject code (all sections get same slot)
    const subjectCodes = [...new Set(needsScheduling.map(s => s.code))];
    
    // Separate full-day exams from regular exams
    const fullDayCodes = subjectCodes.filter(code => rules.fullDayExam.includes(code));
    const regularCodes = subjectCodes.filter(code => !rules.fullDayExam.includes(code));
    
    // Calculate target exams per slot for even distribution
    const totalToSchedule = regularCodes.length;
    const targetPerSlot = Math.ceil(totalToSchedule / slots.length);
    
    // Schedule full-day exams first (they need both slots)
    for (const code of fullDayCodes) {
      const codeSubjects = needsScheduling.filter(s => s.code === code);
      
      // Find a date where both morning and afternoon are available
      const result = findBestFullDaySlot(codeSubjects, slots, weekendSlots, examType, scheduled, slotUsage);
      
      if (result.slot) {
        // Schedule in both morning and afternoon
        const morningSlot = result.slot;
        const afternoonSlot: ExamSlot = {
          ...morningSlot,
          time: 'afternoon',
          timeDisplay: '09:00-16:00' // Full day display
        };
        
        for (const subject of codeSubjects) {
          // Add as a single full-day exam entry with special time display
          scheduled.push({ 
            subject, 
            slot: { ...morningSlot, timeDisplay: '09:00-16:00' }, 
            examType 
          });
        }
        
        // Mark both slots as used
        const morningKey = `${morningSlot.date}-morning-${examType}`;
        const afternoonKey = `${morningSlot.date}-afternoon-${examType}`;
        slotUsage.set(morningKey, (slotUsage.get(morningKey) || 0) + 1);
        slotUsage.set(afternoonKey, (slotUsage.get(afternoonKey) || 0) + 1);
        
        // Track full-day date
        if (!fullDayDates.has(morningSlot.date)) {
          fullDayDates.set(morningSlot.date, new Set());
        }
        fullDayDates.get(morningSlot.date)!.add(examType);
      } else {
        unscheduled.push(...codeSubjects);
      }
    }
    
    // Sort regular subjects by number of conflicts (most constrained first)
    const subjectsByConflicts = sortByConflicts(regularCodes, needsScheduling, scheduled);
    
    for (const code of subjectsByConflicts) {
      const codeSubjects = needsScheduling.filter(s => s.code === code);
      
      // Check if this subject is part of a same-time group
      const sameTimeSlot = sameTimeMap.get(code);
      
      if (sameTimeSlot) {
        // Use the pre-determined slot - schedule even if there are conflicts
        for (const subject of codeSubjects) {
          scheduled.push({ subject, slot: sameTimeSlot, examType });
          const key = `${sameTimeSlot.date}-${sameTimeSlot.time}-${examType}`;
          slotUsage.set(key, (slotUsage.get(key) || 0) + 1);
        }
      } else {
        // Find best slot using load balancing (weekdays first)
        let result = findBestSlotBalanced(codeSubjects, slots, examType, scheduled, rules, slotUsage, targetPerSlot);
        
        // If all weekday slots have conflicts, try weekend slots
        if (!result.slot || result.conflictCount > 0) {
          const weekendResult = findBestSlotBalanced(codeSubjects, weekendSlots, examType, scheduled, rules, slotUsage, targetPerSlot);
          
          // Use weekend slot if it has fewer conflicts
          if (weekendResult.slot && (!result.slot || weekendResult.conflictCount < result.conflictCount)) {
            result = weekendResult;
          }
        }
        
        if (result.slot) {
          for (const subject of codeSubjects) {
            scheduled.push({ subject, slot: result.slot, examType });
          }
          const key = `${result.slot.date}-${result.slot.time}-${examType}`;
          slotUsage.set(key, (slotUsage.get(key) || 0) + 1);
          
          // Update same-time map if this subject is in a group
          updateSameTimeMap(code, result.slot, rules.sameTimeGroups, sameTimeMap);
        } else {
          unscheduled.push(...codeSubjects);
        }
      }
    }
  }
  
  // Final validation
  const validationConflicts = validateSchedule(scheduled);
  allConflicts.push(...validationConflicts);
  
  return {
    scheduled,
    unscheduled,
    conflicts: allConflicts
  };
}

// Find best slot for full-day exam (needs both morning and afternoon)
function findBestFullDaySlot(
  subjects: Subject[],
  slots: ExamSlot[],
  weekendSlots: ExamSlot[],
  examType: 'midterm' | 'final',
  scheduled: ScheduledExam[],
  slotUsage: Map<string, number>
): { slot: ExamSlot | null } {
  // Get unique dates from morning slots only
  const dates = [...new Set(slots.filter(s => s.time === 'morning').map(s => s.date))];
  
  type DateScore = { date: string; slot: ExamSlot; score: number; conflictCount: number };
  const scoredDates: DateScore[] = [];
  
  for (const date of dates) {
    const morningSlot = slots.find(s => s.date === date && s.time === 'morning');
    const afternoonSlot = slots.find(s => s.date === date && s.time === 'afternoon');
    
    if (!morningSlot || !afternoonSlot) continue;
    
    let totalConflicts = 0;
    
    for (const subject of subjects) {
      const morningConflicts = checkSlotConflicts(subject, morningSlot, examType, scheduled);
      const afternoonConflicts = checkSlotConflicts(subject, afternoonSlot, examType, scheduled);
      totalConflicts += morningConflicts.length + afternoonConflicts.length;
    }
    
    const morningKey = `${date}-morning-${examType}`;
    const afternoonKey = `${date}-afternoon-${examType}`;
    const usage = (slotUsage.get(morningKey) || 0) + (slotUsage.get(afternoonKey) || 0);
    
    // Score: prioritize no conflicts, then less usage
    const score = totalConflicts * 100000 + usage * 10;
    
    scoredDates.push({ date, slot: morningSlot, score, conflictCount: totalConflicts });
  }
  
  // Sort by score
  scoredDates.sort((a, b) => a.score - b.score);
  
  // If best weekday has conflicts, try weekends
  if (scoredDates.length > 0 && scoredDates[0].conflictCount > 0 && weekendSlots.length > 0) {
    const weekendDates = [...new Set(weekendSlots.filter(s => s.time === 'morning').map(s => s.date))];
    
    for (const date of weekendDates) {
      const morningSlot = weekendSlots.find(s => s.date === date && s.time === 'morning');
      const afternoonSlot = weekendSlots.find(s => s.date === date && s.time === 'afternoon');
      
      if (!morningSlot || !afternoonSlot) continue;
      
      let totalConflicts = 0;
      for (const subject of subjects) {
        const morningConflicts = checkSlotConflicts(subject, morningSlot, examType, scheduled);
        const afternoonConflicts = checkSlotConflicts(subject, afternoonSlot, examType, scheduled);
        totalConflicts += morningConflicts.length + afternoonConflicts.length;
      }
      
      // If weekend has fewer conflicts, use it
      if (totalConflicts < scoredDates[0].conflictCount) {
        return { slot: morningSlot };
      }
    }
  }
  
  if (scoredDates.length > 0) {
    return { slot: scoredDates[0].slot };
  }
  
  return { slot: null };
}

// Build a map from subject code to assigned slot for same-time groups
function buildSameTimeMap(
  sameTimeGroups: string[][],
  groupedSubjects: Map<string, Subject[]>
): Map<string, ExamSlot> {
  const map = new Map<string, ExamSlot>();
  
  // Check if any subject in same-time group already has a schedule
  for (const group of sameTimeGroups) {
    for (const code of group) {
      const subjects = groupedSubjects.get(code);
      if (!subjects) continue;
      
      for (const subject of subjects) {
        // Check if this subject already has a schedule
        if (subject.midtermDate) {
          const slot = createSlotFromStrings(subject.midtermDate, subject.midtermTime || '09:00');
          if (slot) {
            // Apply to all subjects in this group
            for (const groupCode of group) {
              map.set(groupCode, slot);
            }
            break;
          }
        }
      }
    }
  }
  
  return map;
}

// Update same-time map when we schedule a subject that's in a group
function updateSameTimeMap(
  code: string,
  slot: ExamSlot,
  sameTimeGroups: string[][],
  sameTimeMap: Map<string, ExamSlot>
): void {
  for (const group of sameTimeGroups) {
    if (group.includes(code)) {
      for (const groupCode of group) {
        sameTimeMap.set(groupCode, slot);
      }
    }
  }
}

// Sort subject codes by how constrained they are (most conflicts first)
function sortByConflicts(
  codes: string[],
  subjects: Subject[],
  scheduled: ScheduledExam[]
): string[] {
  const conflictCounts = new Map<string, number>();
  
  for (const code of codes) {
    const codeSubjects = subjects.filter(s => s.code === code);
    let count = 0;
    
    // Count potential conflicts with already scheduled exams
    for (const subject of codeSubjects) {
      for (const exam of scheduled) {
        for (const group of subject.studentGroups) {
          if (exam.subject.studentGroups.includes(group)) {
            count++;
          }
        }
      }
    }
    
    // Also count conflicts with other unscheduled subjects
    for (const subject of codeSubjects) {
      for (const other of subjects) {
        if (other.code === code) continue;
        for (const group of subject.studentGroups) {
          if (other.studentGroups.includes(group)) {
            count++;
          }
        }
      }
    }
    
    conflictCounts.set(code, count);
  }
  
  return codes.sort((a, b) => (conflictCounts.get(b) || 0) - (conflictCounts.get(a) || 0));
}

// Find the best slot using load balancing - prefer least loaded slots without conflicts
// Uses a more sophisticated scoring that counts actual number of conflicting student groups
function findBestSlotBalanced(
  subjects: Subject[],
  slots: ExamSlot[],
  examType: 'midterm' | 'final',
  scheduled: ScheduledExam[],
  rules: Rules,
  slotUsage: Map<string, number>,
  targetPerSlot: number
): { slot: ExamSlot | null; conflicts: ScheduleConflict[]; conflictCount: number } {
  // Check if this is a full-day exam (shouldn't happen here, but check anyway)
  const isFullDay = subjects.some(s => rules.fullDayExam.includes(s.code));
  
  // Collect all student groups from the subjects we're trying to schedule
  const subjectGroups = new Set<string>();
  for (const subject of subjects) {
    for (const group of subject.studentGroups) {
      subjectGroups.add(group);
    }
  }
  
  // Score each slot: lower is better
  type SlotScore = {
    slot: ExamSlot;
    score: number;
    conflictCount: number;
    affectedGroups: number;
    usage: number;
  };
  
  const scoredSlots: SlotScore[] = [];
  
  for (const slot of slots) {
    // For full-day exams, only use morning slots (they take both morning and afternoon)
    if (isFullDay && slot.time !== 'morning') continue;
    
    let totalConflicts = 0;
    const affectedGroupsSet = new Set<string>();
    
    for (const subject of subjects) {
      const conflicts = checkSlotConflicts(subject, slot, examType, scheduled);
      totalConflicts += conflicts.length;
      
      for (const conflict of conflicts) {
        affectedGroupsSet.add(conflict.studentGroup);
      }
      
      // For full-day exams, also check afternoon slot
      if (isFullDay) {
        const afternoonSlot: ExamSlot = {
          ...slot,
          time: 'afternoon',
          timeDisplay: '13:00-16:00'
        };
        const afternoonConflicts = checkSlotConflicts(subject, afternoonSlot, examType, scheduled);
        totalConflicts += afternoonConflicts.length;
        
        for (const conflict of afternoonConflicts) {
          affectedGroupsSet.add(conflict.studentGroup);
        }
      }
    }
    
    const key = `${slot.date}-${slot.time}-${examType}`;
    const usage = slotUsage.get(key) || 0;
    const affectedGroups = affectedGroupsSet.size;
    
    // Calculate score - prioritize avoiding conflicts above all else
    // Each conflict is a HUGE penalty - we want to minimize conflicts first
    // Then balance load as a secondary concern
    let score = 0;
    
    // Massive penalty for each conflict - this is the PRIMARY concern
    score += totalConflicts * 100000;
    
    // Additional penalty for each affected student group
    score += affectedGroups * 50000;
    
    // Secondary: Penalize slots that are already at or over target
    if (usage >= targetPerSlot) {
      score += 100 * (usage - targetPerSlot + 1);
    }
    
    // Tertiary: Light penalty for any existing usage (prefer spreading)
    score += usage * 10;
    
    scoredSlots.push({ slot, score, conflictCount: totalConflicts, affectedGroups, usage });
  }
  
  // Sort by score (lowest first)
  scoredSlots.sort((a, b) => a.score - b.score);
  
  // Return the best slot (lowest score)
  const best = scoredSlots[0];
  if (best) {
    return { slot: best.slot, conflicts: [], conflictCount: best.conflictCount };
  }
  
  return { slot: null, conflicts: [], conflictCount: 0 };
}

// Export schedule to CSV format
export function exportScheduleToCSV(scheduled: ScheduledExam[]): string {
  const headers = ['รหัสวิชา', 'ชื่อวิชา', 'ตอน', 'กลุ่มนักศึกษา', 'ประเภทสอบ', 'วันสอบ', 'เวลาสอบ'];
  
  const rows = scheduled.map(exam => [
    exam.subject.code,
    exam.subject.name,
    exam.subject.section.toString(),
    exam.subject.studentGroups.join('; '),
    exam.examType === 'midterm' ? 'กลางภาค' : 'ปลายภาค',
    exam.slot.date,
    exam.slot.timeDisplay
  ]);
  
  // Sort by date, then by time, then by subject code
  rows.sort((a, b) => {
    const dateA = parseThaiDate(a[5])?.getTime() || 0;
    const dateB = parseThaiDate(b[5])?.getTime() || 0;
    if (dateA !== dateB) return dateA - dateB;
    
    if (a[6] !== b[6]) return a[6] < b[6] ? -1 : 1;
    
    return a[0].localeCompare(b[0]);
  });
  
  const csvRows = [headers, ...rows];
  
  return csvRows.map(row => 
    row.map(cell => {
      // Escape quotes and wrap in quotes if contains comma or newline
      const escaped = cell.replace(/"/g, '""');
      if (escaped.includes(',') || escaped.includes('\n') || escaped.includes('"')) {
        return `"${escaped}"`;
      }
      return escaped;
    }).join(',')
  ).join('\n');
}
