import type { Project, ValidationIssue, ValidationReport } from './types.ts';
import { compare } from './time.ts';
import { scheduleQuality, type ScheduleQuality } from './quality.ts';
import { validateProject } from './validator.ts';
import { summarizeAssignedResources, type ResourceSummary } from './resources.ts';
// One set of version constants for the CLI, the browser, the worker and the audit API (plan §43/§88).
export const parserVersion = '0.3.0';
export const schedulerVersion = '0.5.0';
export const validatorVersion = '0.4.0';
export const projectSchemaVersion = 1;
export const auditSchemaVersion = 4;
export const sha256Hex = async (value: string | Uint8Array) => {
  const data = new Uint8Array(typeof value === 'string' ? new TextEncoder().encode(value) : value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join('');
};
/** Deterministic overlap between two runs: identical inputs, settings and solver version produce identical hashes (plan §81). */
export async function projectHashes(project: Project) {
  return {
    sourceHash: await sha256Hex(JSON.stringify(project.artifacts.map(a => JSON.stringify([a.id, a.originalName, a.byteLength])).sort(compare))),
    rulesHash: await sha256Hex(JSON.stringify(project.rules.map(r => [r.action, r.examType ?? '', ...r.courseCodes].join('|')).sort(compare))),
    scheduleHash: await sha256Hex(JSON.stringify(project.events.map(e => [e.id, e.timing?.date ?? '', e.timing?.startMinutes ?? '', e.timing?.endMinutes ?? '', e.timingOrigin, ...e.roomAssignments, ...e.proctorAssignments].join('|')).sort(compare))),
  };
}
export interface AuditBundle {
  schemaVersion: number; parserVersion: string; schedulerVersion: string; validatorVersion: string;
  scheduleHash: string; sourceHash: string; rulesHash: string; generatedAt: string;
  quality: ScheduleQuality;
  summary: { errors: number; warnings: number; unscheduledEvents: number } & ResourceSummary;
  coverage: ValidationReport['coverage']; issues: ValidationIssue[];
}
export async function buildAuditBundle(project: Project, validation: ValidationReport = validateProject(project)): Promise<AuditBundle> {
  const hashes = await projectHashes(project);
  const events = project.events;
  const resources = summarizeAssignedResources(project);
  return {
    schemaVersion: auditSchemaVersion, parserVersion, schedulerVersion, validatorVersion,
    ...hashes, generatedAt: new Date().toISOString(),
    quality: scheduleQuality(project),
    summary: {
      errors: validation.issues.filter(i => i.severity === 'error').length,
      warnings: validation.issues.filter(i => i.severity === 'warning').length,
      unscheduledEvents: events.filter(e => e.required && !e.timing).length,
      ...resources,
    },
    coverage: validation.coverage, issues: validation.issues,
  };
}
