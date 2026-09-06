import { importProject, inspectImport } from '../lib/project.ts';
import { scheduleProject } from '../lib/scheduler.ts';
import { previewTimingEdit } from '../lib/edit.ts';
import { assignResources } from '../lib/resources.ts';
import { repairResources } from '../lib/repair.ts';
import { buildArchive } from '../lib/export.ts';
import { createZip } from '../lib/zip.ts';
import type { Job, JobResult } from './jobs.ts';

self.onmessage = async (event: MessageEvent<Job>) => {
  try {
    const job = event.data;
    let value: JobResult;
    if (job.type === 'import') {
      const project = await importProject(job.input);
      value = { type: 'import', project, inspection: inspectImport(project) };
    } else if (job.type === 'schedule') value = { type: 'schedule', result: scheduleProject(job.project) };
    else if (job.type === 'edit') value = { type: 'edit', preview: previewTimingEdit(job.project, job.eventId, job.timing) };
    else if (job.type === 'resources') {
      const project = structuredClone(job.project);
      if (job.computerProctorRule !== undefined) project.settings.computerProctorRule = job.computerProctorRule;
      const result = assignResources(project);
      value = { type: 'resources', result, summary: result.summary };
    } else if (job.type === 'repair') value = { type: 'repair', result: repairResources(job.project) };
    else {
      const files = await buildArchive(job.project, job.validation);
      value = {
        type: 'export',
        files: files.map(f => ({ path: f.path, bytes: [...f.bytes] })),
        audit: JSON.parse(new TextDecoder().decode(files.find(f => f.path === 'audit.json')!.bytes)),
      };
      // Prove the zip path in the same job so the download button cannot ship a broken archive.
      createZip(files.map(f => ({ path: f.path, bytes: f.bytes })));
    }
    self.postMessage({ ok: true, value });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
