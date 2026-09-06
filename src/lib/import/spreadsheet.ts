import * as XLSX from 'xlsx';
import type { SourceArtifact } from '../types.ts';
export const supportedExtensions = ['xlsx', 'xls', 'xlsm', 'xlsb', 'csv', 'tsv', 'ods', 'fods'];
export interface TableSheet { name: string; rows: string[][] }
export interface Spreadsheet { artifact: SourceArtifact; sheets: TableSheet[] }
export async function readSpreadsheet(bytes: Uint8Array, originalName: string, kind: SourceArtifact['kind'], importedAt = new Date().toISOString()): Promise<Spreadsheet> {
  const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
  if (!supportedExtensions.includes(ext)) throw new Error(`Unsupported spreadsheet format: ${ext}`);
  if (!bytes.length) throw new Error('Spreadsheet is empty');
  if (bytes.length > 25 * 1024 * 1024) throw new Error('Spreadsheet exceeds 25 MiB import limit');
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const textFormat = ['csv', 'tsv'].includes(ext);
  const workbook = XLSX.read(textFormat ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : bytes, {
    type: textFormat ? 'string' : 'array', raw: true, cellDates: false, cellNF: true,
    ...(ext === 'tsv' ? { FS: '\t' } : {}),
  });
  const sheets = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    // Normalize actual Excel date cells independently of locale-specific display formats.
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith('!') || typeof cell !== 'object' || cell.t !== 'n' || !cell.z || !XLSX.SSF.is_date(cell.z)) continue;
      const date = XLSX.SSF.parse_date_code(cell.v, { date1904: workbook.Workbook?.WBProps?.date1904 });
      if (date && date.y >= 1900 && cell.v >= 1) cell.w = `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
    }
    return { name, rows: XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true, range: 0 }) };
  });
  return { artifact: { id: `${kind}:${sha256}`, originalName, mediaType: textFormat ? `text/${ext === 'tsv' ? 'tab-separated-values' : 'csv'}` : 'application/octet-stream', byteLength: bytes.length, sha256, importedAt, kind }, sheets };
}
