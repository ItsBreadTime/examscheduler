import { describe, it, expect } from 'vitest';
import { 
  scheduleExams, 
  getSubjectsNeedingSchedule,
  getFixedSchedule,
  getPreScheduled060,
  exportScheduleToCSV
} from './scheduler';
import type { Subject, Rules, ExamPeriod, ScheduledExam } from './types';

// Helper to create test subjects
function createSubject(
  code: string, 
  section: number, 
  studentGroups: string[],
  source: 'fixed' | 'schedulable' = 'schedulable',
  midtermDate?: string,
  finalDate?: string
): Subject {
  return {
    code,
    name: `Test Subject ${code}`,
    section,
    studentGroups,
    source,
    midtermDate,
    midtermTime: midtermDate ? '09:00-12:00' : undefined,
    finalDate,
    finalTime: finalDate ? '09:00-12:00' : undefined
  };
}

const defaultRules: Rules = {
  noMidterm: [],
  noFinal: [],
  noExam: [],
  fullDayExam: [],
  sameTimeGroups: []
};

const defaultPeriods = {
  midtermPeriod: {
    name: 'midterm' as const,
    startDate: new Date(2025, 0, 20),
    endDate: new Date(2025, 0, 24)
  },
  finalPeriod: {
    name: 'final' as const,
    startDate: new Date(2025, 2, 17),
    endDate: new Date(2025, 2, 21)
  }
};

describe('getSubjectsNeedingSchedule', () => {
  it('should return schedulable subjects without existing schedule', () => {
    const subjects = [
      createSubject('001', 1, ['Group-A'], 'schedulable'),
      createSubject('002', 1, ['Group-B'], 'schedulable', '20/01/68'),
      createSubject('003', 1, ['Group-C'], 'fixed', '20/01/68')
    ];

    const needScheduling = getSubjectsNeedingSchedule(subjects, defaultRules, 'midterm');
    
    expect(needScheduling.length).toBe(1);
    expect(needScheduling[0].code).toBe('001');
  });

  it('should exclude subjects in noMidterm list', () => {
    const subjects = [
      createSubject('001', 1, ['Group-A'], 'schedulable'),
      createSubject('002', 1, ['Group-B'], 'schedulable')
    ];

    const rules: Rules = { ...defaultRules, noMidterm: ['001'] };
    const needScheduling = getSubjectsNeedingSchedule(subjects, rules, 'midterm');
    
    expect(needScheduling.length).toBe(1);
    expect(needScheduling[0].code).toBe('002');
  });

  it('should exclude subjects in noExam list for both exam types', () => {
    const subjects = [
      createSubject('001', 1, ['Group-A'], 'schedulable'),
      createSubject('002', 1, ['Group-B'], 'schedulable')
    ];

    const rules: Rules = { ...defaultRules, noExam: ['001'] };
    
    const midtermNeed = getSubjectsNeedingSchedule(subjects, rules, 'midterm');
    const finalNeed = getSubjectsNeedingSchedule(subjects, rules, 'final');
    
    expect(midtermNeed.some(s => s.code === '001')).toBe(false);
    expect(finalNeed.some(s => s.code === '001')).toBe(false);
  });
});

describe('getFixedSchedule', () => {
  it('should extract scheduled exams from fixed subjects', () => {
    const subjects = [
      createSubject('001', 1, ['Group-A'], 'fixed', '20/01/68', '17/03/68'),
      createSubject('002', 1, ['Group-B'], 'schedulable', '20/01/68')
    ];

    const fixed = getFixedSchedule(subjects);
    
    expect(fixed.length).toBe(2); // One midterm, one final from fixed subject
    expect(fixed.every(e => e.subject.source === 'fixed')).toBe(true);
  });

  it('should not include subjects without dates', () => {
    const subjects = [
      createSubject('001', 1, ['Group-A'], 'fixed')
    ];

    const fixed = getFixedSchedule(subjects);
    expect(fixed.length).toBe(0);
  });
});

describe('getPreScheduled060', () => {
  it('should extract scheduled exams from schedulable subjects', () => {
    const subjects = [
      createSubject('001', 1, ['Group-A'], 'schedulable', '20/01/68', '17/03/68'),
      createSubject('002', 1, ['Group-B'], 'schedulable')
    ];

    const prescheduled = getPreScheduled060(subjects);
    
    expect(prescheduled.length).toBe(2);
    expect(prescheduled.every(e => e.subject.source === 'schedulable')).toBe(true);
  });
});

