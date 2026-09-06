import type { SchedulerSettings, SourceRole } from '../lib/types.ts';
import { sha256Hex } from '../lib/audit.ts';

export interface DraftFile { name: string; size: number; hash: string }
export interface DraftSourceFile extends DraftFile { role: SourceRole }
export interface DraftReferenceFile extends DraftFile { kind: 'rooms' | 'proctors' }

/** Hash source bytes for draft comparison, so same-name, same-size replacements are still detected. */
export const contentHash = (bytes: Uint8Array) => sha256Hex(bytes);

export async function describeDraftFile(file: { name: string; bytes: Uint8Array }): Promise<DraftFile> {
  return { name: file.name, size: file.bytes.length, hash: await contentHash(file.bytes) };
}

/** Identifies every import input, including resource files and their content. Equal signatures produce equal imports. */
export function draftSignature(sources: DraftSourceFile[], rules: DraftFile | null | undefined, settings: SchedulerSettings, references: DraftReferenceFile[] = []) {
  return JSON.stringify({
    sources: sources.map(s => `${s.role}:${s.name}:${s.size}:${s.hash}`).sort(),
    rules: rules ? `${rules.name}:${rules.size}:${rules.hash}` : null,
    references: references.map(reference => `${reference.kind}:${reference.name}:${reference.size}:${reference.hash}`).sort(),
    settings,
  });
}
