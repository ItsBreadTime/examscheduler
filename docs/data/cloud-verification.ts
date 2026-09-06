// Deployed-cloud validation evidence. Run: node docs/data/cloud-verification.ts [base-url]
// Walks the production worker API contract (create, revisions, shares, sources, caps, rate
// limit) against the deployed instance and records every result here. Secrets are never
// persisted: owner/share secrets are used in-flight only and reduced to an 8-hex sha256 prefix.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { sha256Hex, stableStringify } from '../../worker/storage/store.ts';
import { saveRecord, root } from './records.ts';

const BASE = (process.argv[2] ?? 'https://schedule.breadtm.xyz/').replace(/\/+$/, '');
const OUT = resolve(import.meta.dirname, 'cloud-verification.json');

interface Check { id: string; check: string; expected: string; observed: string; pass: boolean }
const checks: Check[] = [];
const lines: string[] = [];
const log = (line: string) => { lines.push(line); console.log(line); };
const record = (c: Check) => { checks.push(c); log(`[${c.pass ? 'ok' : 'FAIL'}] ${c.id}: ${c.observed}`); };
const secretTag = async (secret: string) => (await sha256Hex(new TextEncoder().encode(secret))).slice(0, 8);

interface CallResult { status: number; headers: Headers; text: string; bytes: Uint8Array; json: any }
async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<CallResult> {
  const init: RequestInit = { method, signal: AbortSignal.timeout(30000), headers: {} as Record<string, string> };
  if (opts.token) (init.headers as Record<string, string>).authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) {
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const response = await fetch(`${BASE}${path}`, init);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, text: new TextDecoder().decode(bytes), bytes, json: (() => { try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return undefined; } })() };
}

// Canonical payload: the checksummed clean-set project from the report's evidence set.
const clean = JSON.parse(readFileSync(resolve(import.meta.dirname, 'results-clean.json'), 'utf8'));
const project = clean.project;
const sourceBytes = new TextEncoder().encode('cloud-verification source artifact 2026-09-06');
const sourceHash = await sha256Hex(sourceBytes);
const snapshotHash = await sha256Hex(new TextEncoder().encode(stableStringify(project)));
const minimalSnapshot = { schemaVersion: 1, events: [], sections: [], settings: {} };

// ---- environment: deployed bundle identity ------------------------------------------------
const served = await call('GET', '/');
const localHtml = existsSync(resolve(root, 'web-dist/index.html')) ? readFileSync(resolve(root, 'web-dist/index.html'), 'utf8') : null;
const jsRef = (html: string) => html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1] ?? null;
const cssRef = (html: string) => html.match(/href="(\/assets\/index-[^"]+\.css)"/)?.[1] ?? null;
const cspOf = (html: string) => html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"\s*\/?>/)?.[1] ?? null;
const deployedAssets = { js: jsRef(served.text), css: cssRef(served.text) };
const localAssets = localHtml ? { js: jsRef(localHtml), css: cssRef(localHtml) } : null;
const cspEqual = !!localHtml && cspOf(served.text) === cspOf(localHtml) && cspOf(served.text) !== null;
const assetsEqual = !!localAssets && deployedAssets.js === localAssets.js && deployedAssets.css === localAssets.css;
log(`[env] deployed assets: ${deployedAssets.js}, ${deployedAssets.css}`);
record({
  id: 'spa-parity',
  check: 'served SPA asset refs and CSP meta are identical to the current revision build',
  expected: `served HTML asset refs and CSP meta equal to local web-dist build (${localAssets?.js?.split('/').pop()}, ${localAssets?.css?.split('/').pop()})`,
  observed: `status ${served.status}, js ${deployedAssets.js?.split('/').pop()}, css ${deployedAssets.css?.split('/').pop()}, CSP ${cspOf(served.text) ? 'present' : 'absent'}${cspEqual ? ', byte-identical to local build' : ', differs from local build'}`,
  pass: served.status === 200 && assetsEqual && cspEqual,
});

