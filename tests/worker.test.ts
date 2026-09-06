import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, openapiDocument } from '../worker/index.ts';
import { createMemoryStore } from '../worker/storage/memory.ts';
import { sha256Hex, stableStringify } from '../worker/storage/store.ts';
import type { Project } from '../src/lib/types.ts';
import { defaultSettings } from '../src/lib/model.ts';
import { project, section } from './helpers.ts';

const call = async (store: ReturnType<typeof createMemoryStore>, method: string, path: string, body?: unknown, bearer?: string, ip?: string) => {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (ip) headers['cf-connecting-ip'] = ip;
  const response = await handleRequest(
    new Request(`https://worker.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { store },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const snapshotOf = (p: Project) => JSON.parse(stableStringify(p)) as Project;

test('worker project lifecycle: create, save, conflict, shares, revocation, expiry, pinning', async () => {
  const store = createMemoryStore();
  const base = project([section('060000001'), section('060000002', ['G2'])]);
  const created = await call(store, 'POST', '/api/v1/projects', { name: 'Term 1', snapshot: snapshotOf(base) });
  assert.equal(created.status, 201);
  const projectId = created.body.projectId as string;
  const rev1 = created.body.revisionId as string;
  // The creator receives the owner capability: an edit-permission share that gates all management.
  const ownerSecret = created.body.ownerSecret as string;
  assert.match(created.body.ownerShareId as string, /^shr_/);
  assert.ok(ownerSecret.length >= 32);

  // Saving without a capability credential is refused.
  const anonymousSave = await call(store, 'PUT', `/api/v1/projects/${projectId}/revisions`, { baseRevisionId: rev1, snapshot: snapshotOf(base) });
  assert.equal(anonymousSave.status, 401);

  // Deterministic save: identical content hashes identically; a stale base is rejected as a typed conflict.
  const staleSave = await call(store, 'PUT', `/api/v1/projects/${projectId}/revisions`, { baseRevisionId: 'rev_stale', snapshot: snapshotOf(base) }, ownerSecret);
  assert.equal(staleSave.status, 409);
  assert.equal(staleSave.body.error, 'REVISION_CONFLICT');

  const changed = snapshotOf(base);
  changed.locks = { [changed.events[0].id]: { date: '2026-08-17', startMinutes: 540, endMinutes: 720 } };
  const saved = await call(store, 'PUT', `/api/v1/projects/${projectId}/revisions`, { baseRevisionId: rev1, snapshot: changed }, ownerSecret);
  assert.equal(saved.status, 200);
  const rev2 = saved.body.revisionId as string;

  // Read-only audit share: snapshot, validation and audit are stable and revision-pinned.
  const share = await call(store, 'POST', `/api/v1/projects/${projectId}/shares`, { permission: 'audit', revisionId: rev2 }, ownerSecret);
  assert.equal(share.status, 201);
  const shareId = share.body.shareId as string;
  const secret = share.body.secret as string;
  const snap = await call(store, 'GET', `/api/v1/shares/${shareId}/snapshot`, undefined, secret);
  assert.equal(snap.status, 200);
  assert.equal((snap.body as { revisionId: string }).revisionId, rev2);
  // Scoped viewers never learn the projectId — it is the handle for the write surface.
  assert.equal((snap.body as { projectId: unknown }).projectId, null);
  const validation = await call(store, 'GET', `/api/v1/shares/${shareId}/validation`, undefined, secret);
  assert.equal(validation.status, 200);
  assert.equal((validation.body as { revisionId: string }).revisionId, rev2);
  assert.ok(((validation.body as { coverage: object }).coverage));
  const audit = await call(store, 'GET', `/api/v1/shares/${shareId}/audit`, undefined, secret);
  assert.equal(audit.status, 200);
  const auditBody = audit.body as { audit: { schemaVersion: number; issues: unknown[] } };
  assert.equal(auditBody.audit.schemaVersion, 4);
  const auditAgain = await call(store, 'GET', `/api/v1/shares/${shareId}/audit`, undefined, secret);
  assert.equal(auditAgain.body.revisionId, audit.body.revisionId);
  // generatedAt is a fresh timestamp per call; everything else must be deterministic.
  const strip = (value: unknown) => { const copy = JSON.parse(JSON.stringify(value)) as { audit: { generatedAt?: string } }; delete copy.audit.generatedAt; return copy; };
  assert.deepEqual(strip(auditAgain.body), strip(audit.body));

  // Schedule shares see assignments but neither the roster, proctor names nor import detail.
  const scheduleShare = await call(store, 'POST', `/api/v1/projects/${projectId}/shares`, { permission: 'schedule' }, ownerSecret);
  const scheduleId = scheduleShare.body.shareId as string;
  const scheduleSecret = scheduleShare.body.secret as string;
  const scheduleAudit = await call(store, 'GET', `/api/v1/shares/${scheduleId}/audit`, undefined, scheduleSecret);
  assert.equal(scheduleAudit.status, 403);

  // A read-only share holder cannot escalate: no saving, no minting shares, no revoking.
  assert.equal((await call(store, 'PUT', `/api/v1/projects/${projectId}/revisions`, { baseRevisionId: rev2, snapshot: changed }, scheduleSecret)).status, 403);
  assert.equal((await call(store, 'POST', `/api/v1/projects/${projectId}/shares`, { permission: 'edit' }, scheduleSecret)).status, 403);
  assert.equal((await call(store, 'DELETE', `/api/v1/projects/${projectId}/shares/${shareId}`, undefined, scheduleSecret)).status, 403);
  // Knowing the shareId alone is not enough to revoke: the URL carries the share id publicly.
  assert.equal((await call(store, 'DELETE', `/api/v1/projects/${projectId}/shares/${scheduleId}`)).status, 401);

  // Live shares follow the current revision; pinned shares do not.
  const liveShare = await call(store, 'POST', `/api/v1/projects/${projectId}/shares`, { permission: 'full_project' }, ownerSecret);
  const liveId = liveShare.body.shareId as string;
  const liveSecret = liveShare.body.secret as string;
  const liveBefore = await call(store, 'GET', `/api/v1/shares/${liveId}/snapshot`, undefined, liveSecret);
  assert.equal((liveBefore.body as { revisionId: string }).revisionId, rev2);
  assert.equal((liveBefore.body as { projectId: string }).projectId, projectId);
  const changedAgain = snapshotOf(changed);
  changedAgain.settings = defaultSettings({ start: '2026-08-17', end: '2026-08-29' }, { start: '2026-10-14', end: '2026-10-30' });
  // Proctor ids embed the roster name, so the schedule scope must strip them from events.
  changedAgain.events[0].proctorAssignments = ['proctor:สมศรี ใจดี'];
  const savedAgain = await call(store, 'PUT', `/api/v1/projects/${projectId}/revisions`, { baseRevisionId: rev2, snapshot: changedAgain }, ownerSecret);
  const rev3 = savedAgain.body.revisionId as string;
  const liveAfter = await call(store, 'GET', `/api/v1/shares/${liveId}/snapshot`, undefined, liveSecret);
  assert.equal((liveAfter.body as { revisionId: string }).revisionId, rev3);
  const pinnedAfter = await call(store, 'GET', `/api/v1/shares/${shareId}/snapshot`, undefined, secret);
  assert.equal((pinnedAfter.body as { revisionId: string }).revisionId, rev2);
  const scheduleSnap = await call(store, 'GET', `/api/v1/shares/${scheduleId}/snapshot`, undefined, scheduleSecret);
  assert.equal(scheduleSnap.status, 200);
  const scheduleSnapshot = scheduleSnap.body as { snapshot: { proctors: unknown[]; events: { proctorAssignments: string[] }[] } };
  assert.deepEqual(scheduleSnapshot.snapshot.proctors, []);
  assert.ok(scheduleSnapshot.snapshot.events.every(e => e.proctorAssignments.length === 0));

  // Revocation and expiry refuse access without deleting the project.
  const revoked = await call(store, 'DELETE', `/api/v1/projects/${projectId}/shares/${liveId}`, undefined, ownerSecret);
  assert.equal(revoked.status, 200);
  assert.equal((await call(store, 'GET', `/api/v1/shares/${liveId}/snapshot`, undefined, liveSecret)).status, 401);
  const expiring = await call(store, 'POST', `/api/v1/projects/${projectId}/shares`, { permission: 'schedule', expiresAt: '2000-01-01T00:00:00Z' }, ownerSecret);
  assert.equal((await call(store, 'GET', `/api/v1/shares/${expiring.body.shareId as string}/snapshot`, undefined, expiring.body.secret as string)).status, 401);
  // Expiry must parse as a date; garbage cannot create a never-expiring share.
  assert.equal((await call(store, 'POST', `/api/v1/projects/${projectId}/shares`, { permission: 'schedule', expiresAt: 'not-a-date' }, ownerSecret)).status, 400);
  assert.equal((await call(store, 'GET', `/api/v1/shares/${shareId}/snapshot`)).status, 401);
});

test('worker write surface: size caps, source caps and mutation rate limiting', async () => {
  const store = createMemoryStore();
  const p = project([section('060000001')]);

  // At most 20 source files per request.
  const manySources = Array.from({ length: 21 }, (_, i) => ({ name: `f${i}.bin`, bytes: [1] }));
  const tooMany = await call(store, 'POST', '/api/v1/projects', { name: 'Term', snapshot: snapshotOf(p), sources: manySources });
  assert.equal(tooMany.status, 413);

  // Bodies beyond the cap are refused before parsing.
  const oversizedBody = `{"name":"Term","snapshot":${JSON.stringify(snapshotOf(p))},"sources":[{"name":"big.bin","bytes":[${'1,'.repeat(33 * 1024 * 1024)}1]}]}`;
  const huge = await handleRequest(new Request('https://worker.test/api/v1/projects', { method: 'POST', body: oversizedBody, headers: { 'content-type': 'application/json' } }), { store });
  assert.equal(huge.status, 413);

  // Malformed source entries are refused outright.
  const malformed = await call(store, 'POST', '/api/v1/projects', { name: 'Term', snapshot: snapshotOf(p), sources: [{ name: '', bytes: [1] }] });
  assert.equal(malformed.status, 413);

  // Mutations are rate limited per client; reads are not.
  const limited = createMemoryStore();
  const env = { store: limited, rateLimit: { mutationsPerMinute: 2 } };
  const ip = { 'cf-connecting-ip': '198.51.100.7' };
  const post = () => handleRequest(new Request('https://worker.test/api/v1/projects', { method: 'POST', headers: ip, body: JSON.stringify({ snapshot: snapshotOf(p) }) }), env);
  assert.equal((await post()).status, 201);
  assert.equal((await post()).status, 201);
  assert.equal((await post()).status, 429);
  const read = await handleRequest(new Request('https://worker.test/api/v1/validate', { method: 'POST', headers: ip, body: JSON.stringify(snapshotOf(p)) }), env);
  assert.equal(read.status, 200);
  // A different client keeps its own budget.
  assert.equal((await handleRequest(new Request('https://worker.test/api/v1/projects', { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.8' }, body: JSON.stringify({ snapshot: snapshotOf(p) }) }), env)).status, 201);
});

test('worker validate endpoint and openapi document share the canonical validator', async () => {  const store = createMemoryStore();
  const p = project([section('060000001'), section('060000002')]);
  const conflicted = snapshotOf(p);
  conflicted.events[0].timing = { date: '2026-08-17', startMinutes: 540, endMinutes: 720 };
  conflicted.events[1].timing = { date: '2026-08-17', startMinutes: 540, endMinutes: 720 };
  const invalid = await call(store, 'POST', '/api/v1/validate', conflicted);
  assert.equal(invalid.status, 200);
  assert.equal(invalid.body.status, 'invalid');
  assert.ok(((invalid.body as { issues: { type: string }[] }).issues.some(i => i.type === 'STUDENT_GROUP_OVERLAP')));
  assert.equal(await call(store, 'POST', '/api/v1/validate', { nope: true }).then(r => r.status), 400);
  const openapi = await handleRequest(new Request('https://worker.test/openapi.json'), { store });
  const document = (await openapi.json()) as ReturnType<typeof openapiDocument>;
  for (const id of ['validateProject', 'getProjectSnapshot', 'getAuditBundle', 'getValidationReport']) {
    assert.ok(JSON.stringify(document.paths).includes(id), id);
  }
  const root = await handleRequest(new Request('https://worker.test/'), { store });
  assert.equal(root.status, 200);
  assert.equal((await root.json() as { service: string }).service, 'exam-scheduler');
});

test('worker gates raw source downloads by permission and answers cross-origin preflights', async () => {
  const store = createMemoryStore();
  const p = project([section('060000001')]);
  const sourceBytes = new Uint8Array([1, 2, 3]);
  const created = await call(store, 'POST', '/api/v1/projects', { name: 'Term 2', snapshot: snapshotOf(p), sources: [{ name: 'courses.csv', bytes: [...sourceBytes] }] });
  const projectId = created.body.projectId as string;
  const ownerSecret = created.body.ownerSecret as string;
  const hash = await sha256Hex(sourceBytes);

  const full = await call(store, 'POST', `/api/v1/projects/${projectId}/shares`, { permission: 'full_project' }, ownerSecret);
  const fullId = full.body.shareId as string;
  const fullSecret = full.body.secret as string;
  const snap = await call(store, 'GET', `/api/v1/shares/${fullId}/snapshot`, undefined, fullSecret);
  // The SPA needs the project identity and name to adopt an edit share into an editing session.
  assert.equal((snap.body as { projectId: string }).projectId, projectId);
  assert.equal((snap.body as { projectName: string }).projectName, 'Term 2');

  const source = await handleRequest(new Request(`https://worker.test/api/v1/shares/${fullId}/sources/${hash}`, { headers: { authorization: `Bearer ${fullSecret}` } }), { store });
  assert.equal(source.status, 200);
  assert.deepEqual([...new Uint8Array(await source.arrayBuffer())], [...sourceBytes]);
  assert.equal(source.headers.get('content-disposition'), 'attachment');
  assert.equal(source.headers.get('x-content-type-options'), 'nosniff');

  const audit = await call(store, 'POST', `/api/v1/projects/${projectId}/shares`, { permission: 'audit', revisionId: created.body.revisionId as string }, ownerSecret);
  const auditId = audit.body.shareId as string;
  assert.equal((await handleRequest(new Request(`https://worker.test/api/v1/shares/${auditId}/sources/${hash}`, { headers: { authorization: `Bearer ${audit.body.secret}` } }), { store })).status, 403);
  assert.equal((await handleRequest(new Request(`https://worker.test/api/v1/shares/${fullId}/sources/${hash}`), { store })).status, 401);
  assert.equal((await handleRequest(new Request(`https://worker.test/api/v1/shares/${fullId}/sources/${'0'.repeat(64)}`, { headers: { authorization: `Bearer ${fullSecret}` } }), { store })).status, 404);

  // The SPA is served from another origin; preflight must succeed without auth.
  const preflight = await handleRequest(new Request('https://worker.test/api/v1/projects', { method: 'OPTIONS' }), { store });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  const openapi = await handleRequest(new Request('https://worker.test/openapi.json'), { store });
  assert.equal(openapi.headers.get('access-control-allow-origin'), '*');
  assert.ok(JSON.stringify((await openapi.json() as ReturnType<typeof openapiDocument>).paths).includes('getSourceArtifact'));
});
