import type { Proctor, TimeInterval, ValidationIssue } from '../types.ts';
import type { Spreadsheet, TableSheet } from './spreadsheet.ts';
import { compare, normalize, parseDate, validInterval } from '../time.ts';
import { issue } from '../issues.ts';
export interface ProctorDuty { proctorId: string; date: string; interval: TimeInterval; sourceRef: Proctor['sourceRef'] }
const honorifics = ['ผศ.ดร.', 'รศ.ดร.', 'ผศ.', 'รศ.', 'อ.ดร.', 'อ.', 'ดร.'];
const bareName = (name: string) => { for (const h of honorifics) if (name.startsWith(h)) return name.slice(h.length).trim(); return name; };
function parseMatrixInterval(value: string): TimeInterval | undefined {
  const m = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/.exec(value.trim());
  if (!m) return undefined;
  const t = { startMinutes: +m[1] * 60, endMinutes: +m[2] * 60 };
  return validInterval(t) ? t : undefined;
}
function parseDateHeader(value: string): string | undefined {
  const m = /^(จ|อ|พ|พฤ|ศ|ส)\.\s*(.+)$/.exec(value.trim());
  return m ? parseDate(m[2]) : undefined;
}
interface SheetParse {
  sheet: TableSheet; headerRow: number; nameColumn: number; genderColumn: number;
  computerColumn: number; statusColumn: number; timeCells: string[]; datedColumns: { column: number; date: string }[];
}
/**
 * Parse the proctor workbook (plan §32/§33). Roster sheets carry a กรรมการ header — the roster's
 * name column is wherever that header cell sits, because real sheets are shifted. Other sheets
 * (check sheets, seat layouts, blanks) are skipped but named in an info issue so nothing is
 * silently dropped. Rosters from multiple duty sheets merge per field; dated duty cells are read
 * but interpreted only at the project level, where dates outside the configured exam periods are
 * quarantined. Free-text constraints are preserved, never interpreted (plan §34).
 */