const openapi = await call('GET', '/openapi.json');
const headersOk = openapi.headers.get('x-content-type-options') === 'nosniff' && openapi.headers.get('referrer-policy') === 'no-referrer';
record({
  id: 'openapi',
  check: 'the deployed worker publishes its OpenAPI document and API version',
  expected: '200, openapi 3.1.0 document, info.version 1.1.0',
  observed: `${openapi.status}, openapi ${openapi.json?.openapi ?? 'n/a'}, version ${openapi.json?.info?.version ?? 'n/a'}`,
  pass: openapi.status === 200 && openapi.json?.openapi === '3.1.0' && openapi.json?.info?.version === '1.1.0',
});
record({
  id: 'security-headers',
  check: 'API responses carry the anti-sniffing and referrer headers',
  expected: 'x-content-type-options: nosniff and referrer-policy: no-referrer',
  observed: `x-content-type-options: ${openapi.headers.get('x-content-type-options')}, referrer-policy: ${openapi.headers.get('referrer-policy')}`,
  pass: headersOk,
});

// ---- API surface walk ----------------------------------------------------------------------
// Validate the canonical snapshot remotely and tie the deployed worker to the recorded
// evidence: the schedule hash is deterministic across environments.
{
  const r = await call('POST', '/api/v1/validate', { body: project });
  const expectedHash = `sha256:${clean.audit.scheduleHash}`;
  record({
    id: 'validate-evidence-hash',
    check: 'the deployed validator reports the schedule hash recorded in the clean-set evidence',
    expected: `200, scheduleHash ${expectedHash.slice(0, 21)} (docs/data/results-clean.json audit.scheduleHash)`,
    observed: `${r.status}, scheduleHash ${r.json?.scheduleHash ?? 'n/a'}, status ${r.json?.status ?? 'n/a'}`,
    pass: r.status === 200 && r.json?.scheduleHash === expectedHash,
  });
}

const stamp = new Date().toISOString().slice(0, 10);
const created = await call('POST', '/api/v1/projects', { body: { name: `cloud-validation-${stamp}`, snapshot: project, sources: [{ name: 'cloud-verification-source.txt', bytes: [...sourceBytes] }] } });
const projId = created.json?.projectId, rev1 = created.json?.revisionId, ownerSecret = created.json?.ownerSecret;
record({
  id: 'create-project',
  check: 'project creation stores the canonical snapshot and returns the owner capability',
  expected: `201, snapshotHash sha256:${snapshotHash.slice(0, 12)}, ownerShareId + ownerSecret returned`,
  observed: `${created.status}, snapshotHash ${created.json?.snapshotHash?.slice(0, 21) ?? 'n/a'}, ownerShareId ${created.json?.ownerShareId ?? 'none'}${ownerSecret ? ` (secret ${await secretTag(ownerSecret)})` : ''}`,
  pass: created.status === 201 && created.json?.snapshotHash === `sha256:${snapshotHash}` && typeof projId === 'string' && typeof rev1 === 'string' && typeof ownerSecret === 'string' && typeof created.json?.ownerShareId === 'string',
});

const rev2 = await call('PUT', `/api/v1/projects/${projId}/revisions`, { token: ownerSecret, body: { baseRevisionId: rev1, snapshot: project, sources: [] } });
record({
  id: 'revision-save',
  check: 'saving a new revision with the owner capability succeeds',
  expected: '200, new revisionId distinct from the base',
  observed: `${rev2.status}, revisionId ${rev2.json?.revisionId ?? 'n/a'}`,
  pass: rev2.status === 200 && typeof rev2.json?.revisionId === 'string' && rev2.json.revisionId !== rev1,
});

const conflict = await call('PUT', `/api/v1/projects/${projId}/revisions`, { token: ownerSecret, body: { baseRevisionId: rev1, snapshot: project, sources: [] } });
record({
  id: 'revision-conflict',
  check: 'saving against a stale base revision is rejected (optimistic concurrency)',
  expected: '409 REVISION_CONFLICT with currentRevisionId',
  observed: `${conflict.status} ${conflict.json?.error ?? ''}, currentRevisionId ${conflict.json?.currentRevisionId === rev2.json?.revisionId ? 'matches latest' : conflict.json?.currentRevisionId ?? 'n/a'}`,
  pass: conflict.status === 409 && conflict.json?.error === 'REVISION_CONFLICT' && conflict.json?.currentRevisionId === rev2.json?.revisionId,
});

// Share scopes: schedule hides roster/sources, audit adds provenance, full copies everything.
const makeShare = (permission: string) => call('POST', `/api/v1/projects/${projId}/shares`, { token: ownerSecret, body: { permission } });
const scheduleShare = await makeShare('schedule');
const auditShare = await makeShare('audit');
const fullShare = await makeShare('full_project');
const scheduleToken = scheduleShare.json?.secret, auditToken = auditShare.json?.secret, fullToken = fullShare.json?.secret;

