# Exam Scheduler

Thai version: [README.th.md](README.th.md)

Deterministic, auditable midterm and final examination scheduling from Thai university registrar spreadsheets, built around the FITM @ KMUTNB export format. A TypeScript core library handles the spreadsheet import, reconciliation, exact-time scheduling and independent validation; a Svelte browser application wraps the whole workflow; a Cloudflare Worker adds optional cloud persistence and sharing. The core library has no DOM, storage or network dependencies; only the CLI reads and writes local files, and the browser app parses, schedules and validates every file locally in a Web Worker.

The current release runs in production at <https://schedule.breadtm.xyz>, and the repository ships full Thai-language documentation under `docs/`: a [technical report](docs/report.pdf) and a [usage manual](docs/usage-report.pdf).

## Run

Requires Node.js 22.18 or newer.

```sh
npm ci
npm run check
npm test
npm run build

# Inspect source problems and calendar dates before generating anything.
npm run schedule -- tests/fixtures/manifest.json --inspect

# Generate the sample result, including issues and unresolved examinations.
npm run schedule -- tests/fixtures/manifest.json --out output/sample-result.json

# The compiled CLI works as well.
node dist/cli.js tests/fixtures/manifest.json --out output/sample-result.json

# Run the browser application (defaults to Thai, with an English switcher).
npm run dev
```

Exit codes: `0` means valid (possibly with warnings); `2` means source errors or an invalid/incomplete schedule; `1` means a configuration, file or execution failure. A result is still saved when validation fails. The supplied university fixture intentionally returns `2`.

The example manifest's August/October 2026 ranges are **demonstration settings**, not an approved examination calendar. Copy the manifest and set the actual periods and holidays. Paths are relative to the manifest, so it can live outside this repository.

## Configuration

`courseSources` accepts any number of sources with an explicit `managed` or `context` role. Prefix checks are optional. `rules` is optional. All managed courses require both exam types unless a rule excludes one. Context sources contribute only actual imported timings; blank context dates never become scheduling tasks.

`settings` contains:

- `periods.midterm` and `periods.final`: inclusive ISO date ranges (`YYYY-MM-DD`).
- `sessions`: generated exam intervals, expressed as integer minutes after midnight.
- `fullDay`: the full-day interval. The default is 09:00–16:00.
- `weekendPolicy` and `holidayPolicy`: `never`, `only_if_necessary`, or `normal`.
- `holidays`: explicit ISO dates, including institutional closures. No country calendar is inferred or fetched.
- `searchBudget`: a deterministic effort limit, shared by feasibility nodes and repair/improvement candidate evaluations. Feasibility receives at most 60% (at least one node); unused feasibility effort also goes to improvement. Independent conflict components share feasibility effort by size.

Both avoidance policies default to `only_if_necessary`. The solver first tries dates without avoided weekends/holidays, then extends that arrangement with fallback dates if coverage can increase. Search maximizes the number of required events placed, then minimizes events on avoided dates. Bounded search cannot always prove that every fallback date is necessary; `search.avoidedDaysOptimal` reports whether the minimum avoided-event count was proved at optimal coverage. Use `never` for a hard prohibition. Imported and manually locked exams remain fixed even on forbidden dates, with visible warnings; invalid managed locks are also reported.

The scheduler uses incremental candidate blockers and student-day counts, with cached ordering priorities. Independent conflict components are searched separately. Optimistic interval-capacity bounds stop provably futile branches without preselecting exams to discard; they account for overlapping sessions, full-day exams, and the event count of same-time bundles. Relocations and two-exam exchanges then minimize `10 × same-day student-group pairs + 3 × consecutive-day pairs`, including all fixed exams. Simultaneous managed-event pairs break quality ties. Resource assignment still follows time scheduling; this tie-break is not a room-availability guarantee.

`search.coverageUpperBound` counts potentially generated required events in viable units (excluding already fixed exams and source-invalid units). `coverageOptimal` means the returned coverage reaches a valid bound or was proved by exhaustive search. `budgetExhausted` indicates a feasibility cutoff without a coverage proof; `improvementBudgetExhausted` separately reports consumption of improvement effort. `visitedNodes + improvementEvaluations` never exceeds `budget`. `STUDENT_CONFLICTS` means every candidate is blocked in the returned timetable; it is not, by itself, proof that rearrangement could never help. Soft quality remains a bounded heuristic, even when coverage is proved optimal.

Run `node scripts/benchmark-scheduler.ts` for the demo and seeded 100–840-event scale cases, including independent clash/quality recounts, determinism and room checks. `--sizes 50,100` selects course counts; `--baseline /absolute/path/to/scheduler.ts` compares an importable saved scheduler on the same inputs. Large runs of the old scheduler can take minutes.

During input, `inspectImport` lists weekend and holiday dates in each period and flags imported exams that fall on them. It warns if holidays have not been configured. These diagnostics are printed to stderr before the CLI starts solving.

