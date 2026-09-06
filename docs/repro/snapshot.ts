// Application-snapshot tooling for the documentation evidence trail.
//
//   node docs/repro/snapshot.ts app      — capture the repository state outside docs/ plus the
//                                          toolchain environment into docs/reproducibility.json
//   node docs/repro/snapshot.ts post     — recompute the same state and compare it with the saved
//                                          snapshot; exits 1 and prints every difference otherwise
//   node docs/repro/snapshot.ts evidence — hash the report's evidence artifacts (gate step 0.3)
//                                          into the "evidence" section of the same file
//
// The invariant this enforces: every path outside docs/ keeps exactly the same git status and
// content across the whole documentation procedure, modulo the transparently recorded volatile
// paths below. docs/ is the report's own working space (it may change freely); it is excluded
// from every captured set so a report round never dirties the application-state comparison.
// Application state may legitimately advance between rounds through commits; each round
// therefore re-captures the anchor and the report cites the recorded revision.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as os from 'node:os';

const root = resolve(import.meta.dirname, '..', '..');
const run = (cmd: string) => execSync(cmd, { cwd: root, maxBuffer: 1 << 28, encoding: 'utf8' });
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
// macOS Finder litter and iCloud resource forks are excluded from both snapshots; they are not
// application state and appear unpredictably during interactive sessions.
const ignored = (path: string) => /(^|\/)(\.DS_Store|__MACOSX|\._[^/]*)$/.test(path);
// Volatile paths are excluded from the before/after comparison AND recorded in the output with
// a one-line rationale, so the exclusion is transparent rather than silent (report plan 0.2).
const volatilePaths: Record<string, string> = {
  '.zcode/': 'Assistant session state: changes while the documentation is being produced; it is workflow state, not application state.',
  '.openchrome/': 'Browser-automation session logs: these traces change on any browser use, including unrelated sessions; not application state.',
};
const isVolatile = (path: string) => path === '.zcode' || path.startsWith('.zcode/') ||
  path === '.openchrome' || path.startsWith('.openchrome/');

/** TeX Live package revision from the local tlpkg database, so versions come from the installed tree, not the network. */
function tlpdbRevision(packageName: string): string {
  const texmfDist = run('kpsewhich -var-value=TEXMFDIST').trim();
  const tlpdb = resolve(texmfDist, '..', 'tlpkg', 'texlive.tlpdb');
  if (!existsSync(tlpdb)) return 'unavailable';
  const lines = readFileSync(tlpdb, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== `name ${packageName}`) continue;
    const revision = lines.slice(i + 1, i + 10).find(l => l.startsWith('revision '));
    if (revision) return revision.slice('revision '.length);
  }
  return 'missing';
}

// The report embeds exactly these faces, chosen with the user: Sarabun for body text and
// CommitMono for code. They are committed under docs/fonts/ so every machine that can build
// the report has the exact fonts (they are also part of the recorded environment below).
const thaiFontFiles = [
  'Sarabun-Regular.ttf', 'Sarabun-Bold.ttf', 'Sarabun-Italic.ttf', 'Sarabun-BoldItalic.ttf',
  'CommitMono-400-Regular.otf', 'CommitMono-700-Regular.otf', 'CommitMono-400-Italic.otf', 'CommitMono-700-Italic.otf',
];
const thaiFonts = thaiFontFiles.map(file => ({ file, sha256: sha(readFileSync(resolve(root, 'docs', 'fonts', file))) }));