const scheduleView = await call('GET', `/api/v1/shares/${scheduleShare.json?.shareId}/snapshot`, { token: scheduleToken });
{
  const snap = scheduleView.json?.snapshot;
  const sectionsMinimal = Array.isArray(snap?.sections) && snap.sections.length === project.sections.length
    && snap.sections.every((s: any) => JSON.stringify(Object.keys(s).sort()) === JSON.stringify(['courseCode', 'id', 'sectionNumber']));
  const eventsStripped = Array.isArray(snap?.events) && snap.events.length === project.events.length && snap.events.every((e: any) => Array.isArray(e.proctorAssignments) && e.proctorAssignments.length === 0);
  record({
    id: 'share-schedule-scope',
    check: 'schedule-scope share strips roster, proctors, sources and import issues, and hides projectId',
    expected: 'projectId null, proctors [], importIssues [], no artifacts key, proctorAssignments cleared, minimal sections',
    observed: `projectId ${scheduleView.json?.projectId}, proctors ${snap?.proctors?.length ?? 'n/a'}, importIssues ${snap?.importIssues?.length ?? 'n/a'}, artifacts ${snap && 'artifacts' in snap ? 'present' : 'absent'}, proctorAssignments cleared ${eventsStripped}, sections minimal ${sectionsMinimal}`,
    pass: scheduleView.status === 200 && scheduleView.json?.projectId === null && Array.isArray(snap?.proctors) && snap.proctors.length === 0
      && Array.isArray(snap?.importIssues) && snap.importIssues.length === 0 && snap && !('artifacts' in snap) && eventsStripped && sectionsMinimal,
  });
}

const auditView = await call('GET', `/api/v1/shares/${auditShare.json?.shareId}/snapshot`, { token: auditToken });
const auditDetail = await call('GET', `/api/v1/shares/${auditShare.json?.shareId}/audit`, { token: auditToken });
{
  const snap = auditView.json?.snapshot;
  const provenance = Array.isArray(snap?.sections) && snap.sections.every((s: any) => JSON.stringify(Object.keys(s.sourceRef ?? {}).sort()) === JSON.stringify(['artifactId']));
  record({
    id: 'share-audit-scope',
    check: 'audit-scope share preserves artifacts and provenance, and reaches the audit bundle',
    expected: 'projectId null, artifacts preserved, sourceRef reduced to artifactId, audit endpoint 200',
    observed: `projectId ${auditView.json?.projectId}, artifacts ${snap?.artifacts?.length ?? 'n/a'}/${project.artifacts.length}, sourceRef artifactId-only ${provenance}, audit detail ${auditDetail.status}`,
    pass: auditView.status === 200 && auditView.json?.projectId === null && snap?.artifacts?.length === project.artifacts.length && !!provenance && auditDetail.status === 200,
  });
}

const fullView = await call('GET', `/api/v1/shares/${fullShare.json?.shareId}/snapshot`, { token: fullToken });
record({
  id: 'share-full-scope',
  check: 'full_project share returns the complete project and reveals its own projectId',
  expected: `projectId ${projId}, snapshot canonically identical (stored at sha256 ${snapshotHash.slice(0, 12)})`,
  observed: `projectId ${fullView.json?.projectId}, canonical match ${stableStringify(fullView.json?.snapshot) === stableStringify(project)}`,
  pass: fullView.status === 200 && fullView.json?.projectId === projId && stableStringify(fullView.json?.snapshot) === stableStringify(project),
});

// Scoped viewers must be unable to escalate: the 2026-09-05 audit fixed exactly this path.
{
  const mint = await call('POST', `/api/v1/projects/${projId}/shares`, { token: scheduleToken, body: { permission: 'edit' } });
  const auditDenied = await call('GET', `/api/v1/shares/${scheduleShare.json?.shareId}/audit`, { token: scheduleToken });
  const sourceDenied = await call('GET', `/api/v1/shares/${scheduleShare.json?.shareId}/sources/${sourceHash}`, { token: scheduleToken });
  record({
    id: 'scoped-boundaries',
    check: 'a read-only share holder cannot mint shares, read audits or download sources',
    expected: 'mint 403 FORBIDDEN, audit 403, sources 403',
    observed: `mint ${mint.status} ${mint.json?.error}, audit ${auditDenied.status} ${auditDenied.json?.error}, sources ${sourceDenied.status} ${sourceDenied.json?.error}`,
    pass: mint.status === 403 && mint.json?.error === 'FORBIDDEN' && auditDenied.status === 403 && auditDenied.json?.error === 'FORBIDDEN' && sourceDenied.status === 403 && sourceDenied.json?.error === 'FORBIDDEN',
  });
}