Manual locks use event IDs and exact timing objects:

```json
{
  "locks": {
    "managed:060000001:midterm": {
      "date": "2026-08-18",
      "startMinutes": 540,
      "endMinutes": 720
    }
  }
}
```

Locks cannot override imported examinations. Inconsistent locks are reported. Previous generated timings are rebuilt from the original sections, rules, settings and locks on each run.

## Spreadsheet support

The common reader supports **XLSX, XLS, XLSM, XLSB, CSV, TSV, ODS and FODS**. Each format is covered by an import regression test; the original XLSX course files and legacy XLS proctor workbook are also tested. CSV/TSV input uses UTF-8, with optional BOM. Export other text encodings to UTF-8 before import. Macros and formulas are not executed.

File-format support does not imply arbitrary table layouts. Course parsing accepts:

1. The supplied Thai university export, with repeated headers, department blocks, inherited codes/names and section rows.
2. A flat table with these exact column names:

```text
courseCode,courseName,sectionNumber,studentGroups,midtermDate,midtermTime,finalDate,finalTime,plannedEnrollment,registeredEnrollment,instructors
```

The first four columns are required. Optional teaching columns are `teachingDay`, `teachingTime`, and `teachingRoom`. Student groups can be separated by line breaks, commas or semicolons. Keep course codes as nine-digit text identifiers or use an Excel number format that displays all nine digits. Missing leading zeroes are reported, never guessed.

Dates accept ISO dates, Thai `DD/MM/YY` Buddhist years (e.g. `17/08/69`), full Buddhist or Gregorian years, and actual Excel date cells. Times accept `HH:MM-HH:MM` or `H.MM-H.MM`. Endpoints that merely touch do not overlap. Group identifiers preserve case, normalize Unicode/spacing and remove duplicates.

Rules accept the supplied university column layout in any supported spreadsheet container. The combined “ไม่มีสอบกลางภาค/สอบนอกตาราง” category means exclusion from central generation; it does not forbid imported exams. The explicit “ไม่มีสอบ” category forbids both exam types. Same-time rules form transitive graph components; stale and malformed references remain visible.

Every source retains its SHA-256, original name, import time and detected term. Sections retain sheet/row provenance, course and teaching metadata, instructors, and separate planned/registered enrollment. Optional room/proctor reference files are recorded with term diagnostics. Positive room proctor demand is enforced when it is present; missing, invalid or ambiguous demand remains unknown. A proctor roster from a different academic term stays visible for review but is quarantined from new assignments, and its dated duty matrix is ignored until a current-term roster is imported. Matching current-term duty cells become structured, source-linked availability constraints; free-text notes remain visible and require manual structuring.

## Scheduling and validation

Each course/exam type remains an individual event. Same-time components become temporary scheduling units. The solver uses exact intervals, a conflict graph, minimum-remaining-values ordering, stable tie breaks, bounded backtracking and a bounded one-blocker repair pass. Date/session balancing and spacing are soft preferences. Student collisions, fixed exams, date ranges, exclusions and full-day requirements reject candidates.

No legal candidate means an unscheduled exam with a structured reason. Same-time courses sharing student groups are contradictory and remain unresolved. Missing managed student groups also block generation for that course. The implementation does not assume that a shared cohort can safely sit two separate exams at once.

`validateProject` independently reconstructs expected event identities and group membership from the normalized input. It detects removed/duplicated/fabricated events, altered groups, changed imported timings or locks, student overlaps, missing requirements, same-time violations, exclusions, invalid intervals, full-day violations, date range violations and prohibited generated calendar dates. Imported issues keep source origin. When room or proctor sources are supplied, resource identity, assignment cardinality, room conflicts, availability, eligibility and known staffing demand are checked independently of student scheduling. A resource coverage row is `not_checked` when its required source is absent; that state is never counted as a pass.

```ts
import { importProject, inspectImport, scheduleProject, validateProject } from './src/lib/index.ts';

const project = await importProject(inputs); // files supplied as Uint8Array
const inputReport = inspectImport(project);
const result = scheduleProject(project);
const report = validateProject(result.project);
```

The schedule and validation results are deterministic for identical inputs and settings. Import timestamps are metadata and do not affect placement. This is a bounded heuristic solver, not a proof of feasibility or optimality. Validation describes the supplied group data; it cannot infer individual student registrations that are absent from the files.

## Browser application

`npm run dev` serves the Svelte application built on the same core. The workflow is: pick course files and roles, set the exam calendar, import, review the reconciliation findings, then generate. Views cover the rest of the lifecycle — overview, exams, calendar, student groups, issues, rooms, proctors, save & share, audit and help — with a midterm/final switch for the result views.

Behavior worth knowing:

