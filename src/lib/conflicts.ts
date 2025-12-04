import type { Subject, ExamSlot, ScheduleConflict, ScheduledExam } from './types';

// Check if two subjects have overlapping student groups
export function hasConflict(subject1: Subject, subject2: Subject): boolean {
  // Same subject (any section) can't conflict with itself
  if (subject1.code === subject2.code) return false;
  
  for (const group of subject1.studentGroups) {
    if (subject2.studentGroups.includes(group)) {
      return true;
    }
  }
  
  return false;
}

// Get the conflicting student groups between two subjects
export function getConflictingGroups(subject1: Subject, subject2: Subject): string[] {
  // Same subject code means no conflict (different sections of same course)
  if (subject1.code === subject2.code) return [];
  
  return subject1.studentGroups.filter(g => subject2.studentGroups.includes(g));
}

// Build a conflict map: for each subject, which other subjects conflict with it
export function buildConflictMap(subjects: Subject[]): Map<string, Set<string>> {
  const conflictMap = new Map<string, Set<string>>();
  
  // Create unique key for each subject (code + section)
  const getKey = (s: Subject) => `${s.code}-${s.section}`;
  
  // Initialize map
  for (const subject of subjects) {
    conflictMap.set(getKey(subject), new Set());
  }
  
  // Find conflicts
  for (let i = 0; i < subjects.length; i++) {
    for (let j = i + 1; j < subjects.length; j++) {
      if (hasConflict(subjects[i], subjects[j])) {
        conflictMap.get(getKey(subjects[i]))!.add(getKey(subjects[j]));
        conflictMap.get(getKey(subjects[j]))!.add(getKey(subjects[i]));
      }
    }
  }
  
  return conflictMap;
}

// Check if assigning a subject to a slot would create conflicts with already scheduled exams
export function checkSlotConflicts(
  subject: Subject,
  slot: ExamSlot,
  examType: 'midterm' | 'final',
  scheduled: ScheduledExam[]
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  
  // Find exams in the same slot and exam type
  const sameSlotExams = scheduled.filter(
    exam => exam.slot.date === slot.date && 
            exam.slot.time === slot.time && 
            exam.examType === examType
  );
  
  // Check each for conflicts
  for (const exam of sameSlotExams) {
    const conflictingGroups = getConflictingGroups(subject, exam.subject);
    
    for (const group of conflictingGroups) {
      conflicts.push({
        studentGroup: group,
        subjects: [subject, exam.subject],
        slot,
        examType
      });
    }
  }
  
  return conflicts;
}

// Get all subjects that a student group needs to take
export function getSubjectsForGroup(group: string, subjects: Subject[]): Subject[] {
  return subjects.filter(s => s.studentGroups.includes(group));
}

// Build a map of student group -> subjects they need to take
export function buildGroupSubjectMap(subjects: Subject[]): Map<string, Subject[]> {
  const map = new Map<string, Subject[]>();
  
  for (const subject of subjects) {
    for (const group of subject.studentGroups) {
      const existing = map.get(group) || [];
      existing.push(subject);
      map.set(group, existing);
    }
  }
  
  return map;
}

// Validate a complete schedule for conflicts
// Returns deduplicated conflicts grouped by slot + student group
export function validateSchedule(
  scheduled: ScheduledExam[]
): ScheduleConflict[] {
  // Group by slot and exam type
  const slotMap = new Map<string, ScheduledExam[]>();
  
  for (const exam of scheduled) {
    const key = `${exam.slot.date}-${exam.slot.time}-${exam.examType}`;
    const existing = slotMap.get(key) || [];
    existing.push(exam);
    slotMap.set(key, existing);
  }
  
  // Build conflicts grouped by slot + student group
  // Key: "date-time-examType-studentGroup" -> all subjects involved
  const conflictMap = new Map<string, { slot: ExamSlot; examType: 'midterm' | 'final'; studentGroup: string; subjects: Set<Subject> }>();
  
  // Check each slot for conflicts
  for (const [, exams] of slotMap) {
    for (let i = 0; i < exams.length; i++) {
      for (let j = i + 1; j < exams.length; j++) {
        const conflictingGroups = getConflictingGroups(exams[i].subject, exams[j].subject);
        
        for (const group of conflictingGroups) {
          const key = `${exams[i].slot.date}-${exams[i].slot.time}-${exams[i].examType}-${group}`;
          
          let entry = conflictMap.get(key);
          if (!entry) {
            entry = {
              slot: exams[i].slot,
              examType: exams[i].examType,
              studentGroup: group,
              subjects: new Set()
            };
            conflictMap.set(key, entry);
          }
          
          // Add both subjects to the conflict
          entry.subjects.add(exams[i].subject);
          entry.subjects.add(exams[j].subject);
        }
      }
    }
  }
  
  // Convert to ScheduleConflict array with unique subjects per conflict
  const conflicts: ScheduleConflict[] = [];
  
  for (const entry of conflictMap.values()) {
    // Deduplicate subjects by code (in case same subject appears multiple times via different pairs)
    const uniqueSubjects: Subject[] = [];
    const seenCodes = new Set<string>();
    
    for (const subject of entry.subjects) {
      if (!seenCodes.has(subject.code)) {
        uniqueSubjects.push(subject);
        seenCodes.add(subject.code);
      }
    }
    
    conflicts.push({
      studentGroup: entry.studentGroup,
      subjects: uniqueSubjects,
      slot: entry.slot,
      examType: entry.examType
    });
  }
  
  return conflicts;
}