// R2 round-trip: source bytes stored content-addressed at creation time come back identical.
{
  const r = await call('GET', `/api/v1/shares/${fullShare.json?.shareId}/sources/${sourceHash}`, { token: fullToken });
  const bytesEqual = r.bytes.length === sourceBytes.length && r.bytes.every((b, i) => b === sourceBytes[i]);
  record({
    id: 'source-roundtrip',
    check: 'an uploaded source artifact round-trips byte-identically through the full_project share',
    expected: `200, bytes identical to the uploaded artifact (sha256 ${sourceHash.slice(0, 12)})`,
    observed: `${r.status}, ${r.bytes.length} bytes, ${bytesEqual ? 'bytes identical' : 'bytes differ'}`,
    pass: r.status === 200 && bytesEqual,
  });
}

// Revocation must take effect immediately for the revoked share only.
{
  const del = await call('DELETE', `/api/v1/projects/${projId}/shares/${scheduleShare.json?.shareId}`, { token: ownerSecret });
  const after = await call('GET', `/api/v1/shares/${scheduleShare.json?.shareId}/snapshot`, { token: scheduleToken });
  const auditStillWorks = await call('GET', `/api/v1/shares/${auditShare.json?.shareId}/snapshot`, { token: auditToken });
  record({
    id: 'share-revocation',
    check: 'a revoked share is refused immediately while sibling shares keep working',
    expected: 'DELETE 200, revoked share then 401 UNAUTHORIZED, sibling share still 200',
    observed: `DELETE ${del.status} ${del.json?.revoked ?? ''}, revoked share ${after.status} ${after.json?.error}, sibling ${auditStillWorks.status}`,
    pass: del.status === 200 && del.json?.revoked === true && after.status === 401 && after.json?.error === 'UNAUTHORIZED' && auditStillWorks.status === 200,
  });
}

// Unknown id vs bad secret must be indistinguishable: same status, same body (plan §62).
{
  const unknown = await call('GET', '/api/v1/shares/shr_0000000000000ff000000000/snapshot');
  const wrong = await call('GET', `/api/v1/shares/${auditShare.json?.shareId}/snapshot`, { token: 'f'.repeat(64) });
  const putUnknown = await call('PUT', '/api/v1/projects/proj_000000000000000000000000/revisions', { token: 'f'.repeat(64), body: { baseRevisionId: 'rev_000000000000', snapshot: minimalSnapshot, sources: [] } });
  const putKnown = await call('PUT', `/api/v1/projects/${projId}/revisions`, { token: 'f'.repeat(64), body: { baseRevisionId: rev2.json.revisionId, snapshot: minimalSnapshot, sources: [] } });
  const gets401Identical = unknown.status === 401 && wrong.status === 401 && unknown.text === wrong.text;
  const puts403Identical = putUnknown.status === 403 && putKnown.status === 403 && putUnknown.text === putKnown.text;
  record({
    id: 'auth-indistinguishable',
    check: 'unauthorized reads of unknown vs known ids, and writes to unknown vs known projects, return identical bodies',
    expected: 'identical 401 body for unknown id and wrong secret; identical 403 body for unknown and known project',
    observed: `401 bodies equal ${gets401Identical} (${unknown.status}/${wrong.status}), 403 bodies equal ${puts403Identical} (${putUnknown.status}/${putKnown.status})`,
    pass: gets401Identical && puts403Identical,
  });
}

// Input caps: source count rejected with 413 before anything reaches storage; name truncated.
{
  const over = await call('POST', '/api/v1/projects', { body: { name: 'cloud-validation-caps', snapshot: minimalSnapshot, sources: Array.from({ length: 21 }, (_, i) => ({ name: `s${i}.txt`, bytes: [1] })) } });
  const named = await call('POST', '/api/v1/projects', { body: { name: 'n'.repeat(250), snapshot: minimalSnapshot, sources: [] } });
  const namedShare = await call('POST', `/api/v1/projects/${named.json?.projectId}/shares`, { token: named.json?.ownerSecret, body: { permission: 'full_project' } });
  const namedView = await call('GET', `/api/v1/shares/${namedShare.json?.shareId}/snapshot`, { token: namedShare.json?.secret });
  record({
    id: 'input-caps',
    check: 'over-limit inputs are contained: more than 20 sources rejected, names longer than 200 characters truncated',
    expected: '21 sources 413 PAYLOAD_TOO_LARGE, 250-char name stored at exactly 200 characters',
    observed: `21 sources ${over.status} ${over.json?.error}, 250-char name stored at ${String(namedView.json?.projectName ?? '').length} chars`,
    pass: over.status === 413 && over.json?.error === 'PAYLOAD_TOO_LARGE' && namedView.json?.projectName?.length === 200,
  });
}

