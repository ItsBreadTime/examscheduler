import type { RoomResource, ValidationIssue } from '../types.ts';
import type { Spreadsheet } from './spreadsheet.ts';
import { compare, normalize, unique } from '../time.ts';
import { issue } from '../issues.ts';
export function parseRooms(input: Spreadsheet) {
  const rooms: RoomResource[] = [], issues: ValidationIssue[] = [];
  for (const sheet of input.sheets) {
    let header: string[] | undefined;
    for (const [i, row] of sheet.rows.entries()) {
      const cells = row.map(normalize);
      if (cells.some(c => c === 'ห้อง')) { header = cells; continue; }
      if (!cells.some(Boolean) || cells.every(c => !c)) continue;
      if (!header) { issues.push(issue('INVALID_ROOM_HEADER', 'Expected a room table with a ห้อง column', { sourceRefs: [{ artifactId: input.artifact.id, sheet: sheet.name, row: i + 1 }] })); continue; }
      const name = cells[0];
      const sourceRef = { artifactId: input.artifact.id, sheet: sheet.name, row: i + 1, column: 1 };
      const at = (needle: string) => header!.findIndex(h => h.includes(needle));
      const zoneIndex = at('แถว'), countIndex = at('จำนวนคน'), computerIndex = at('คอม');
      const rawCount = countIndex >= 0 ? cells[countIndex] : '';
      const proctorsRequired = /^\d+$/.test(rawCount) ? Number(rawCount) : undefined;
      if (rawCount && proctorsRequired === undefined) issues.push(issue('MALFORMED_ROOM_PROCTOR_COUNT', 'The จำนวนคน column must be a whole number', { severity: 'warning', blocking: false, sourceRefs: [sourceRef] }));
      if (rooms.some(r => r.name === name)) { issues.push(issue('DUPLICATE_ROOM', 'Room name appears in more than one row; the later row was not imported', { sourceRefs: [sourceRef] })); continue; }
      rooms.push({
        id: `room:${name}`, name,
        zones: unique((zoneIndex >= 0 ? cells[zoneIndex] : '').split(/\s+/).filter(Boolean)),
        proctorsRequired, tags: computerIndex >= 0 && cells[computerIndex] === 'ใช่' ? ['computer'] : [],
        unavailableDates: [], sourceRef,
      });
    }
  }
  rooms.sort((a, b) => compare(a.name, b.name));
  if (!rooms.length) issues.push(issue('NO_ROOM_RECORDS', 'The room file contains no room rows'));
  // Plan §29: จำนวนคน is a provisional, documented mapping to proctors-per-exam, not seat capacity.
  if (rooms.some(r => r.proctorsRequired !== undefined)) issues.push(issue('ROOM_PROCTOR_COUNT_MAPPING', 'The จำนวนคน value is interpreted as the number of proctors required per exam held in that room (provisional mapping; seat capacity is not checked)', { severity: 'info', blocking: false }));
  return { rooms, issues };
}
