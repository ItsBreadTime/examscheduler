import type { CourseExamRule, Project, Section } from '../src/lib/types.ts';
import { buildEvents, defaultSettings } from '../src/lib/model.ts';
export function section(code: string, groups = ['G1'], role: 'managed' | 'context' = 'managed'): Section {
  return { id: code, courseCode: code, courseName: code, sectionNumber: 1, studentGroups: groups, rawStudentGroups: groups.join('\n'), sourceRole: role, sourceRef: { artifactId: 'test', sheet: 'Sheet1', row: Number(code.slice(-2)) + 1 }, instructors: [], exams: {}, invalidExams: [] };
}
export function project(sections: Section[], rules: CourseExamRule[] = []): Project {
  const p: Project = { schemaVersion: 1, artifacts: [], sections, rules, importIssues: [], events: [], locks: {}, rooms: [], proctors: [], settings: defaultSettings({ start: '2026-08-17', end: '2026-08-21' }, { start: '2026-10-19', end: '2026-10-23' }) };
  p.events = buildEvents(p); return p;
}
export function room(name: string, options: Partial<Project['rooms'][number]> = {}): Project['rooms'][number] {
  return { id: `room:${name}`, name, zones: [], tags: [], unavailableDates: [], sourceRef: { artifactId: 'test', row: 1 }, ...options };
}
export function proctor(displayName: string, options: Partial<Project['proctors'][number]> = {}): Project['proctors'][number] {
  return { id: `proctor:${displayName}`, displayName, tags: [], notes: [], availability: [], sourceRef: { artifactId: 'test', row: 1 }, ...options };
}
export function rule(action: CourseExamRule['action'], courseCodes: string[], examType?: CourseExamRule['examType']): CourseExamRule {
  return { action, courseCodes, examType, sourceRef: { artifactId: 'rules', row: 1 } };
}
