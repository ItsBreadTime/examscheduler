// Core types for the exam scheduler

export interface Subject {
  code: string;
  name: string;
  section: number;
  studentGroups: string[];
  midtermDate?: string;  // Format: DD/MM/YY (Thai Buddhist calendar)
  midtermTime?: string;  // Format: HH:MM-HH:MM
  finalDate?: string;
  finalTime?: string;
  source: 'fixed' | 'schedulable';  // fixed = 040/080, schedulable = 060
}

export interface ExamSlot {
  date: string;         // Format: DD/MM/YY
  time: 'morning' | 'afternoon';
  timeDisplay: string;  // "09:00-12:00" or "13:00-16:00"
}

export interface ScheduledExam {
  subject: Subject;
  slot: ExamSlot;
  examType: 'midterm' | 'final';
}

export interface ScheduleConflict {
  studentGroup: string;
  subjects: Subject[];
  slot: ExamSlot;
  examType: 'midterm' | 'final';
}

export interface Rules {
  noMidterm: string[];           // Subject codes with no midterm exam
  noFinal: string[];             // Subject codes with no final exam
  noExam: string[];              // Subject codes with no exam at all
  fullDayExam: string[];         // Subject codes needing 9:00-16:00 slot
  sameTimeGroups: string[][];    // Groups of subject codes that must have same exam time
}

export interface ExamPeriod {
  name: 'midterm' | 'final';
  startDate: Date;
  endDate: Date;
}

export interface ScheduleResult {
  scheduled: ScheduledExam[];
  unscheduled: Subject[];
  conflicts: ScheduleConflict[];
}

// Helper to parse Thai Buddhist calendar date (DD/MM/YY) to JS Date
export function parseThaiDate(dateStr: string): Date | null {
  if (!dateStr || dateStr.trim() === '') return null;
  
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // JS months are 0-indexed
  const buddhistYear = parseInt(parts[2], 10);
  
  // Convert Buddhist year to Gregorian (BE - 543 = CE)
  // If year is 2 digits like "68", it means 2568 BE = 2025 CE
  const gregorianYear = buddhistYear < 100 
    ? buddhistYear + 2500 - 543  // 68 -> 2568 -> 2025
    : buddhistYear - 543;
  
  return new Date(gregorianYear, month, day);
}

// Helper to format JS Date to Thai Buddhist calendar (DD/MM/YY)
export function formatThaiDate(date: Date): string {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const buddhistYear = (date.getFullYear() + 543) % 100;
  const yearStr = buddhistYear.toString().padStart(2, '0');
  
  return `${day}/${month}/${yearStr}`;
}

// Get available exam dates for a period (excludes weekends by default, but includes them if includeWeekends is true)
export function getExamDates(period: ExamPeriod, includeWeekends: boolean = false): Date[] {
  const dates: Date[] = [];
  const current = new Date(period.startDate);
  
  while (current <= period.endDate) {
    const dayOfWeek = current.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    if (includeWeekends || !isWeekend) {
      dates.push(new Date(current));
    }
    
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}

// Generate all possible exam slots for a period
export function generateSlots(dates: Date[]): ExamSlot[] {
  const slots: ExamSlot[] = [];
  
  for (const date of dates) {
    slots.push({
      date: formatThaiDate(date),
      time: 'morning',
      timeDisplay: '09:00-12:00'
    });
    slots.push({
      date: formatThaiDate(date),
      time: 'afternoon',
      timeDisplay: '13:00-16:00'
    });
  }
  
  return slots;
}
