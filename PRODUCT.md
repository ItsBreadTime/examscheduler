# Exam Scheduler

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

TypeScript domain core with a Svelte and Vite browser application, following the supplied redesign plan. Cloudflare persistence and sharing are later phases.

## Users

University examination coordinators importing course spreadsheets, resolving source contradictions and preparing exam schedules. This audience is inferred from the supplied university workflow; individual permissions and organizational roles are not yet specified.

## Product Purpose

Create deterministic, auditable exam schedules while preserving external examinations and preventing new student-group conflicts. A complete assignment count does not imply a valid schedule.

## Operating Context

Import course files with explicit managed/context roles, configure exam periods and calendar restrictions, inspect reconciliation findings, generate, inspect results and adjust managed times. The source data includes Thai university reports and English course names.

## Capabilities and Constraints

- Thai-by-default interface with a live Thai/English switcher; one language is visible at a time. Preserve original course names and identifiers.
- XLSX, XLS, CSV, TSV, XLSM, XLSB, ODS and FODS inputs through one shared reader.
- Configurable midterm/final periods, weekends and holidays; flag calendar restrictions during input.
- Imported timings are immutable. Manual edits must use the shared validator.
- Never hide source contradictions, missing records, unchecked resources or unscheduled exams.
- Core import, reconciliation, scheduling and validation exist and are regression tested.
- Current scope: browser import/reconciliation, Overview, Exams, Calendar, Groups, Issues, Rooms, Proctors, Save & share and Audit views with manual timing edits.
- Room/proctor allocation, cloud persistence, sharing, the audit HTTP API and archival exports are implemented. Automatic holiday-calendar integration remains future work.

## Evidence on Hand

Original university spreadsheets are preserved byte-for-byte in tests/fixtures. The demonstration manifest produces 354 managed assignments with no generated student collisions and six unresolved exams due to source problems. These are fixture outcomes, not universal product guarantees.

## Product Principles

- Correctness precedes assignment completeness.
- One canonical model and validator across every view.
- Every issue is traceable to source evidence.
- Preserve source data; make corrections explicit.
- Keep scheduling usable with large real-world files.
