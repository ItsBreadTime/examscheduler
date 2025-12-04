import Papa from 'papaparse';
import type { Subject, Rules } from './types';

// Parse the university CSV format and extract subjects
export function parseSubjectCSV(csvContent: string, source: 'fixed' | 'schedulable'): Subject[] {
  const subjects: Subject[] = [];
  
  const result = Papa.parse(csvContent, {
    header: false,
    skipEmptyLines: false
  });
  
  const rows = result.data as string[][];
  
  let currentSubjectCode = '';
  let currentSubjectName = '';
  
  for (const row of rows) {
    // Skip empty rows and header rows
    if (!row || row.length < 16) continue;
    
    // Check if this is a subject row (has subject code in column 0)
    const subjectCode = cleanValue(row[0]);
    const subjectName = cleanValue(row[3]);
    const sectionStr = cleanValue(row[8]);
    const studentGroupsStr = cleanValue(row[15]);
    
    // Update current subject if we have a new code
    if (subjectCode && /^\d{9}$/.test(subjectCode)) {
      currentSubjectCode = subjectCode;
      currentSubjectName = subjectName || currentSubjectName;
    }
    
    // Skip if no student groups or no section
    if (!studentGroupsStr || !sectionStr) continue;
    
    // Parse section number
    const section = parseInt(sectionStr, 10);
    if (isNaN(section)) continue;
    
    // Parse student groups (can be multiline with newlines)
    const studentGroups = parseStudentGroups(studentGroupsStr);
    if (studentGroups.length === 0) continue;
    
    // Parse exam dates/times
    const midtermDate = cleanValue(row[16]);
    const midtermTime = cleanValue(row[17]);
    const finalDate = cleanValue(row[18]);
    const finalTime = cleanValue(row[19]);
    
    // Use current subject code if row doesn't have one
    const effectiveCode = subjectCode || currentSubjectCode;
    if (!effectiveCode || !/^\d{9}$/.test(effectiveCode)) continue;
    
    subjects.push({
      code: effectiveCode,
      name: currentSubjectName,
      section,
      studentGroups,
      midtermDate: midtermDate || undefined,
      midtermTime: midtermTime || undefined,
      finalDate: finalDate || undefined,
      finalTime: finalTime || undefined,
      source
    });
  }
  
  return subjects;
}

// Parse student groups from potentially multiline string
function parseStudentGroups(str: string): string[] {
  if (!str) return [];
  
  // Split by newlines and filter empty entries
  const groups = str
    .split(/[\n\r]+/)
    .map(g => g.trim())
    .filter(g => g.length > 0 && g !== ' ');
  
  // Remove duplicates
  return [...new Set(groups)];
}

// Clean cell value
function cleanValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

// Parse rules CSV
export function parseRulesCSV(csvContent: string): Rules {
  const rules: Rules = {
    noMidterm: [],
    noFinal: [],
    noExam: [],
    fullDayExam: [],
    sameTimeGroups: []
  };
  
  const result = Papa.parse(csvContent, {
    header: false,
    skipEmptyLines: true
  });
  
  const rows = result.data as string[][];
  
  if (rows.length === 0) return rules;
  
  // First row is header
  // Column 0: ไม่มีสอบกลางภาค (no midterm)
  // Column 1: ไม่มีสอบปลายภาค (no final)
  // Column 2: ไม่มีสอบ (no exam at all)
  // Column 3: วิชาเดียวแต่สอบสองช่วง (full day exam)
  // Columns 4+: ให้มีวัน เวลา สอบ ตรงกัน (same time groups) - EACH ROW is a group
  
  // Process data rows (skip header)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    
    // Column 0: No midterm
    if (row[0] && /^\d{9}$/.test(row[0].trim())) {
      rules.noMidterm.push(row[0].trim());
    }
    
    // Column 1: No final
    if (row[1] && /^\d{9}$/.test(row[1].trim())) {
      rules.noFinal.push(row[1].trim());
    }
    
    // Column 2: No exam
    if (row[2] && /^\d{9}$/.test(row[2].trim())) {
      rules.noExam.push(row[2].trim());
    }
    
    // Column 3: Full day exam
    if (row[3] && /^\d{9}$/.test(row[3].trim())) {
      rules.fullDayExam.push(row[3].trim());
    }
    
    // Columns 4+: Same time groups - EACH ROW is a group of subjects that must be at same time
    // Collect all valid subject codes from columns 4+ in this row
    const sameTimeGroup: string[] = [];
    for (let col = 4; col < row.length; col++) {
      const code = row[col]?.trim();
      if (code && /^\d{9}$/.test(code)) {
        sameTimeGroup.push(code);
      }
    }
    
    // Only add if there are 2+ subjects in the group
    if (sameTimeGroup.length >= 2) {
      rules.sameTimeGroups.push(sameTimeGroup);
    }
  }
  
  return rules;
}

// Merge subjects from multiple files
export function mergeSubjects(fixed040: Subject[], fixed080: Subject[], schedulable060: Subject[]): Subject[] {
  return [...fixed040, ...fixed080, ...schedulable060];
}

// Group subjects by code (all sections of same subject)
export function groupSubjectsByCode(subjects: Subject[]): Map<string, Subject[]> {
  const grouped = new Map<string, Subject[]>();
  
  for (const subject of subjects) {
    const existing = grouped.get(subject.code) || [];
    existing.push(subject);
    grouped.set(subject.code, existing);
  }
  
  return grouped;
}

// Get all unique student groups from subjects
export function getAllStudentGroups(subjects: Subject[]): Set<string> {
  const groups = new Set<string>();
  
  for (const subject of subjects) {
    for (const group of subject.studentGroups) {
      groups.add(group);
    }
  }
  
  return groups;
}