function capture() {
  const outsideDocs = (path: string) => !path.startsWith('docs/') && !ignored(path);
  const tracked = run('git ls-files').split('\n').filter(Boolean).filter(outsideDocs);
  const untracked = run('git ls-files --others --exclude-standard').split('\n').filter(Boolean).filter(outsideDocs);
  const contents = (paths: string[]) => Object.fromEntries(paths.sort()
    .filter(path => !isVolatile(path))
    .map(path => {
      const absolute = resolve(root, path);
      return [path, existsSync(absolute) ? sha(readFileSync(absolute)) : 'missing'];
    }));
  const porcelainLine = (line: string) => {
    const path = line.slice(3).replace(/"$/, '').replace(/^"/, '');
    return !isVolatile(path) && !path.startsWith('docs/');
  };
  return {
    capturedAt: new Date().toISOString(),
    git: {
      head: run('git rev-parse HEAD').trim(),
      branch: run('git branch --show-current').trim(),
      porcelain: run('git status --porcelain').split('\n').filter(Boolean).filter(porcelainLine),
      trackedFileHashes: contents(tracked),
      untrackedOutsideDocs: contents(untracked),
      diffAgainstHeadHash: sha(run(`git diff HEAD -- . ':(exclude).openchrome/**' ':(exclude).zcode/**' ':(exclude)docs/**'`)),
      ignoredPatterns: '.DS_Store, __MACOSX, ._* resource forks, anything under docs/, volatile paths (see top-level volatilePaths)',
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      memoryGB: Math.round(os.totalmem() / 2 ** 30),
      osVersion: run('sw_vers -productVersion').trim(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      lualatex: run('lualatex --version').split('\n')[0],
      latexmk: run('latexmk --version').split('\n')[0],
      // Thai typesetting chain actually used by the report, recorded with the revision
      // numbers of the local TeX Live install (report plan 0.2).
      thaiSupport: {
        'babel': tlpdbRevision('babel'),
        'babel-thai': tlpdbRevision('babel-thai'),
        'hyphen-thai': tlpdbRevision('hyphen-thai'),
        'pgfplots': tlpdbRevision('pgfplots'),
        fonts: thaiFonts,
      },
    },
    volatilePaths,
  };
}

function diff(label: string, saved: unknown, now: unknown, problems: string[]) {
  const a = JSON.stringify(saved), b = JSON.stringify(now);
  if (a !== b) {
    if (typeof saved === 'object' && saved && typeof now === 'object' && now && !Array.isArray(saved)) {
      for (const key of new Set([...Object.keys(saved as object), ...Object.keys(now as object)]))
        diff(`${label}.${key}`, (saved as Record<string, unknown>)[key], (now as Record<string, unknown>)[key], problems);
    } else if (Array.isArray(saved) && Array.isArray(now)) {
      const added = now.filter(x => !saved.includes(x)), removed = saved.filter(x => !now.includes(x));
      problems.push(`${label}: ${added.length} added, ${removed.length} removed`);
    } else problems.push(`${label}: changed (was ${a?.slice(0, 120)}, now ${b?.slice(0, 120)})`);
  }
}

const outPath = resolve(root, 'docs/reproducibility.json');

/** Recursively hash every evidence artifact under docs/data and docs/screenshots (gate step 0.3). */
function hashEvidence() {
  const hashDir = (dir: string): Record<string, string> => {
    if (!existsSync(dir)) return {};
    const walk = (directory: string): Record<string, string> => Object.fromEntries(readdirSync(directory)
      .flatMap(entry => {
        const absolute = join(directory, entry);
        if (statSync(absolute).isDirectory()) return Object.entries(walk(absolute));
        return [[relative(root, absolute), sha(readFileSync(absolute))]];
      }));
    return walk(dir);
  };
  return {
    capturedAt: new Date().toISOString(),
    note: 'Hashes of every file under docs/data and docs/screenshots, written before the final PDF is built (report plan 0.3).',
    files: { ...hashDir(resolve(root, 'docs/data')), ...hashDir(resolve(root, 'docs/screenshots')) },
  };
}

const [mode] = process.argv.slice(2);
if (mode === 'app') {
  const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};
  const captured = capture();
  // capturedAt states when this application state was anchored to its revision; a new
  // state (new HEAD or file contents) always gets a new timestamp, while repeated
  // captures of an identical state merely rewrite the same record.
  writeFileSync(outPath, JSON.stringify({ ...existing, application: captured }, null, 2) + '\n');
  console.log(`application snapshot captured at ${outPath}`);
} else if (mode === 'evidence') {
  const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : {};
  writeFileSync(outPath, JSON.stringify({ ...existing, evidence: hashEvidence() }, null, 2) + '\n');
  console.log(`evidence hashes captured at ${outPath}`);
} else if (mode === 'post') {
  const saved = JSON.parse(readFileSync(outPath, 'utf8')).application;
  const now = capture();
  // capturedAt is recording metadata, not state; every other field must match exactly.
  const { capturedAt: _savedAt, ...savedState } = saved;
  const { capturedAt: _nowAt, ...nowState } = now;
  const problems: string[] = [];
  diff('application', savedState, nowState, problems);
  for (const problem of problems) console.error(`POST-STATE MISMATCH ${problem}`);
  console.log(problems.length ? `post-state comparison FAILED (${problems.length} differences)` :
    'post-state comparison passed: every path outside docs/ is unchanged');
  process.exitCode = problems.length ? 1 : 0;
} else { console.error('usage: node docs/repro/snapshot.ts app|post|evidence'); process.exitCode = 1; }