describe('scheduleExams', () => {
  it('should schedule subjects without conflicts', () => {
    const subjects = [
      createSubject('001', 1, ['Group-A'], 'schedulable'),
      createSubject('002', 1, ['Group-B'], 'schedulable'),
      createSubject('003', 1, ['Group-C'], 'schedulable')
    ];

    const result = scheduleExams(subjects, { ...defaultPeriods, rules: defaultRules });
    
    // Each subject should be scheduled for both midterm and final
    expect(result.scheduled.length).toBe(6);
    expect(result.unscheduled.length).toBe(0);
    expect(result.conflicts.length).toBe(0);
  });

  it('should respect fixed schedules', () => {
    const subjects = [
      createSubject('001', 1, ['Group-A'], 'fixed', '20/01/68', '17/03/68'),
      createSubject('002', 1, ['Group-B'], 'schedulable')
    ];

    const result = scheduleExams(subjects, { ...defaultPeriods, rules: defaultRules });
    
    const fixedExam = result.scheduled.find(
      e => e.subject.code === '001' && e.examType === 'midterm'
    );
    expect(fixedExam).toBeDefined();
    expect(fixedExam!.slot.date).toBe('20/01/68');
  });

  it('should avoid scheduling conflicts with fixed exams', () => {
    const subjects = [
      createSubject('001', 1, ['Group-A'], 'fixed', '20/01/68', '17/03/68'),
      createSubject('002', 1, ['Group-A'], 'schedulable') // Same group!
    ];

    const result = scheduleExams(subjects, { ...defaultPeriods, rules: defaultRules });
    
    // Subject 002 should be scheduled in different slot than 001
    const fixed = result.scheduled.find(
      e => e.subject.code === '001' && e.examType === 'midterm'
    );
    const scheduled = result.scheduled.find(
      e => e.subject.code === '002' && e.examType === 'midterm'
    );
    
    if (scheduled && fixed) {
      // Either different date or different time
      const differentSlot = 
        scheduled.slot.date !== fixed.slot.date || 
        scheduled.slot.time !== fixed.slot.time;
      expect(differentSlot).toBe(true);
    }
  });

  it('should apply noMidterm rules', () => {
    const subjects = [
      createSubject('001', 1, ['Group-A'], 'schedulable'),
      createSubject('002', 1, ['Group-B'], 'schedulable')
    ];

    const rules: Rules = { ...defaultRules, noMidterm: ['001'] };
    const result = scheduleExams(subjects, { ...defaultPeriods, rules });
    
    const subject001Midterm = result.scheduled.find(
      e => e.subject.code === '001' && e.examType === 'midterm'
    );
    expect(subject001Midterm).toBeUndefined();
  });

  it('should handle same-time groups', () => {
    const subjects = [
      createSubject('001', 1, ['Group-A'], 'schedulable'),
      createSubject('002', 1, ['Group-B'], 'schedulable')
    ];

    const rules: Rules = { ...defaultRules, sameTimeGroups: [['001', '002']] };
    const result = scheduleExams(subjects, { ...defaultPeriods, rules });
    
    const exam1 = result.scheduled.find(
      e => e.subject.code === '001' && e.examType === 'midterm'
    );
    const exam2 = result.scheduled.find(
      e => e.subject.code === '002' && e.examType === 'midterm'
    );
    
    if (exam1 && exam2) {
      expect(exam1.slot.date).toBe(exam2.slot.date);
      expect(exam1.slot.time).toBe(exam2.slot.time);
    }
  });
});

describe('exportScheduleToCSV', () => {
  it('should export schedule to CSV format', () => {
    const scheduled: ScheduledExam[] = [{
      subject: createSubject('001', 1, ['Group-A', 'Group-B']),
      slot: { date: '20/01/68', time: 'morning', timeDisplay: '09:00-12:00' },
      examType: 'midterm'
    }];

    const csv = exportScheduleToCSV(scheduled);
    
    expect(csv).toContain('รหัสวิชา');
    expect(csv).toContain('001');
    expect(csv).toContain('20/01/68');
    expect(csv).toContain('09:00-12:00');
    expect(csv).toContain('กลางภาค');
  });

  it('should handle special characters in student groups', () => {
    const scheduled: ScheduledExam[] = [{
      subject: createSubject('001', 1, ['IT-1R-DE-RA', 'IT-2R-DE-RB']),
      slot: { date: '20/01/68', time: 'morning', timeDisplay: '09:00-12:00' },
      examType: 'midterm'
    }];

    const csv = exportScheduleToCSV(scheduled);
    
    expect(csv).toContain('IT-1R-DE-RA');
    expect(csv).toContain('IT-2R-DE-RB');
  });

  it('should sort by date', () => {
    const scheduled: ScheduledExam[] = [
      {
        subject: createSubject('002', 1, ['Group-B']),
        slot: { date: '22/01/68', time: 'morning', timeDisplay: '09:00-12:00' },
        examType: 'midterm'
      },
      {
        subject: createSubject('001', 1, ['Group-A']),
        slot: { date: '20/01/68', time: 'morning', timeDisplay: '09:00-12:00' },
        examType: 'midterm'
      }
    ];

    const csv = exportScheduleToCSV(scheduled);
    const lines = csv.split('\n');
    
    // First data row should be earlier date
    expect(lines[1]).toContain('20/01/68');
    expect(lines[2]).toContain('22/01/68');
  });
});
