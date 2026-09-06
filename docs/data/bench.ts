// Run only after other intentional workloads have stopped: node docs/data/bench.ts --measure
// Rebuild chart tables without rerunning measurements: node docs/data/bench.ts --charts-only
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { cpus, totalmem, arch, release, loadavg as osLoadavg } from 'node:os';
import { spawnSync } from 'node:child_process';
import { importProject, scheduleProject } from '../../src/lib/index.ts';
import type { Project, ProjectInput, SchedulerSettings } from '../../src/lib/index.ts';
import { root, saveRecord, countCodes } from './records.ts';

type Scale = 'small' | 'medium' | 'large';
type Family = 'cli' | 'scheduleProject';
type Search = ReturnType<typeof scheduleProject>['search'];
type Stats = { min: number; q1: number; median: number; q3: number; max: number };
interface Sample { scale: Scale; family: Family; run: number; milliseconds: number; search: Search; recordedAt: string }
interface Size { scale: Scale; managedCourses: number; managedSections: number; contextCourses: number; contextSections: number; searchBudget: number }
interface Manifest { courseSources: { path: string; role: 'managed' | 'context'; expectedPrefix?: string }[]; rules?: string; references?: { path: string; kind: 'rooms' }[]; settings: SchedulerSettings; locks?: ProjectInput['locks'] }
const data = import.meta.dirname;
const runs = 20; // 20 CLI + 20 in-process samples per scale: medians carry a quartile spread.
const scales: [Scale, string][] = [['small', 'clean/manifest.json'], ['medium', 'benchmark/medium/manifest.json'], ['large', 'benchmark/large/manifest.json']];
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const round = (n: number) => Math.round(n * 100) / 100;
/** Linear-interpolation quantile (numpy default): q(0.25)/q(0.5)/q(0.75) plus both extremes. */
const stats = (values: number[]): Stats => {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p: number) => {
    const at = (sorted.length - 1) * p, low = Math.floor(at), high = Math.ceil(at);
    return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
  };
  return { min: sorted[0], q1: quantile(0.25), median: quantile(0.5), q3: quantile(0.75), max: sorted[sorted.length - 1] };
};
const probe = (command: string, args: string[]) => { const r = spawnSync(command, args, { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : 'unavailable'; };
async function loadProject(path: string): Promise<Project> {
  const manifest = read(path) as Manifest;
  assert.equal(manifest.settings.searchBudget, 20000);
  const load = (name: string) => ({ name: basename(name), bytes: readFileSync(resolve(dirname(path), name)) });
  return importProject({ courseSources: manifest.courseSources.map(s => ({ ...load(s.path), role: s.role, expectedPrefix: s.expectedPrefix })), rules: manifest.rules ? load(manifest.rules) : undefined,
    references: (manifest.references ?? []).map(s => ({ ...load(s.path), kind: s.kind })), settings: manifest.settings, locks: manifest.locks });
}
const thaiNumber = { small: 'เล็ก', medium: 'กลาง', large: 'ใหญ่' } as const;
type SummaryRow = { scale: Scale; family: Family } & Stats;
function charts(evidence: { samples: Sample[]; sizes: Size[]; environment: { capturedAt: string; loadAverageAtStart: number[] } }): SummaryRow[] {
  const out = resolve(data, 'charts'); mkdirSync(out, { recursive: true });
  // One raw sample per row, one column per scale; each box plot reads a whole column.
  for (const family of ['cli', 'scheduleProject'] as const) {
    const rows = ['small medium large'];
    for (let i = 0; i < runs; i++) rows.push(scales.map(([scale]) => round(evidence.samples
      .filter(s => s.scale === scale && s.family === family && s.run === i + 1)[0].milliseconds)).join(' '));
    writeFileSync(resolve(out, `runtime-box-${family}.dat`), rows.join('\n') + '\n');
  }
  const effortRows: string[] = [];
  for (const size of evidence.sizes) {
    const samples = evidence.samples.filter(s => s.scale === size.scale);
    for (const sample of samples) assert.deepEqual(sample.search, samples[0].search, `${size.scale}: search statistics differ`);
    const s = samples[0].search;
    effortRows.push([size.scale, size.managedCourses, s.visitedNodes, s.improvementEvaluations, s.budget,
      s.visitedNodes + s.improvementEvaluations, (s.visitedNodes + s.improvementEvaluations) / s.budget].join(' '));
  }
  writeFileSync(resolve(out, 'search-effort.dat'), ['scale courses visitedNodes improvementEvaluations budget used utilization', ...effortRows].join('\n') + '\n');
  const clean = read(resolve(data, 'results-clean.json')) as { project: Project };
  const p = clean.project;
  // Heatmap matrix: x = chronological day index over both exam periods, y = session, cells = demand.
  // Row-major (constant y per scanline): pgfplots matrix plots derive the grid from this order.
  const matrix = ['x y ordinary computer total'], labels = ['label'];
  const dates = [...new Set(p.events.filter(e => e.ownership === 'managed' && e.timing).map(e => e.timing!.date))].sort();
  const cells: string[] = [];
  for (const [i, session] of p.settings.sessions.entries()) {
    for (const [day, date] of dates.entries()) {
      let ordinary = 0, computer = 0;
      for (const e of p.events.filter(e => e.ownership === 'managed' && e.timing?.date === date && e.timing.startMinutes < session.endMinutes && session.startMinutes < e.timing.endMinutes)) {
        const sections = p.sections.filter(s => e.sectionIds.includes(s.id));
        if (sections.some(s => /^C1-/.test(s.teachingRoom ?? ''))) computer++; else ordinary++;
      }
      cells.push([day, i, ordinary, computer, ordinary + computer].join(' '));
    }
  }
  for (const [day, date] of dates.entries()) labels.push(date.slice(5)); // MM-DD; period context is in the report.
  matrix.push(...cells);
  writeFileSync(resolve(out, 'room-demand-matrix.dat'), matrix.join('\n') + '\n');
  writeFileSync(resolve(out, 'room-demand-labels.dat'), labels.join('\n') + '\n');
  const summary: SummaryRow[] = evidence.sizes.flatMap(size => (['cli', 'scheduleProject'] as const)
    .map(family => ({ scale: size.scale, family, ...stats(evidence.samples.filter(s => s.scale === size.scale && s.family === family).map(s => s.milliseconds)) })));
  writeSummary(evidence.environment, evidence.sizes, summary, effortRows);
  return summary;
}
function writeSummary(environment: { capturedAt: string; loadAverageAtStart: number[] }, sizes: Size[], summary: SummaryRow[], effortRows: string[]) {
  const line = (scale: Scale, family: Family) => summary.find(s => s.scale === scale && s.family === family)!;
  const flag = (v: boolean) => v ? 'จริง' : 'เท็จ';
  // Two decimals everywhere so the right-aligned columns line up on the decimal point.
  const fmt = (n: number) => n.toFixed(2);
  const load = (environment.loadAverageAtStart ?? []).join(', ');
  const L = (w: string) => `>{\\raggedright\\arraybackslash}p{${w}}`;
  const tex = ['% Generated by docs/data/bench.ts from benchmarks.json; edit bench.ts, not this file.',
    '\\begin{center}\\begin{minipage}{\\textwidth}\\centering\\captionof{table}{สภาพแวดล้อมการวัด}\\label{tab:env}{\\small\\begin{tabular}{' + L('3cm') + L('9cm') + '}\\toprule Environment B1 & ค่าที่บันทึก \\\\\\midrule',
    'Apple M4 & RAM 16 GB, macOS 26.5.2, arm64 \\\\',
    'Node & v26.0.0, TZ Asia/Bangkok \\\\',
    'พลังงาน & AC Power, แบตเตอรี่ 100\\%, low power mode ปิด \\\\',
    `บันทึกเมื่อ & ${environment.capturedAt} (UTC) \\\\`,
    `โหลดเฉลี่ยของระบบขณะเริ่มวัด & ${load} (1, 5, 15 นาที; เครื่อง 10 logical core) \\\\`,
    'งานร่วม & ไม่มีงานอื่นที่ผู้ทดลองตั้งใจให้แข่งขันทรัพยากรระหว่างวัด แต่มีแอปพลิเคชันเดสก์ท็อปทำงานอยู่ จึงบันทึกโหลดระบบประกอบ \\\\\\bottomrule\\end{tabular}}\\end{minipage}\\end{center}',
    '\\needspace{12\\baselineskip}\\begin{center}\\begin{minipage}{\\textwidth}\\centering\\captionof{table}{เวลาที่วัดได้แยกตามวิธีวัด (หน่วย ms)}\\label{tab:runtime}{\\small\\tabcolsep=2pt\\begin{tabular}{' + L('2.2cm') + L('2.9cm') + 'rrrrr}\\toprule ชุด & วิธี & มัธยฐาน & ควอร์ไทล์ 1 & ควอร์ไทล์ 3 & ต่ำสุด & สูงสุด \\\\\\midrule'];
  for (const scale of ['small', 'medium', 'large'] as const) for (const family of ['cli', 'scheduleProject'] as const) {
    const s = line(scale, family);
    tex.push(`${thaiNumber[scale]} (${sizes.find(x => x.scale === scale)!.managedCourses} วิชา) & ${family === 'cli' ? 'CLI' : '{\\small scheduleProject}'} & ${fmt(s.median)} & ${fmt(s.q1)} & ${fmt(s.q3)} & ${fmt(s.min)} & ${fmt(s.max)} \\\\`);
  }
  tex.push('\\bottomrule\\end{tabular}}\\end{minipage}\\end{center}');
  // Search statistics transposed: one row per indicator, one column per scale, so long
  // field names never fight for horizontal space.
  const byScale = (scale: string) => evidenceSearch(scale as Scale);
  const row = (label: string, pick: (s: Search) => string) =>
    `${label} & ${['small', 'medium', 'large'].map(sc => pick(byScale(sc))).join(' & ')} \\\\`;
  tex.push('\\needspace{15\\baselineskip}\\begin{center}\\begin{minipage}{\\textwidth}\\centering\\captionof{table}{สถิติการค้นหาและสถานะการพิสูจน์ของแต่ละขนาดชุดข้อมูล}\\label{tab:search}{\\small\\tabcolsep=3pt\\begin{tabular}{' + L('6cm') + 'ccc}\\toprule ตัวชี้วัดของการค้นหา & เล็ก (41 วิชา) & กลาง (100 วิชา) & ใหญ่ (189 วิชา) \\\\\\midrule');
  tex.push(row('visitedNodes', s => String(s.visitedNodes)));
  tex.push(row('improvementEvaluations', s => String(s.improvementEvaluations)));
  tex.push(row('feasibilityBudget', s => String(s.feasibilityBudget)));
  tex.push(row('งบรวมที่ใช้ (เปอร์เซ็นต์ของ 20000)', s => String(round((s.visitedNodes + s.improvementEvaluations) / s.budget * 100))));
  tex.push(row('coverageOptimal', s => flag(s.coverageOptimal)));
  tex.push(row('avoidedDaysOptimal', s => flag(s.avoidedDaysOptimal)));
  tex.push(row('budgetExhausted', s => flag(s.budgetExhausted)));
  tex.push(row('improvementBudgetExhausted', s => flag(s.improvementBudgetExhausted)));
  tex.push(`\\bottomrule\\end{tabular}}\\end{minipage}\\end{center}`);
  void effortRows;
  writeFileSync(resolve(data, '..', 'benchmark-summary.tex'), tex.join('\n') + '\n');
}
function evidenceSearch(scale: Scale): Search {
  return read(resolve(data, `results-bench-${scale}.json`)).search as Search;
}
if (process.argv.includes('--charts-only')) {
  const evidence = read(resolve(data, 'benchmarks.json')) as { samples: Sample[]; sizes: Size[]; environment: { capturedAt: string; loadAverageAtStart: number[] } };
  charts(evidence);
} else {
  assert.ok(process.argv.includes('--measure'), 'Pass --measure only after stopping intentional competing workloads.');
  process.env.TZ = 'Asia/Bangkok';
  const environment = { id: 'B1', capturedAt: new Date().toISOString(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, ramBytes: totalmem(), macOS: probe('sw_vers', ['-productVersion']), kernel: release(), architecture: arch(), node: process.version, timezone: process.env.TZ,
    loadAverageAtStart: osLoadavg().map(v => Math.round(v * 100) / 100), ambientLoadNote: `1/5/15-minute load averages immediately before measurement; the experimenter runs nothing intentionally, but interactive desktop applications may add ambient CPU load. Recorded so every timing table can be read against the load under which it was measured.`,
    powerState: probe('pmset', ['-g', 'batt']), powerSettings: probe('pmset', ['-g', 'custom']), competingWorkload: 'no intentional competing workload during measurement' };
  const samples: Sample[] = [], sizes: Size[] = [];
  for (const [scale, relative] of scales) {
    const manifestPath = resolve(data, relative), project = await loadProject(manifestPath);
    sizes.push({ scale, managedCourses: new Set(project.sections.filter(s => s.sourceRole === 'managed').map(s => s.courseCode)).size, managedSections: project.sections.filter(s => s.sourceRole === 'managed').length,
      contextCourses: new Set(project.sections.filter(s => s.sourceRole === 'context').map(s => s.courseCode)).size, contextSections: project.sections.filter(s => s.sourceRole === 'context').length, searchBudget: project.settings.searchBudget });
    for (let run = 1; run <= runs; run++) {
      const output = `docs/data/results-bench-${scale}.json`, args = ['src/cli.ts', `docs/data/${relative}`, '--out', output];
      const start = performance.now();
      const execution = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, TZ: 'Asia/Bangkok' }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      const milliseconds = performance.now() - start, recordedAt = new Date().toISOString();
      assert.ifError(execution.error); assert.equal(execution.status, 0, `${scale} CLI run ${run}: ${execution.stderr}`);
      const result = read(resolve(root, output));
      samples.push({ scale, family: 'cli', run, milliseconds, search: result.search, recordedAt });
      saveRecord({ id: `benchmark-cli-${scale}-${run}`, scenario: scale, kind: 'benchmark', command: `${process.execPath} ${args.join(' ')}`, cwd: root, stdout: execution.stdout, stderr: execution.stderr, exitCode: execution.status!, phase: 'audit', issueCodes: countCodes(result.validation.issues.map((i: { type: string }) => i.type)), resultPath: output, inspect: result.inspection, recordedAt, notes: `CLI wall clock ${milliseconds} ms; no warm-up; output overwritten by later iterations of this scale.` });
      console.log(`${scale} cli ${run}/${runs}: ${milliseconds.toFixed(3)} ms`);
    }
    scheduleProject(project); // Exactly one unmeasured warm-up per scale.
    for (let run = 1; run <= runs; run++) {
      const start = performance.now(); const result = scheduleProject(project); const milliseconds = performance.now() - start;
      const recordedAt = new Date().toISOString();
      samples.push({ scale, family: 'scheduleProject', run, milliseconds, search: result.search, recordedAt });
      saveRecord({ id: `benchmark-scheduleProject-${scale}-${run}`, scenario: scale, kind: 'benchmark', command: 'node docs/data/bench.ts --measure [in-process scheduleProject(project)]', cwd: root, stdout: JSON.stringify({ quality: result.quality, search: result.search }), stderr: '', exitCode: 0, phase: 'schedule', issueCodes: countCodes([...result.validation.issues.map(i => i.type), ...result.unscheduled.map(u => u.reason)]), resultPath: null, inspect: null, recordedAt, notes: `scheduleProject call ${milliseconds} ms; excludes import and resource allocation; one unmeasured warm-up per scale.` });
      console.log(`${scale} scheduleProject ${run}/${runs}: ${milliseconds.toFixed(3)} ms`);
    }
  }
  const summary = sizes.flatMap(size => (['cli', 'scheduleProject'] as const).map(family => ({ scale: size.scale, family, ...stats(samples.filter(s => s.scale === size.scale && s.family === family).map(s => s.milliseconds)) })));
  const evidence = { environment, protocol: { sequential: true, runsPerScaleAndFamily: runs, cliWarmups: 0, inProcessWarmupsPerScale: 1, timingUnit: 'milliseconds',
    summaryStatistics: 'min, lower quartile, median, upper quartile, max; quantiles use linear interpolation over 20 samples',
    roomDemand: 'Managed timed events overlapping each configured session; full-day events count in both sessions. Computer-demand proxy: any constituent section teachingRoom starts with C1-. Demand is not assignment or utilization.' }, sizes, samples, summary };
  json(resolve(data, 'benchmarks.json'), evidence); charts(evidence);
}
