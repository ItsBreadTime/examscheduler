import type { ValidationIssue } from './types.ts';
export function issue(type: string, message: string, details: Partial<ValidationIssue> = {}): ValidationIssue {
  const value: ValidationIssue = { id: '', type, message, severity: 'error', blocking: true, origin: 'source', eventIds: [], courseCodes: [], studentGroups: [], sourceRefs: [], ...details };
  value.id = [type, ...value.eventIds, ...value.courseCodes, ...value.sourceRefs.map(r => `${r.artifactId}:${r.sheet ?? ''}:${r.row ?? ''}:${r.column ?? ''}`)].join('|');
  return value;
}
