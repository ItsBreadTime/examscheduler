import { describe, it, expect } from 'vitest';
import { 
  parseThaiDate, 
  formatThaiDate, 
  getExamDates, 
  generateSlots 
} from './types';
import type { ExamPeriod } from './types';

describe('parseThaiDate', () => {
  it('should parse Thai Buddhist date correctly', () => {
    const date = parseThaiDate('20/01/68');
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2025);
    expect(date!.getMonth()).toBe(0); // January
    expect(date!.getDate()).toBe(20);
  });

  it('should parse another date correctly', () => {
    const date = parseThaiDate('17/03/68');
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2025);
    expect(date!.getMonth()).toBe(2); // March
    expect(date!.getDate()).toBe(17);
  });

  it('should return null for empty string', () => {
    expect(parseThaiDate('')).toBeNull();
  });

  it('should return null for invalid format', () => {
    expect(parseThaiDate('invalid')).toBeNull();
    expect(parseThaiDate('20-01-68')).toBeNull();
  });
});

describe('formatThaiDate', () => {
  it('should format date to Thai Buddhist calendar', () => {
    const date = new Date(2025, 0, 20); // Jan 20, 2025
    expect(formatThaiDate(date)).toBe('20/01/68');
  });

  it('should format March date correctly', () => {
    const date = new Date(2025, 2, 17); // Mar 17, 2025
    expect(formatThaiDate(date)).toBe('17/03/68');
  });

  it('should pad single digit day and month', () => {
    const date = new Date(2025, 0, 5); // Jan 5, 2025
    expect(formatThaiDate(date)).toBe('05/01/68');
  });
});

describe('getExamDates', () => {
  it('should return dates within period', () => {
    const period: ExamPeriod = {
      name: 'midterm',
      startDate: new Date(2025, 0, 20),
      endDate: new Date(2025, 0, 22)
    };
    
    const dates = getExamDates(period, true); // Include weekends for this test
    expect(dates.length).toBe(3);
    expect(dates[0].getDate()).toBe(20);
    expect(dates[1].getDate()).toBe(21);
    expect(dates[2].getDate()).toBe(22);
  });

  it('should exclude weekends by default', () => {
    // Jan 18 2025 is Saturday, Jan 19 is Sunday
    const period: ExamPeriod = {
      name: 'midterm',
      startDate: new Date(2025, 0, 17), // Friday
      endDate: new Date(2025, 0, 21)    // Tuesday
    };
    
    const dates = getExamDates(period); // Weekends excluded by default
    // Should only have Friday, Monday, Tuesday (no Sat/Sun)
    expect(dates.length).toBe(3);
    expect(dates[0].getDay()).toBe(5); // Friday
    expect(dates[1].getDay()).toBe(1); // Monday
    expect(dates[2].getDay()).toBe(2); // Tuesday
  });

  it('should include weekends when requested', () => {
    const period: ExamPeriod = {
      name: 'midterm',
      startDate: new Date(2025, 0, 17),
      endDate: new Date(2025, 0, 21)
    };
    
    const dates = getExamDates(period, true); // Include weekends
    expect(dates.length).toBe(5);
  });
});

describe('generateSlots', () => {
  it('should generate morning and afternoon slots for each date', () => {
    const dates = [new Date(2025, 0, 20), new Date(2025, 0, 21)];
    const slots = generateSlots(dates);
    
    expect(slots.length).toBe(4);
    
    expect(slots[0].date).toBe('20/01/68');
    expect(slots[0].time).toBe('morning');
    expect(slots[0].timeDisplay).toBe('09:00-12:00');
    
    expect(slots[1].date).toBe('20/01/68');
    expect(slots[1].time).toBe('afternoon');
    expect(slots[1].timeDisplay).toBe('13:00-16:00');
    
    expect(slots[2].date).toBe('21/01/68');
    expect(slots[2].time).toBe('morning');
  });

  it('should return empty array for no dates', () => {
    expect(generateSlots([])).toEqual([]);
  });
});
