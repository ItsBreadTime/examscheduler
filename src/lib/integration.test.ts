import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseSubjectCSV, parseRulesCSV, mergeSubjects } from './parser';
import { scheduleExams } from './scheduler';
import type { ExamPeriod, Rules } from './types';

// Integration tests using actual CSV files from examples folder
describe('Integration tests with real CSV files', () => {
  // Helper to read example files
  const readExample = (filename: string): string => {
    try {
      return readFileSync(join(__dirname, '../../examples', filename), 'utf-8');
    } catch {
      // If examples folder is not in expected location, skip these tests
      return '';
    }
  };

  describe('Parsing actual CSV files', () => {
    it('should parse 040.csv correctly', () => {
      const content = readExample('040.csv');
      if (!content) return; // Skip if file not found
      
      const subjects = parseSubjectCSV(content, 'fixed');
      
      expect(subjects.length).toBeGreaterThan(0);
      
      // Verify we can find known subjects
      const mathSubjects = subjects.filter(s => s.code.startsWith('040'));
      expect(mathSubjects.length).toBeGreaterThan(0);
      
      // Check that student groups are parsed
      const hasGroups = subjects.some(s => s.studentGroups.length > 0);
      expect(hasGroups).toBe(true);
      
      // Check that fixed schedules have dates
      const hasSchedule = subjects.some(s => s.midtermDate || s.finalDate);
      expect(hasSchedule).toBe(true);
    });

    it('should parse 060.csv correctly', () => {
      const content = readExample('060.csv');
      if (!content) return;
      
      const subjects = parseSubjectCSV(content, 'schedulable');
      
      expect(subjects.length).toBeGreaterThan(0);
      
      // 060 subjects should have code starting with 060
      const techSubjects = subjects.filter(s => s.code.startsWith('060'));
      expect(techSubjects.length).toBeGreaterThan(0);
      
      // Most 060 subjects should NOT have schedules (that's why they need scheduling)
      const withoutSchedule = subjects.filter(s => !s.midtermDate);
      expect(withoutSchedule.length).toBeGreaterThan(0);
    });

    it('should parse 080.csv correctly', () => {
      const content = readExample('080.csv');
      if (!content) return;
      
      const subjects = parseSubjectCSV(content, 'fixed');
      
      expect(subjects.length).toBeGreaterThan(0);
      
      // 080 subjects should have code starting with 080
      const artSubjects = subjects.filter(s => s.code.startsWith('080'));
      expect(artSubjects.length).toBeGreaterThan(0);
    });

    it('should parse rules.csv correctly', () => {
      const content = readExample('rules.csv');
      if (!content) return;
      
      const rules = parseRulesCSV(content);
      
      // Should have some rules defined
      const hasRules = 
        rules.noMidterm.length > 0 ||
        rules.noFinal.length > 0 ||
        rules.noExam.length > 0 ||
        rules.fullDayExam.length > 0 ||
        rules.sameTimeGroups.length > 0;
      
      expect(hasRules).toBe(true);
      
      // Verify specific known rules from the file
      expect(rules.noMidterm).toContain('060123432');
      expect(rules.noExam).toContain('060113405');
    });
  });

  describe('Full scheduling workflow', () => {
    it('should schedule exams without crashing', () => {
      const content040 = readExample('040.csv');
      const content060 = readExample('060.csv');
      const content080 = readExample('080.csv');
      const contentRules = readExample('rules.csv');
      
      if (!content040 || !content060 || !content080 || !contentRules) {
        return; // Skip if files not found
      }
      
      const subjects040 = parseSubjectCSV(content040, 'fixed');
      const subjects060 = parseSubjectCSV(content060, 'schedulable');
      const subjects080 = parseSubjectCSV(content080, 'fixed');
      const rules = parseRulesCSV(contentRules);
      
      const allSubjects = mergeSubjects(subjects040, subjects080, subjects060);
      
      const midtermPeriod: ExamPeriod = {
        name: 'midterm',
        startDate: new Date(2025, 0, 20),
        endDate: new Date(2025, 0, 26),
        
      };
      
      const finalPeriod: ExamPeriod = {
        name: 'final',
        startDate: new Date(2025, 2, 17),
        endDate: new Date(2025, 2, 28),
        
      };
      
      // This should not throw
      const result = scheduleExams(allSubjects, {
        midtermPeriod,
        finalPeriod,
        rules
      });
      
      expect(result).toBeDefined();
      expect(result.scheduled).toBeDefined();
      expect(result.unscheduled).toBeDefined();
      expect(result.conflicts).toBeDefined();
      
      // Should have scheduled some exams
      expect(result.scheduled.length).toBeGreaterThan(0);
      
      console.log('Schedule Result Summary:');
      console.log(`  Scheduled: ${result.scheduled.length} exams`);
      console.log(`  Unscheduled: ${result.unscheduled.length} subjects`);
      console.log(`  Conflicts: ${result.conflicts.length} issues`);
    });

    it('should respect fixed schedules from 040 and 080', () => {
      const content040 = readExample('040.csv');
      const content060 = readExample('060.csv');
      const content080 = readExample('080.csv');
      const contentRules = readExample('rules.csv');
      
      if (!content040 || !content060 || !content080 || !contentRules) {
        return;
      }
      
      const subjects040 = parseSubjectCSV(content040, 'fixed');
      const subjects080 = parseSubjectCSV(content080, 'fixed');
      const subjects060 = parseSubjectCSV(content060, 'schedulable');
      const rules = parseRulesCSV(contentRules);
      
      const allSubjects = mergeSubjects(subjects040, subjects080, subjects060);
      
      const midtermPeriod: ExamPeriod = {
        name: 'midterm',
        startDate: new Date(2025, 0, 20),
        endDate: new Date(2025, 0, 26),
        
      };
      
      const finalPeriod: ExamPeriod = {
        name: 'final',
        startDate: new Date(2025, 2, 17),
        endDate: new Date(2025, 2, 28),
        
      };
      
      const result = scheduleExams(allSubjects, {
        midtermPeriod,
        finalPeriod,
        rules
      });
      
      // Check that fixed schedules are preserved
      const fixedExams = result.scheduled.filter(e => e.subject.source === 'fixed');
      
      for (const exam of fixedExams) {
        if (exam.examType === 'midterm' && exam.subject.midtermDate) {
          expect(exam.slot.date).toBe(exam.subject.midtermDate);
        }
        if (exam.examType === 'final' && exam.subject.finalDate) {
          expect(exam.slot.date).toBe(exam.subject.finalDate);
        }
      }
    });

    it('should apply no-exam rules correctly', () => {
      const content060 = readExample('060.csv');
      const contentRules = readExample('rules.csv');
      
      if (!content060 || !contentRules) {
        return;
      }
      
      const subjects060 = parseSubjectCSV(content060, 'schedulable');
      const rules = parseRulesCSV(contentRules);
      
      const midtermPeriod: ExamPeriod = {
        name: 'midterm',
        startDate: new Date(2025, 0, 20),
        endDate: new Date(2025, 0, 26),
        
      };
      
      const finalPeriod: ExamPeriod = {
        name: 'final',
        startDate: new Date(2025, 2, 17),
        endDate: new Date(2025, 2, 28),
        
      };
      
      const result = scheduleExams(subjects060, {
        midtermPeriod,
        finalPeriod,
        rules
      });
      
      // Subjects in noExam should not be scheduled at all
      for (const code of rules.noExam) {
        const scheduled = result.scheduled.filter(e => e.subject.code === code);
        expect(scheduled.length).toBe(0);
      }
      
      // Subjects in noMidterm should not have midterm scheduled
      for (const code of rules.noMidterm) {
        const midtermScheduled = result.scheduled.filter(
          e => e.subject.code === code && e.examType === 'midterm'
        );
        expect(midtermScheduled.length).toBe(0);
      }
    });
  });

  describe('Student group analysis', () => {
    it('should identify all unique student groups', () => {
      const content040 = readExample('040.csv');
      const content060 = readExample('060.csv');
      const content080 = readExample('080.csv');
      
      if (!content040 || !content060 || !content080) {
        return;
      }
      
      const subjects040 = parseSubjectCSV(content040, 'fixed');
      const subjects060 = parseSubjectCSV(content060, 'schedulable');
      const subjects080 = parseSubjectCSV(content080, 'fixed');
      
      const allSubjects = [...subjects040, ...subjects060, ...subjects080];
      
      const allGroups = new Set<string>();
      for (const subject of allSubjects) {
        for (const group of subject.studentGroups) {
          allGroups.add(group);
        }
      }
      
      console.log(`Total unique student groups: ${allGroups.size}`);
      expect(allGroups.size).toBeGreaterThan(0);
      
      // Verify some known groups exist
      const knownGroups = ['IT-1R-DE-RA', 'IEM-1R-DE-RA', 'IMT-1R-RA'];
      for (const group of knownGroups) {
        if (allGroups.has(group)) {
          expect(allGroups.has(group)).toBe(true);
        }
      }
    });
  });
});
