import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { validateProject } from './lib/index.ts';
import { buildAuditBundle } from './lib/audit.ts';
import type { Project } from './lib/types.ts';
/** Machine-readable validation surface (plan §48): the same validator as the browser, worker and CLI. */
async function main() {
  const [path, ...args] = process.argv.slice(2);
  if (!path || path === '--help' || args.some(a => a !== '--json' && a !== '--out' && args[args.indexOf(a) - 1] !== '--out')) {
    console.log('Usage: npm run validate -- project.json [--json] [--out validation.json]\nExit 2 means the project is invalid.');
    process.exitCode = 1; return;
  }
  const project: Project = JSON.parse(await readFile(resolve(path), 'utf-8'));
  const validation = validateProject(project);
  const audit = await buildAuditBundle(project, validation);
  const report = {
    schemaVersion: audit.schemaVersion, validatorVersion: audit.validatorVersion, scheduleHash: audit.scheduleHash,
    status: validation.overallStatus, summary: audit.summary, coverage: validation.coverage, issues: validation.issues,
  };
  const outIndex = args.indexOf('--out');
  if (outIndex >= 0) { const out = resolve(args[outIndex + 1] ?? 'validation.json'); await mkdir(dirname(out), { recursive: true }); await writeFile(out, JSON.stringify(report, null, 2) + '\n'); }
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`status: ${validation.overallStatus}`);
    console.log(`schedule hash: sha256:${audit.scheduleHash}`);
    for (const [check, status] of Object.entries(validation.coverage)) console.log(`${status === 'passed' ? '✓' : status === 'failed' ? '✕' : '?'} ${check}: ${status}`);
    for (const item of validation.issues) console.log(`${item.severity === 'error' ? '✕' : item.severity === 'warning' ? '⚠' : 'ℹ'} ${item.type} ${item.courseCodes.join(', ')} ${item.message}`);
  }
  process.exitCode = validation.overallStatus === 'invalid' ? 2 : 0;
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
