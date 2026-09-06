import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { assignResources, importProject, inspectImport, scheduleProject } from './lib/index.ts';
import { buildAuditBundle } from './lib/audit.ts';
import type { ProjectInput, SchedulerSettings, SourceRole } from './lib/index.ts';
interface Manifest {
  courseSources: { path: string; role: SourceRole; expectedPrefix?: string }[];
  rules?: string; references?: { path: string; kind: 'rooms' | 'proctors' }[];
  settings: SchedulerSettings; locks?: ProjectInput['locks'];
}
async function main() {
  const [manifestPath, ...args] = process.argv.slice(2);
  if (!manifestPath || manifestPath === '--help') {
    console.log('Usage: npm run schedule -- manifest.json [--inspect] [--out output/result.json]\nPaths in the manifest are relative to the manifest file. Exit 2 means the generated schedule is invalid or incomplete.'); return;
  }
  const unknown = args.filter((a, i) => a !== '--inspect' && a !== '--out' && args[i - 1] !== '--out');
  if (unknown.length || (args.includes('--out') && !args[args.indexOf('--out') + 1])) throw new Error('Invalid CLI arguments; use --help');
  const manifest: Manifest = JSON.parse(await readFile(resolve(manifestPath), 'utf8'));
  const load = async (path: string) => ({ name: basename(path), bytes: await readFile(resolve(dirname(resolve(manifestPath)), path)) });
  const project = await importProject({
    courseSources: await Promise.all(manifest.courseSources.map(async source => ({ ...await load(source.path), role: source.role, expectedPrefix: source.expectedPrefix }))),
    rules: manifest.rules ? await load(manifest.rules) : undefined,
    references: await Promise.all((manifest.references ?? []).map(async source => ({ ...await load(source.path), kind: source.kind }))),
    settings: manifest.settings, locks: manifest.locks,
  });
  const inspection = inspectImport(project);
  // Calendar and source diagnostics are emitted before the solver starts.
  console.error(JSON.stringify({ stage: 'input', ...inspection }, null, 2));
  if (args.includes('--inspect')) { console.log(JSON.stringify(inspection, null, 2)); process.exitCode = inspection.issues.some(i => i.blocking) ? 2 : 0; return; }
  const result = scheduleProject(project);
  // The CLI runs the same stage sequence as the browser pipeline: schedule, then resources.
  const resources = assignResources(result.project);
  const audit = await buildAuditBundle(resources.project, resources.validation);
  const output = { ...result, project: resources.project, validation: resources.validation, resources: { summary: resources.summary, issues: resources.issues }, inspection, audit };
  const outIndex = args.indexOf('--out');
  if (outIndex >= 0) { const path = resolve(args[outIndex + 1]); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(output, null, 2) + '\n'); console.log(JSON.stringify({ output: path, status: resources.validation.overallStatus, unscheduled: result.unscheduled.length, roomsAssigned: resources.summary.roomsAssigned, roomsUnassigned: resources.summary.roomsUnassigned, scheduleHash: audit.scheduleHash, quality: audit.quality, search: result.search })); }
  else console.log(JSON.stringify(output, null, 2));
  process.exitCode = resources.validation.overallStatus === 'invalid' ? 2 : 0;
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