export function parseProctors(input: Spreadsheet) {
  const issues: ValidationIssue[] = [];
  const notes: { text: string; sourceRef: Proctor['sourceRef'] }[] = [];
  const entries = new Map<string, Proctor>();
  const duties: ProctorDuty[] = [];
  const matrixDates = new Set<string>();
  const rosterSheets: SheetParse[] = [];
  const skipped: string[] = [];
  for (const sheet of input.sheets) {
    let headerRow = -1, nameColumn = -1;
    outer: for (const [r, row] of sheet.rows.entries()) for (const [c, cell] of row.entries()) if (normalize(cell) === 'กรรมการ') { headerRow = r; nameColumn = c; break outer; }
    if (headerRow < 0) { if (sheet.rows.some(row => row.some(cell => normalize(cell)))) skipped.push(sheet.name); continue; }
    const header = sheet.rows[headerRow].map(normalize);
    const timeCells = (sheet.rows[headerRow + 1] ?? []).map(normalize);
    const datedColumns: { column: number; date: string }[] = [];
    for (const [c, value] of header.entries()) {
      const date = parseDateHeader(value);
      if (!date) continue;
      matrixDates.add(date);
      // Excel commonly stores a merged date heading over two session columns:
      // the date is in the first column and the adjacent heading cell is blank.
      // Keep every adjacent column that has a valid session interval so a
      // populated morning and afternoon cell each become a dated duty.
      const columns = [c];
      if ((header[c + 1] ?? '') === '') columns.push(c + 1);
      for (const column of columns) {
        if (!parseMatrixInterval(timeCells[column] ?? '')) continue;
        if (!datedColumns.some(d => d.column === column && d.date === date)) datedColumns.push({ column, date });
      }
    }
    rosterSheets.push({
      sheet, headerRow, nameColumn, genderColumn: header.indexOf('เพศ'), computerColumn: header.indexOf('คอม'), statusColumn: header.indexOf('สถานะ'), timeCells, datedColumns,
    });
    for (let r = 0; r <= headerRow + 1; r++) for (const [c, value] of (sheet.rows[r] ?? []).entries()) {
      const cell = normalize(value);
      if (!cell || ['กรรมการ', 'เพศ', 'คอม', 'สถานะ', 'กลาง'].includes(cell) || parseDateHeader(cell) || parseMatrixInterval(cell) || datedColumns.some(d => d.column === c) || /^ตาราง/.test(cell)) continue;
      notes.push({ text: cell, sourceRef: { artifactId: input.artifact.id, sheet: sheet.name, row: r + 1, column: c + 1 } });
    }
  }
  if (skipped.length) issues.push(issue('PROCTOR_SHEET_SKIPPED', `Sheets without a กรรมการ roster header were not interpreted: ${skipped.sort(compare).join(', ')}`, { severity: 'info', blocking: false, sourceRefs: [{ artifactId: input.artifact.id }] }));
  const counts: { sheet: string; roster: number }[] = [];
  for (const layout of rosterSheets) {
    const { sheet, headerRow, nameColumn, timeCells, datedColumns } = layout;
    const field = (row: string[], column: number) => column >= 0 && column < row.length ? normalize(row[column]) : '';
    let roster = 0, started = false;
    for (let r = headerRow + 2; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      const name = field(row, nameColumn);
      // One blank name cell ends the roster region; trailing legend rows (room keys, duty rotas) are not staff.
      if (!name) { if (started) break; continue; }
      started = true; roster++;
      const sourceRef = { artifactId: input.artifact.id, sheet: sheet.name, row: r + 1, column: nameColumn + 1 };
      const role = field(row, layout.statusColumn) || undefined;
      const gender = field(row, layout.genderColumn) || undefined;
      const computer = field(row, layout.computerColumn) === 'ใช่';
      const previous = entries.get(name);
      if (!previous) entries.set(name, { id: `proctor:${name}`, displayName: name, role, gender, tags: computer ? ['computer'] : [], notes: [], availability: [], sourceRef, sourceRefs: [sourceRef] });
      else {
        // Retain every roster row that contributed to this merged person. The
        // first sourceRef remains the stable primary provenance used by the UI.
        previous.sourceRefs ??= [previous.sourceRef];
        previous.sourceRefs.push(sourceRef);
        // Merge per field; only genuinely disagreeing non-empty values are a conflict.
        const conflicts: Proctor['sourceRef'][] = [];
        for (const key of ['role', 'gender'] as const) {
          const incoming = key === 'role' ? role : gender;
          if (!incoming) continue;
          if (previous[key] && previous[key] !== incoming) conflicts.push(sourceRef);
          (previous as unknown as Record<string, unknown>)[key] = incoming;
        }
        if (computer && !previous.tags.includes('computer')) previous.tags.push('computer');
        if (conflicts.length) issues.push(issue('PROCTOR_RECORD_CONFLICT', 'This proctor is described differently across sheets; the later record was kept', { severity: 'warning', blocking: false, sourceRefs: [previous.sourceRef, ...conflicts] }));
      }
      for (const { column: c, date } of datedColumns) {
        const sub = parseMatrixInterval(timeCells[c] ?? '');
        const cell = field(row, c);
        if (!sub || !cell) continue;
        duties.push({ proctorId: `proctor:${name}`, date, interval: sub, sourceRef: { artifactId: input.artifact.id, sheet: sheet.name, row: r + 1, column: c + 1 } });
      }
    }
    counts.push({ sheet: sheet.name, roster });
  }
  if (rosterSheets.length > 1) issues.push(issue('PROCTOR_ROSTER_SHEETS', `Roster sheets were merged into one roster: ${counts.map(c => `${c.sheet} (${c.roster})`).join(', ')}`, { severity: 'info', blocking: false, sourceRefs: [{ artifactId: input.artifact.id }] }));
  const proctors = [...entries.values()].sort((a, b) => compare(a.displayName, b.displayName));
  for (const note of notes) {
    const bare = bareName(note.text);
    const owner = proctors.find(p => note.text.includes(p.displayName) || p.displayName === bare || bareName(p.displayName) === bare);
    if (owner && !owner.notes.includes(note.text)) owner.notes.push(note.text);
    else if (!owner) issues.push(issue('PROCTOR_FREE_TEXT_NOTE', 'Free-text constraint was preserved but requires manual structuring before the scheduler can enforce it', { severity: 'warning', blocking: false, message: `${note.text} — no matching roster entry`, sourceRefs: [note.sourceRef] }));
  }
  for (const p of proctors) if (p.notes.length) issues.push(issue('PROCTOR_FREE_TEXT_NOTE', `Structured availability must be entered manually before this constraint is enforced: ${p.notes.join(' / ')}`, { severity: 'warning', blocking: false, eventIds: [], courseCodes: [], studentGroups: [], sourceRefs: [p.sourceRef] }));
  return { proctors, duties, issues, matrixDates: [...matrixDates].sort(compare) };
}
