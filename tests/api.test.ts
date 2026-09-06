import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../worker/index.ts';
import { createMemoryStore } from '../worker/storage/memory.ts';
import { sha256Hex, stableStringify } from '../worker/storage/store.ts';
import { createCloudProject, createCloudShare, fetchShareSnapshot, fetchShareSource, fetchShareValidation, parseShareRef, revokeCloudShare, saveCloudRevision, RevisionConflictError } from '../src/lib/api.ts';
import type { Project } from '../src/lib/types.ts';
import { project, section } from './helpers.ts';

// The api client speaks plain fetch; bridge it onto the real request handler
// so the transport is tested against the exact worker behavior it will meet.
const realFetch = globalThis.fetch.bind(globalThis);
const store = createMemoryStore();
const bridge = (async (input: RequestInfo | URL, init?: RequestInit) =>
  handleRequest(new Request(input, init), { store })) as typeof fetch;
globalThis.fetch = bridge;

const server = 'https://api.test/';
const snapshotOf = (p: Project) => JSON.parse(stableStringify(p)) as Project;
const base = () => snapshotOf(project([section('060000001'), section('060000002', ['G2'])]));

test('api client: create, conflict, save, share, scoped snapshot, sources, revocation', async () => {
  // parseShareRef accepts a shared link URL and a bare id/secret pair.
  assert.deepEqual(parseShareRef('https://app.example/#/share/shr_abc123/def4567890123456'), { shareId: 'shr_abc123', secret: 'def4567890123456' });
  assert.deepEqual(parseShareRef('shr_abc123:def4567890123456'), { shareId: 'shr_abc123', secret: 'def4567890123456' });
  assert.equal(parseShareRef('https://app.example/'), null);

  const sources = [{ name: '06.xlsx', bytes: new Uint8Array([9, 9]) }];
  const created = await createCloudProject(server, 'Term client', base(), sources);
  assert.match(created.projectId, /^proj_/);
  assert.match(created.revisionId, /^rev_/);
  assert.match(created.snapshotHash, /^sha256:/);
  const owner = { shareId: created.ownerShareId, secret: created.ownerSecret };

  // A stale base is rejected as a typed error carrying the winning revision.
  await assert.rejects(saveCloudRevision(server, created.projectId, 'rev_nobody', base(), sources, owner.secret), (error: unknown) => {
    assert.ok(error instanceof RevisionConflictError);
    assert.equal((error as RevisionConflictError).currentRevisionId, created.revisionId);
    return true;
  });
  // Saving without the owner capability is refused outright (401 without a bearer, 403 with a non-edit one).
  await assert.rejects(saveCloudRevision(server, created.projectId, created.revisionId, base(), sources, 'not-the-secret'), /403/);

  // Unreachable servers surface as a plain, honest error (real network fetch, briefly restored).
  globalThis.fetch = realFetch;
  try {
    await assert.rejects(createCloudProject('http://127.0.0.1:1/', 'x', base(), []), /Cannot reach the cloud server/);
  } finally { globalThis.fetch = bridge; }

  const changed = base();
  changed.locks = { [changed.events[0].id]: { date: '2026-08-17', startMinutes: 540, endMinutes: 720 } };
  const saved = await saveCloudRevision(server, created.projectId, created.revisionId, changed, sources, owner.secret);
  assert.notEqual(saved.revisionId, created.revisionId);

  // Shares: the owner hands out scoped, expiring, revocable capabilities.
  const share = await createCloudShare(server, created.projectId, 'full_project', { expiresAt: '2999-01-01T00:00:00Z' }, owner.secret);
  assert.equal(share.permission, 'full_project');
  const opened = await fetchShareSnapshot(server, share.shareId, share.secret);
  assert.equal(opened.revisionId, saved.revisionId);
  assert.equal(opened.projectId, created.projectId);
  assert.equal(opened.projectName, 'Term client');
  await assert.rejects(fetchShareSnapshot(server, share.shareId, 'wrong-secret'), /401/);

  const validation = await fetchShareValidation(server, share.shareId, share.secret);
  assert.equal(validation.revisionId, saved.revisionId);
  assert.ok(Object.keys(validation.coverage).length);

  const bytes = await fetchShareSource(server, share.shareId, share.secret, await sha256Hex(new Uint8Array([9, 9])));
  assert.deepEqual([...bytes], [9, 9]);

  await revokeCloudShare(server, created.projectId, share.shareId, owner.secret);
  await assert.rejects(fetchShareSnapshot(server, share.shareId, share.secret), /401/);
  // Revoking with a wrong credential is refused; the owner share still works afterwards.
  await assert.rejects(revokeCloudShare(server, created.projectId, owner.shareId, share.secret), /40[13]/);
  const stillOpen = await fetchShareSnapshot(server, owner.shareId, owner.secret);
  assert.equal(stillOpen.permission, 'edit');
});

test('api client: scoped schedule viewers receive neither roster detail nor project identity', async () => {
  const created = await createCloudProject(server, 'Scoped client', base(), []);
  const owner = { secret: created.ownerSecret };
  const schedule = await createCloudShare(server, created.projectId, 'schedule', {}, owner.secret);
  const opened = await fetchShareSnapshot(server, schedule.shareId, schedule.secret);
  assert.equal(opened.permission, 'schedule');
  assert.equal(opened.projectId, null);
  assert.deepEqual(opened.snapshot.proctors, []);
  assert.ok(opened.snapshot.events.every(e => e.proctorAssignments.length === 0));
});
