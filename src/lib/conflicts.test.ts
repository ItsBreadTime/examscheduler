import { describe, it, expect } from 'vitest';
import { 
  hasConflict, 
  getConflictingGroups, 
  buildConflictMap,
  checkSlotConflicts,
  validateSchedule
} from './conflicts';
import type { Subject, ExamSlot, ScheduledExam } from './types';

// Helper to create test subjects
function createSubject(
  code: string, 
  section: number, 
  studentGroups: string[],
  source: 'fixed' | 'schedulable' = 'schedulable'
): Subject {
  return {
    code,
    name: `Test Subject ${code}`,
    section,
    studentGroups,
    source
  };
}

describe('hasConflict', () => {
  it('should detect conflict when subjects share a student group', () => {
    const subject1 = createSubject('001', 1, ['Group-A', 'Group-B']);
    const subject2 = createSubject('002', 1, ['Group-B', 'Group-C']);
    
    expect(hasConflict(subject1, subject2)).toBe(true);
  });

  it('should not detect conflict when subjects have no shared groups', () => {
    const subject1 = createSubject('001', 1, ['Group-A', 'Group-B']);
    const subject2 = createSubject('002', 1, ['Group-C', 'Group-D']);
    
    expect(hasConflict(subject1, subject2)).toBe(false);
  });

  it('should not conflict with same subject code', () => {
    const subject1 = createSubject('001', 1, ['Group-A']);
    const subject2 = createSubject('001', 2, ['Group-A']);
    
    expect(hasConflict(subject1, subject2)).toBe(false);
  });

  it('should detect conflict with multiple shared groups', () => {
    const subject1 = createSubject('001', 1, ['Group-A', 'Group-B', 'Group-C']);
    const subject2 = createSubject('002', 1, ['Group-B', 'Group-C', 'Group-D']);
    
    expect(hasConflict(subject1, subject2)).toBe(true);
  });
});

describe('getConflictingGroups', () => {
  it('should return shared student groups', () => {
    const subject1 = createSubject('001', 1, ['Group-A', 'Group-B', 'Group-C']);
    const subject2 = createSubject('002', 1, ['Group-B', 'Group-C', 'Group-D']);
    
    const conflicting = getConflictingGroups(subject1, subject2);
    
    expect(conflicting).toContain('Group-B');
    expect(conflicting).toContain('Group-C');
    expect(conflicting).not.toContain('Group-A');
    expect(conflicting).not.toContain('Group-D');
  });

  it('should return empty array for no conflicts', () => {
    const subject1 = createSubject('001', 1, ['Group-A']);
    const subject2 = createSubject('002', 1, ['Group-B']);
    
    expect(getConflictingGroups(subject1, subject2)).toEqual([]);
  });
});

describe('buildConflictMap', () => {
  it('should build conflict map for subjects', () => {
    const subjects = [
      createSubject('001', 1, ['Group-A', 'Group-B']),
      createSubject('002', 1, ['Group-B', 'Group-C']),
      createSubject('003', 1, ['Group-D'])
    ];
    
    const conflictMap = buildConflictMap(subjects);
    
    expect(conflictMap.get('001-1')).toContain('002-1');
    expect(conflictMap.get('002-1')).toContain('001-1');
    expect(conflictMap.get('003-1')?.size).toBe(0);
  });

  it('should handle empty subject list', () => {
    const conflictMap = buildConflictMap([]);
    expect(conflictMap.size).toBe(0);
  });
});

describe('checkSlotConflicts', () => {
  const testSlot: ExamSlot = {
    date: '20/01/68',
    time: 'morning',
    timeDisplay: '09:00-12:00'
  };

  it('should detect conflict when subject shares group with scheduled exam', () => {
    const scheduled: ScheduledExam[] = [{
      subject: createSubject('001', 1, ['Group-A']),
      slot: testSlot,
      examType: 'midterm'
    }];

    const newSubject = createSubject('002', 1, ['Group-A']);
    const conflicts = checkSlotConflicts(newSubject, testSlot, 'midterm', scheduled);
    
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].studentGroup).toBe('Group-A');
  });

  it('should not detect conflict for different time slots', () => {
    const scheduled: ScheduledExam[] = [{
      subject: createSubject('001', 1, ['Group-A']),
      slot: testSlot,
      examType: 'midterm'
    }];

    const afternoonSlot: ExamSlot = {
      date: '20/01/68',
      time: 'afternoon',
      timeDisplay: '13:00-16:00'
    };

    const newSubject = createSubject('002', 1, ['Group-A']);
    const conflicts = checkSlotConflicts(newSubject, afternoonSlot, 'midterm', scheduled);
    
    expect(conflicts.length).toBe(0);
  });

  it('should not detect conflict for different dates', () => {
    const scheduled: ScheduledExam[] = [{
      subject: createSubject('001', 1, ['Group-A']),
      slot: testSlot,
      examType: 'midterm'
    }];

    const differentDay: ExamSlot = {
      date: '21/01/68',
      time: 'morning',
      timeDisplay: '09:00-12:00'
    };

    const newSubject = createSubject('002', 1, ['Group-A']);
    const conflicts = checkSlotConflicts(newSubject, differentDay, 'midterm', scheduled);
    
    expect(conflicts.length).toBe(0);
  });

  it('should not detect conflict for different exam types', () => {
    const scheduled: ScheduledExam[] = [{
      subject: createSubject('001', 1, ['Group-A']),
      slot: testSlot,
      examType: 'midterm'
    }];

    const newSubject = createSubject('002', 1, ['Group-A']);
    const conflicts = checkSlotConflicts(newSubject, testSlot, 'final', scheduled);
    
    expect(conflicts.length).toBe(0);
  });
});

describe('validateSchedule', () => {
  const testSlot: ExamSlot = {
    date: '20/01/68',
    time: 'morning',
    timeDisplay: '09:00-12:00'
  };

  it('should detect conflicts in complete schedule', () => {
    const scheduled: ScheduledExam[] = [
      {
        subject: createSubject('001', 1, ['Group-A']),
        slot: testSlot,
        examType: 'midterm'
      },
      {
        subject: createSubject('002', 1, ['Group-A', 'Group-B']),
        slot: testSlot,
        examType: 'midterm'
      }
    ];

    const conflicts = validateSchedule(scheduled);
    
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].studentGroup).toBe('Group-A');
  });

  it('should return empty array for conflict-free schedule', () => {
    const scheduled: ScheduledExam[] = [
      {
        subject: createSubject('001', 1, ['Group-A']),
        slot: testSlot,
        examType: 'midterm'
      },
      {
        subject: createSubject('002', 1, ['Group-B']),
        slot: testSlot,
        examType: 'midterm'
      }
    ];

    const conflicts = validateSchedule(scheduled);
    
    expect(conflicts.length).toBe(0);
  });

  it('should handle multiple conflicts', () => {
    const scheduled: ScheduledExam[] = [
      {
        subject: createSubject('001', 1, ['Group-A', 'Group-B']),
        slot: testSlot,
        examType: 'midterm'
      },
      {
        subject: createSubject('002', 1, ['Group-A']),
        slot: testSlot,
        examType: 'midterm'
      },
      {
        subject: createSubject('003', 1, ['Group-B']),
        slot: testSlot,
        examType: 'midterm'
      }
    ];

    const conflicts = validateSchedule(scheduled);
    
    expect(conflicts.length).toBe(2);
  });
});