- All parsing, scheduling and validation run in a Web Worker, so the interface stays responsive; a running generation can be cancelled, and stale or cancelled results are never committed.
- The interface shows one language at a time (Thai by default) with a live Thai/English switcher. Dates follow each language's calendar convention, including Buddhist-era years in Thai.
- Managed timings can be edited to any legal candidate. Each edit is previewed through the validator in the worker and saved atomically with a manual lock; blocking collisions are named before the save is possible. Imported timings are read-only.
- Changing the source setup after generating marks the results as stale until the files are imported again.
- Resource assignment clears and rebuilds managed assignments while preserving context assignments. It assigns rooms first, then eligible proctors. Staffing totals show known positive room demand separately from events and rooms with unknown demand, so `26/26 known positions` is never presented as complete coverage when demand is missing. Invalid resource identities, duplicate assignments and quarantined roster candidates cannot inflate the filled count.
- Proctor allocation is a bounded deterministic feasibility heuristic. It uses augmenting reassignment across overlapping duties and tie-breaks by capability, total load, same-day load and consecutive duties. The result can improve cardinality without claiming a global minimum-cost proof; remaining shortages are reported with candidate reasons and source evidence.
- The example button loads the fixture files, so the demonstration run can be reproduced without touching the CLI.
- The last working session (import draft or generated schedule, its raw sources and any cloud connection) is cached in IndexedDB and restored on reload, so a refresh no longer loses the workspace.

## Cloud persistence and sharing

Scheduling always runs locally; the cloud is a persistence and sharing layer. The browser talks to the same Worker API that `tests/worker.test.ts` and `tests/api.test.ts` contract-test:

- **Save** — every save sends the canonical snapshot plus the raw source files and creates a new immutable revision. With autosave on, changes save once you stop editing for 10 seconds; "Save now" is always available. A stale base revision is never silently overwritten: the worker answers `409 REVISION_CONFLICT`, and the app offers a reload/compare flow (schedule hashes side by side, identical content just moves the pointer).
- **Project links** — the first save mints a `full_project` capability kept only in this browser (IndexedDB) — the cloud stores the share's secret hash, never the secret. On another device, pasting the project link (or any share link) on the sources page reopens the project, including its raw source files.
- **Share links** — `#/share/<id>/<secret>` URLs scoped by permission: `schedule` (published schedule only, no roster detail or sources), `audit` (adds normalized inputs, rules, validation and provenance; the audit view's "Copy audit share link" mints a revision-pinned one), `full_project`, and `edit`. Shares can be live (follow the current revision) or pinned to one revision, can expire, and can be revoked. Revoked or expired links stop working without touching stored revisions.

Local development uses the real worker handler over an in-memory store:

```sh
npm run cloud:dev                 # or: node scripts/dev-worker.ts (cloud API on http://127.0.0.1:8787, data lost on restart)
npm run dev                       # the app defaults its server URL to that address
```

For real storage, deploy the worker to Cloudflare with R2 (content-addressed snapshots and source files) and D1 (projects, revisions, shares). After `wrangler login`, one command provisions everything — bucket, database, schema migration and deploy:

```sh
npm run cloud:provision           # idempotent; writes the D1 id into wrangler.jsonc and deploys
```

The deployed worker also serves the built application from the same origin (via the assets binding in `wrangler.jsonc`), so the app finds its API automatically — there is no server URL to configure in the UI. Later deploys are `npm run cloud:deploy` (rebuilds the app, then deploys); schema changes go in `migrations/` and apply with `npm run cloud:migrate`. Anonymous writes to the public API are rate-limited (the `RATE_LIMITER` binding in `wrangler.jsonc`, with an in-memory fallback). ZIP export/import continues to work with no cloud at all.

This release is deployed at <https://schedule.breadtm.xyz> (also reachable at <https://exam-scheduler.ibread.workers.dev>).

## Documentation

Two Thai-language PDFs ship with the repository, built from their LaTeX sources by `docs/build-usage.sh` and `docs/build.sh` (LuaLaTeX; a TeX installation with Thai support is required):

- [docs/usage-report.pdf](docs/usage-report.pdf) — the step-by-step usage manual: getting started, preparing data, importing, reading results, editing exam times, checking, exporting, cloud use and troubleshooting.
- [docs/report.pdf](docs/report.pdf) — the technical report: requirements, design decisions, solver behavior and benchmark measurements, including the production validation of the deployed instance.

Their evidence — screenshots, benchmark data, verification records and checksums — is checked in alongside them under `docs/data/` and `docs/usage-report/evidence/`.

## Later phases

Automatic holiday calendar integration remains future work. Import and reconciliation, exact-time scheduling with manual locks, room and proctor assignment, cloud persistence, sharing, the audit HTTP API and the archival exports are implemented in this repository.

## License

MIT — see [LICENSE](LICENSE). Source repository: <https://github.com/ItsBreadTime/examscheduler>
