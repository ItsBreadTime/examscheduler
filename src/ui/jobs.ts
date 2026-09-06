import type { ExamTiming, Project } from '../lib/types.ts';
import type { ProjectInput } from '../lib/project.ts';
import type { inspectImport } from '../lib/project.ts';
import type { scheduleProject } from '../lib/scheduler.ts';
import type { previewTimingEdit } from '../lib/edit.ts';
import type { assignResources, ResourceSummary } from '../lib/resources.ts';
import type { RepairResult } from '../lib/repair.ts';
import type { AuditBundle } from '../lib/audit.ts';
import type { ValidationReport } from '../lib/types.ts';
import { t } from './i18n.svelte.ts';

export type Inspection = ReturnType<typeof inspectImport>;
export type ScheduleResult = ReturnType<typeof scheduleProject>;
export type EditPreview = ReturnType<typeof previewTimingEdit>;
export type ResourceResult = ReturnType<typeof assignResources>;
export type Job =
  | { type: 'import'; input: ProjectInput }
  | { type: 'schedule'; project: Project }
  | { type: 'edit'; project: Project; eventId: string; timing: ExamTiming }
  | { type: 'resources'; project: Project; computerProctorRule?: boolean }
  | { type: 'repair'; project: Project }
  | { type: 'export'; project: Project; validation: ValidationReport };
export type JobResult =
  | { type: 'import'; project: Project; inspection: Inspection }
  | { type: 'schedule'; result: ScheduleResult }
  | { type: 'edit'; preview: EditPreview }
  | { type: 'resources'; result: ResourceResult; summary: ResourceSummary }
  | { type: 'repair'; result: RepairResult }
  | { type: 'export'; files: { path: string; bytes: number[] }[]; audit: AuditBundle };

/** Rejection used when a job is cancelled, so callers can drop it instead of reporting an error. */
export class CancelledError extends Error {
  constructor() { super('cancelled'); this.name = 'CancelledError'; }
}

export function runJob(job: Job) {
  const worker = new Worker(new URL('./scheduler.worker.ts', import.meta.url), { type: 'module' });
  let rejectJob: (reason: Error) => void;
  const promise = new Promise<JobResult>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = (event: MessageEvent<{ ok: true; value: JobResult } | { ok: false; error: string }>) => {
      worker.terminate();
      if (event.data.ok) resolve(event.data.value); else reject(new Error(event.data.error));
    };
    worker.onerror = () => { worker.terminate(); reject(new Error(t('The background task stopped unexpectedly. Try again.', 'งานเบื้องหลังหยุดทำงาน กรุณาลองอีกครั้ง'))); };
    worker.postMessage(job);
  });
  return { promise, cancel: () => { worker.terminate(); rejectJob(new CancelledError()); } };
}
