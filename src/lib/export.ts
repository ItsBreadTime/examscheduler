import * as XLSX from 'xlsx';
import type { ExamEvent, ExamType, Project, ValidationReport } from './types.ts';
import { compare, unique } from './time.ts';
import { buildAuditBundle } from './audit.ts';
import type { AuditBundle } from './audit.ts';
import { assignedRoom, proctorEligible, validAssignedProctors, validProctorDemand } from './resource-model.ts';
export type { AuditBundle };
const thaiDays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const weekDay = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const thaiDateLabel = (date: string) => { const [y, m, d] = date.split('-'); return `${thaiDays[weekDay(date)]}.${d}/${m}/${String((Number(y) + 543) % 100).padStart(2, '0')}`; };
export const hourLabel = (minutes: number) => `${Math.floor(minutes / 60)}${minutes % 60 ? `:${String(minutes % 60).padStart(2, '0')}` : ''}`;
/** The single CSV escaping implementation every export uses (plan §79).
 * Spreadsheet text that starts with =, +, - or @ would execute as a formula when the
 * exported file is opened in Excel, so string cells get a leading apostrophe (numbers keep their sign). */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (value: string | number) => {
    const text = String(value);
    const formula = typeof value === 'string' && /^[=+\-@\t\r]/.test(text);
    const guarded = formula ? `'${text}` : text;
    return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
export const csvBytes = (csv: string) => new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(csv)]);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const courseName = (project: Project, code: string) => project.sections.find(s => s.courseCode === code)?.courseName ?? code;
const originLabel = (event: ExamEvent) => event.timingOrigin === 'imported' ? 'นำเข้า' : event.timingOrigin === 'manual' ? 'กำหนดเอง' : 'สร้างอัตโนมัติ';
export function scheduleRows(project: Project, examType?: ExamType): (string | number)[][] {
  const rows = [['วันที่', 'เวลา', 'รหัสวิชา', 'ชื่อวิชา', 'ตอนเรียน', 'กลุ่มนักศึกษา', 'ห้องสอบ', 'ผู้คุมสอบ', 'ที่มา', 'สถานะ']];
  const events = project.events.filter(e => !examType || e.examType === examType).sort((a, b) => compare(a.timing?.date ?? '9999', b.timing?.date ?? '9999') || (a.timing?.startMinutes ?? 0) - (b.timing?.startMinutes ?? 0) || compare(a.id, b.id));
  for (const event of events) {
    const sections = project.sections.filter(s => event.sectionIds.includes(s.id));
    rows.push([event.timing?.date ?? '', event.timing ? `${hourLabel(event.timing.startMinutes)}-${hourLabel(event.timing.endMinutes)}` : '', event.courseCode, courseName(project, event.courseCode),
      sections.map(s => s.sectionNumber).join(' '), unique(event.studentGroups).join(' '), event.roomAssignments.join(' '), project.proctors.filter(p => event.proctorAssignments.includes(p.id)).map(p => p.displayName).join(' / '),
      originLabel(event), !event.timing ? (event.required ? 'ยังไม่จัด' : 'ไม่ต้องจัด') : event.blocked ? 'ข้อมูลต้นทางไม่สมบูรณ์' : 'จัดแล้ว']);
  }
  return rows;
}
export function roomsRows(project: Project): (string | number)[][] {
  const rows: (string | number)[][] = [['วันที่', 'เวลา', 'ห้องสอบ', 'แถว/โซน', 'รหัสวิชา', 'ชื่อวิชา', 'ผู้คุมสอบที่กำหนด', 'ต้องการผู้คุม', 'สถานะ']];
  const events = project.events.filter(e => e.timing && e.roomAssignments.length).sort((a, b) => compare(a.timing!.date, b.timing!.date) || a.timing!.startMinutes - b.timing!.startMinutes || compare(a.id, b.id));
  for (const event of events) {
    const room = assignedRoom(project, event);
    const assignedRoomNames = [...new Set(event.roomAssignments)].map(id => project.rooms.find(r => r.id === id)?.name ?? id);
    const demand = room?.proctorsRequired;
    const knownDemand = validProctorDemand(demand);
    const assignedProctorIds = [...new Set(event.proctorAssignments)];
    const validFilled = validAssignedProctors(project, event).length;
    rows.push([event.timing!.date, `${hourLabel(event.timing!.startMinutes)}-${hourLabel(event.timing!.endMinutes)}`, assignedRoomNames.join(' / '), room?.zones.join(' ') ?? '', event.courseCode, courseName(project, event.courseCode),
      assignedProctorIds.map(id => project.proctors.find(p => p.id === id)?.displayName ?? id).join(' / '), knownDemand ? demand : 'ไม่ทราบ', !knownDemand ? 'ไม่ทราบความต้องการ' : validFilled < demand ? 'ไม่ครบ' : 'ครบ']);
  }
  return rows;
}
export function dutyColumns(project: Project) {
  const byDate = new Map<string, { startMinutes: number; endMinutes: number }[]>();
  for (const event of project.events) if (event.timing) {
    const list = byDate.get(event.timing.date) ?? [];
    if (!list.some(t => t.startMinutes === event.timing!.startMinutes && t.endMinutes === event.timing!.endMinutes)) list.push({ startMinutes: event.timing!.startMinutes, endMinutes: event.timing!.endMinutes });
    byDate.set(event.timing.date, list.sort((a, b) => a.startMinutes - b.startMinutes));
  }
  return [...byDate.entries()].sort(([a], [b]) => compare(a, b)).flatMap(([date, intervals]) => intervals.map(interval => ({ date, interval, label: `${thaiDateLabel(date)} ${hourLabel(interval.startMinutes)}-${hourLabel(interval.endMinutes)}` })));
}
/** Proctor duty matrix in the spirit of the supplied source layout (plan §75). */
export function proctorMatrixRows(project: Project): (string | number)[][] {
  const columns = dutyColumns(project);
  const header: (string | number)[][] = [['กรรมการ', 'เพศ', 'คอม', 'สถานะ', 'สิทธิ์การจัด', 'แหล่งที่มา'], ['', '', '', '', '', '']];
  for (const column of columns) { header[0].push(column.label.replace(/ [^ ]+$/, '')); header[1].push(column.label.split(' ').pop()!); }
  const rows: (string | number)[][] = [...header];
  for (const proctor of project.proctors) {
    const eligible = proctorEligible(project, proctor);
    const reason = proctor.assignmentEligibility?.reason ?? 'แหล่งผู้คุมสอบไม่ตรงภาคการศึกษา';
    const references = [...new Map((proctor.sourceRefs ?? [proctor.sourceRef]).map(ref => [`${ref.artifactId}:${ref.sheet ?? ''}:${ref.row ?? ''}:${ref.column ?? ''}`, ref])).values()];
    const source = references.map(ref => {
      const artifact = project.artifacts.find(a => a.id === ref.artifactId);
      const term = artifact?.term ? `${artifact.term.campus ? `${artifact.term.campus} ` : ''}${artifact.term.semester}/${artifact.term.academicYearBE}` : 'ไม่ทราบ';
      return `${term} · ${artifact?.originalName ?? ref.artifactId}${ref.sheet ? ` · ${ref.sheet}` : ''}${ref.row ? ` · แถว ${ref.row}` : ''}`;
    }).join(' / ');
    const row: (string | number)[] = [proctor.displayName, proctor.gender ?? '', proctor.tags.includes('computer') ? 'ใช่' : '', proctor.role ?? '', eligible ? 'ใช้ได้' : `กักกัน: ${reason}`, source];
    for (const column of columns) {
      const duties = project.events.filter(e => e.timing?.date === column.date && e.timing.startMinutes === column.interval.startMinutes && e.timing.endMinutes === column.interval.endMinutes && e.proctorAssignments.includes(proctor.id)).map(e => e.courseCode);
      row.push(unique(duties).join(' '));
    }
    rows.push(row);
  }
  return rows;
}
export function proctorMatrixXlsx(project: Project): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet(proctorMatrixRows(project));
  const out = XLSX.write({ SheetNames: ['ตารางคุมสอบ'], Sheets: { 'ตารางคุมสอบ': sheet } }, { bookType: 'xlsx', type: 'array' });
  // SheetJS 'array' may return an ArrayBuffer (not iterable) — normalize to a Uint8Array so callers can spread it.
  return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
}
export function issuesRows(project: Project, validation: ValidationReport): (string | number)[][] {
  const rows = [['รหัสข้อผิดพลาด', 'ระดับ', 'ที่มา', 'รหัสวิชา', 'ข้อความ']];
  for (const item of [...validation.issues, ...project.importIssues.filter(i => !validation.issues.some(v => v.id === i.id))].sort((a, b) => compare(a.id, b.id))) rows.push([item.type, item.severity, item.origin, item.courseCodes.join(' '), item.message]);
  return rows;
}
/** Standalone printable calendar; every source value is HTML-escaped (plan §79). */
export function calendarHtml(project: Project, examType: ExamType): string {
  const events = project.events.filter(e => e.timing && e.examType === examType).sort((a, b) => compare(a.timing!.date, b.timing!.date) || a.timing!.startMinutes - b.timing!.startMinutes || compare(a.id, b.id));
  const days = new Map<string, ExamEvent[]>();
  for (const event of events) days.set(event.timing!.date, [...(days.get(event.timing!.date) ?? []), event]);
  const title = examType === 'midterm' ? 'ปฏิทินสอบกลางภาค' : 'ปฏิทินสอบปลายภาค';
  const rows = [...days.entries()].map(([date, dayEvents]) => `      <tr><th scope="row">${escapeHtml(thaiDateLabel(date))}</th><td>${dayEvents.map(e => `<div class="e"><b>${escapeHtml(e.courseCode)}</b> ${escapeHtml(courseName(project, e.courseCode))} · ${escapeHtml(hourLabel(e.timing!.startMinutes))}-${escapeHtml(hourLabel(e.timing!.endMinutes))}${e.roomAssignments.length ? ` · ${escapeHtml(e.roomAssignments.join(', '))}` : ''}</div>`).join('')}</td></tr>`).join('\n');
  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#f5f6f2;color:#1d2a26;margin:0;padding:2rem}
main{max-width:60rem;margin:auto;background:#fff;border:1px solid #daded3;padding:1.5rem 2rem}
h1{font-size:1.25rem}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:.5rem;border-top:1px solid #daded3;font-weight:400}
th[scope=row]{white-space:nowrap}.e{margin:.15rem 0}@media print{body{background:#fff}}</style></head>
<body><main><h1>${title}</h1><table>
      <tr><th>วัน</th><th>การสอบ</th></tr>
${rows}
    </table></main></body></html>`;
}
/** Complete self-contained archive (plan §59); source files are included only when still held by the caller. */
export async function buildArchive(project: Project, validation: ValidationReport, sourceFiles: { name: string; bytes: Uint8Array }[] = []): Promise<{ path: string; bytes: Uint8Array }[]> {
  const get = (path: string, csv: (string | number)[][]) => ({ path, bytes: csvBytes(toCsv(csv)) });
  const audit = await buildAuditBundle(project, validation);
  const text = (path: string, value: string) => ({ path, bytes: new TextEncoder().encode(value) });
  return [
    text('project.json', JSON.stringify(project, null, 2)),
    text('audit.json', JSON.stringify(audit, null, 2)),
    text('validation.json', JSON.stringify(validation, null, 2)),
    get('exports/ตารางสอบทั้งหมด.csv', scheduleRows(project)),
    get('exports/ตารางสอบกลางภาค.csv', scheduleRows(project, 'midterm')),
    get('exports/ตารางสอบปลายภาค.csv', scheduleRows(project, 'final')),
    get('exports/ตารางห้องสอบ.csv', roomsRows(project)),
    get('exports/ตารางคุมสอบ.csv', proctorMatrixRows(project)),
    { path: 'exports/ตารางคุมสอบ.xlsx', bytes: proctorMatrixXlsx(project) },
    get('exports/ปัญหาตารางสอบ.csv', issuesRows(project, validation)),
    text('exports/ปฏิทินสอบกลางภาค.html', calendarHtml(project, 'midterm')),
    text('exports/ปฏิทินสอบปลายภาค.html', calendarHtml(project, 'final')),
    ...sourceFiles.map(file => ({ path: `sources/${file.name}`, bytes: new Uint8Array(file.bytes) })),
    text('manifest.json', JSON.stringify({ schemaVersion: audit.schemaVersion, scheduleHash: audit.scheduleHash, sourceHash: audit.sourceHash, files: sourceFiles.map(f => f.name) }, null, 2)),
  ];
}
