import test from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, draftSignature } from '../src/ui/draft.ts';
import { defaultSettings } from '../src/lib/model.ts';

const settings = defaultSettings({ start: '2026-08-17', end: '2026-08-21' }, { start: '2026-10-19', end: '2026-10-23' });

test('draft signatures include resource files and their content hashes', async () => {
  const courseBytes = new Uint8Array([1, 2, 3]);
  const roomBytes = new Uint8Array([4, 5, 6]);
  const baseSources = [{ name: 'courses.csv', role: 'managed' as const, size: courseBytes.length, hash: await contentHash(courseBytes) }];
  const baseReferences = [{ name: 'rooms.csv', kind: 'rooms' as const, size: roomBytes.length, hash: await contentHash(roomBytes) }];
  const base = draftSignature(baseSources, undefined, settings, baseReferences);

  assert.notEqual(
    draftSignature(baseSources, undefined, settings, [{ ...baseReferences[0], hash: await contentHash(new Uint8Array([7, 8, 9])) }]),
    base,
    'same-name, same-size room replacements must invalidate the draft',
  );
  assert.notEqual(draftSignature(baseSources, undefined, settings), base, 'removing a room file must invalidate the draft');
  assert.notEqual(
    draftSignature(baseSources, undefined, settings, [{ name: 'proctors.csv', kind: 'proctors', size: 3, hash: await contentHash(new Uint8Array([10, 11, 12])) }]),
    base,
    'adding a proctor file must invalidate the draft',
  );
});