// Rate limit: the deployed RATE_LIMITER binding is the only cross-isolate enforcement,
// so this is the one check that can never be established locally (the fallback limiter
// is per isolate). Cloudflare documents the binding as permissive and eventually
// consistent: concurrent in-flight requests check locally cached counters, so a short
// burst overshoots before the location-wide count catches up. The probe therefore
// sustains pressure well past the limit and stops once 429s persist.
log('[rate-limit] probing (bounded, up to 260 attempts, stops on sustained 429s)...');
const probeStart = Date.now();
const statusCounts: Record<number, number> = {};
let total429 = 0, first429 = -1, issued = 0;
const MAX_ATTEMPTS = 260, POOL = 10, STOP_AFTER_429 = 30;
const probeWorker = async () => {
  while (issued < MAX_ATTEMPTS && total429 < STOP_AFTER_429) {
    const attempt = ++issued;
    const r = await call('POST', '/api/v1/projects', { body: { name: `ratelimit-probe-${attempt}`, snapshot: minimalSnapshot, sources: [] } });
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    if (r.status === 429) { if (first429 === -1) first429 = attempt; total429++; }
  }
};
await Promise.all(Array.from({ length: POOL }, probeWorker));
const elapsedS = ((Date.now() - probeStart) / 1000).toFixed(1);
record({
  id: 'rate-limit',
  check: 'the deployed write surface answers 429 once the per-minute mutation limit is exceeded',
  expected: 'sustained 429s within the bounded probe window (limit 120 mutations per minute per client; Cloudflare documents the binding as permissive and eventually consistent, so short bursts overshoot)',
  observed: `first 429 at attempt ${first429 > 0 ? first429 : 'none'} of ${issued} in ${elapsedS}s, ${total429} rejections, statuses ${JSON.stringify(statusCounts)}`,
  pass: first429 > 0,
});

// ---- evidence ------------------------------------------------------------------------------
const failed = checks.filter(c => !c.pass);
const payload = {
  recordedAt: new Date().toISOString(),
  baseUrl: `${BASE}/`,
  command: 'node docs/data/cloud-verification.ts',
  environment: {
    openApiVersion: openapi.json?.info?.version,
    deployedAssets, localAssets,
    matchesLocalBuild: assetsEqual,
    cspMetaMatchesLocalBuild: cspEqual,
    snapshotSource: relative(root, resolve(import.meta.dirname, 'results-clean.json')),
    snapshotCanonicalSha256: snapshotHash,
  },
  checks,
  rateLimitProbe: { attempts: issued, first429Attempt: first429 > 0 ? first429 : null, statusCounts, elapsedSeconds: Number(elapsedS) },
  notes: [
    'Project and probe rows created by this run (cloud-validation-*, cloud-validation-caps, the 250-character name row, ratelimit-probe-*) persist in the deployed D1/R2 storage: the API (v1.1.0) has no delete-project endpoint. All payloads are synthetic fixtures from docs/data.',
    'Share and owner secrets are never persisted by this tool; identities above are reduced to 8-hex sha256 prefixes.',
    'docs/checksums.sha256 captures this file after the final report build.',
  ],
};
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
saveRecord({
  id: 'cloud-verification', scenario: 'cloud-verification', kind: 'cloud',
  command: `node ${relative(root, OUT)}`, cwd: root,
  stdout: lines.join('\n'), stderr: '', exitCode: failed.length ? 1 : 0,
  phase: 'cloud-api', issueCodes: {}, resultPath: relative(root, OUT), inspect: null,
  recordedAt: payload.recordedAt,
  notes: `Deployed-cloud contract walk against ${BASE}. Secrets redacted to sha256 prefixes. Rate-limit probe rows persist in production storage.`,
});
console.log(failed.length ? `FAILED: ${failed.map(f => f.id).join(', ')}` : `all ${checks.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
