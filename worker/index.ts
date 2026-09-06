import type { Project, ValidationReport } from '../src/lib/types.ts';
import { validateProject } from '../src/lib/validator.ts';
import { auditSchemaVersion, buildAuditBundle, parserVersion, projectSchemaVersion, schedulerVersion, validatorVersion } from '../src/lib/audit.ts';
import { sha256Hex, stableStringify, type SharePermission, type ShareRecord, type Store } from './storage/store.ts';
import { createR2D1Store, type R2BucketLike, type D1DatabaseLike } from './storage/r2d1.ts';

export interface Env {
  store: Store;
  /** Best-effort in-worker mutation limiter used when no RATE_LIMITER binding exists. Omit mutationsPerMinute to disable. */
  rateLimit?: { mutationsPerMinute?: number };
}

/** Cloudflare Workers Rate Limiting binding (wrangler.jsonc unsafe.bindings), optional. */
export interface RateLimiterLike {
  limit(key: { key: string }): Promise<{ success: boolean }>;
}

/** Bindings configured in wrangler.jsonc: R2 holds content-addressed blobs, D1 the relational records. */
export interface WorkerEnv {
  BUCKET?: R2BucketLike;
  DB?: D1DatabaseLike;
  RATE_LIMITER?: RateLimiterLike;
}

// The SPA is served from a different origin than the worker, so every response
// carries CORS headers; capabilities (share secrets) remain the real gate.
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};
const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders, ...securityHeaders, ...headers } });

const error = (status: number, code: string, message: string) => json({ error: code, message }, status);

const isProject = (value: unknown): value is Project => {
  const p = value as Project;
  return !!p && p.schemaVersion === 1 && Array.isArray(p.events) && Array.isArray(p.sections) && !!p.settings;
};

const validPermission = (value: unknown): value is SharePermission =>
  value === 'schedule' || value === 'audit' || value === 'full_project' || value === 'edit';

const revisionId = () => `rev_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
const projectId = () => `proj_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
const shareId = () => `shr_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

// Abuse limits: the write surface is rate-limited and every stored payload is capped,
// so anonymous clients cannot fill R2/D1 with a single request.
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_SOURCES = 20;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 24 * 1024 * 1024;
const MAX_NAME_LENGTH = 200;
const DEFAULT_MUTATIONS_PER_MINUTE = 120;

async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; status: number; code: string; message: string }> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE', message: `Request bodies are limited to ${MAX_BODY_BYTES} bytes.` };
  }
  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return { ok: false, status: 400, code: 'INVALID_BODY', message: 'Request body could not be read.' };
  }
  if (bytes.byteLength > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE', message: `Request bodies are limited to ${MAX_BODY_BYTES} bytes.` };
  }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, status: 400, code: 'INVALID_SNAPSHOT', message: 'Request body must be JSON.' };
  }
}

/** Sources arrive as JSON byte arrays; enforce count and size caps before anything reaches R2. */
const sourceUploadError = (sources: unknown): string | null => {
  if (sources === undefined) return null;
  if (!Array.isArray(sources)) return 'Body.sources must be an array of { name, bytes }.';
  if (sources.length > MAX_SOURCES) return `At most ${MAX_SOURCES} source files per request.`;
  let total = 0;
  for (const source of sources) {
    const entry = source as { name?: unknown; bytes?: unknown };
    if (typeof entry?.name !== 'string' || !entry.name || !Array.isArray(entry.bytes) || entry.bytes.some(b => typeof b !== 'number' || b < 0 || b > 255)) {
      return 'Each source must carry a name and a byte array.';
    }
    total += entry.bytes.length;
    if (entry.bytes.length > MAX_SOURCE_BYTES) return `Each source file is limited to ${MAX_SOURCE_BYTES} bytes.`;
    if (total > MAX_TOTAL_SOURCE_BYTES) return `Source files are limited to ${MAX_TOTAL_SOURCE_BYTES} bytes per request.`;
  }
  return null;
};

// In-memory fallback limiter (per isolate, best effort). The deployed worker
// prefers the RATE_LIMITER binding, which is accurate across isolates.
const mutationWindows = new Map<string, { bucket: number; count: number }>();
async function allowMutation(request: Request, env: Env & { RATE_LIMITER?: RateLimiterLike }): Promise<boolean> {
  const client = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (env.RATE_LIMITER) {
    try {
      return (await env.RATE_LIMITER.limit({ key: client })).success;
    } catch { /* binding unavailable: fall through to the in-memory limiter */ }
  }
  const limit = env.rateLimit?.mutationsPerMinute ?? DEFAULT_MUTATIONS_PER_MINUTE;
  if (!Number.isFinite(limit) || limit <= 0) return true;
  const minute = Math.floor(Date.now() / 60000);
  const entry = mutationWindows.get(client);
  if (!entry || entry.bucket !== minute) {
    if (mutationWindows.size > 10000) for (const [key, value] of mutationWindows) if (value.bucket !== minute) mutationWindows.delete(key);
    mutationWindows.set(client, { bucket: minute, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

/** A share grants access only while it is neither revoked nor expired. */
function isUsableShare(record: ShareRecord): boolean {
  if (record.revokedAt) return false;
  if (record.expiresAt && record.expiresAt < new Date().toISOString()) return false;
  return true;
}

/** Constant-time comparison so response timing never narrows the stored hash. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function bearerSecret(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

async function authorizedShare(store: Store, shareIdValue: string, request: Request) {
  const secret = await bearerSecret(request);
  if (!secret) return null;
  const secretHash = await sha256Hex(new TextEncoder().encode(secret));
  const record = await store.getShare(shareIdValue);
  if (!record || !timingSafeEqual(record.secretHash, secretHash) || !isUsableShare(record)) return null;
  return record;
}

/** Management capability: saving revisions, minting shares and revoking shares require an unexpired
 * edit-permission share for that exact project. full_project stays a read-only full copy. */
async function editCapability(store: Store, projectIdValue: string, request: Request): Promise<ShareRecord | null> {
  const secret = await bearerSecret(request);
  if (!secret) return null;
  const secretHash = await sha256Hex(new TextEncoder().encode(secret));
  const record = await store.findShareBySecret(secretHash);
  if (!record || record.projectId !== projectIdValue || record.permission !== 'edit' || !isUsableShare(record)) return null;
  return record;
}

async function readSnapshot(store: Store, hash: string, projectId?: string): Promise<Project | null> {
  const bytes = await store.getBlob(hash, projectId);
  if (!bytes) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isProject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Validation response: hashes, versions, coverage and structured issues (plan §47). */
export function validationResponse(validation: ValidationReport, scheduleHash: string, revisionId?: string) {
  const errors = validation.issues.filter(i => i.severity === 'error').length;
  const warnings = validation.issues.filter(i => i.severity === 'warning').length;
  return {
    schemaVersion: auditSchemaVersion,
    validatorVersion,
    revisionId,
    scheduleHash: `sha256:${scheduleHash}`,
    status: validation.overallStatus,
    summary: { errors, warnings, unscheduledEvents: validation.issues.filter(i => i.type === 'UNSCHEDULED_REQUIRED_EXAM').length },
    coverage: validation.coverage,
    issues: validation.issues,
  };
}

/** Share scopes (plan §61): schedule views hide sources and the roster, audit adds provenance, full_project includes everything.
 * Proctor ids embed the proctor name (`proctor:<name>`), so schedule scope must strip them from events, not just the roster. */
export function scopeSnapshot(project: Project, permission: SharePermission): unknown {
  if (permission === 'full_project' || permission === 'edit') return project;
  const { artifacts: _artifacts, sections, events, ...rest } = project;
  void _artifacts;
  void events;
  const shapedSections = sections.map(s => ({ ...s, sourceRef: { artifactId: s.sourceRef.artifactId } }));
  if (permission === 'audit') return { ...rest, sections: shapedSections, events, artifacts: project.artifacts.map(a => ({ ...a })) };
  // schedule: assignments only, no roster detail, no import issues.
  return {
    ...rest,
    events: events.map(e => ({ ...e, proctorAssignments: [] })),
    sections: shapedSections.map(s => ({ id: s.id, courseCode: s.courseCode, sectionNumber: s.sectionNumber })),
    proctors: [],
    importIssues: [],
  };
}

export async function handleRequest(request: Request, env: Env & { RATE_LIMITER?: RateLimiterLike }): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const { store } = env;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method === 'GET' && pathname === '/') return json({ service: 'exam-scheduler', status: 'ok', api: '/api/v1', docs: '/openapi.json' });
  if (request.method === 'GET' && pathname === '/openapi.json') return json(openapiDocument());

  if (request.method === 'POST' && pathname === '/api/v1/validate') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(parsed.status, parsed.code, parsed.message);
    if (!isProject(parsed.body)) return error(400, 'INVALID_SNAPSHOT', 'Body must be a canonical project snapshot (schemaVersion 1).');
    const validation = validateProject(parsed.body);
    const bundle = await buildAuditBundle(parsed.body, validation);
    return json(validationResponse(validation, bundle.scheduleHash));
  }

  if (request.method === 'POST' && pathname === '/api/v1/projects') {
    if (!(await allowMutation(request, env))) return error(429, 'RATE_LIMITED', 'Too many requests; slow down and retry shortly.');
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(parsed.status, parsed.code, parsed.message);
    const body = parsed.body as { name?: unknown; snapshot?: unknown; sources?: unknown };
    if (!isProject(body.snapshot)) return error(400, 'INVALID_SNAPSHOT', 'Body.snapshot must be a canonical project snapshot.');
    const sourceError = sourceUploadError(body.sources);
    if (sourceError) return error(413, 'PAYLOAD_TOO_LARGE', sourceError);
    const now = new Date().toISOString();
    const id = projectId();
    const bytes = new TextEncoder().encode(stableStringify(body.snapshot));
    const hash = await sha256Hex(bytes);
    const rev = revisionId();
    await store.putBlob(hash, bytes, id);
    for (const source of (body.sources ?? []) as { name: string; bytes: number[] }[]) {
      const sourceBytes = new Uint8Array(source.bytes);
      await store.putSource(await sha256Hex(sourceBytes), sourceBytes);
    }
    // The project row must exist before the revision row: revisions.project_id references it.
    const name = typeof body.name === 'string' && body.name ? body.name.slice(0, MAX_NAME_LENGTH) : 'Untitled project';
    await store.putProject({ id, name, currentRevisionId: rev, createdAt: now, updatedAt: now });
    await store.putRevision({ id: rev, projectId: id, createdAt: now, snapshotHash: hash, schemaVersion: projectSchemaVersion, parserVersion, schedulerVersion, validatorVersion });
    // Bootstrap capability: the creator receives the project's only edit share, which is the
    // sole credential for saving revisions and managing shares. Only its hash is stored.
    const ownerSecret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const ownerShareId = shareId();
    await store.putShare({
      id: ownerShareId, projectId: id, permission: 'edit', secretHash: await sha256Hex(new TextEncoder().encode(ownerSecret)),
      createdAt: now,
    });
    return json({ projectId: id, revisionId: rev, snapshotHash: `sha256:${hash}`, ownerShareId, ownerSecret }, 201);
  }

  const revisionMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/revisions$/);
  if (request.method === 'PUT' && revisionMatch) {
    if (!(await allowMutation(request, env))) return error(429, 'RATE_LIMITED', 'Too many requests; slow down and retry shortly.');
    const id = decodeURIComponent(revisionMatch[1]);
    // Only an edit share for this project may add revisions; probe auth before existence
    // so unknown and known projects are indistinguishable to outsiders.
    const capability = await editCapability(store, id, request);
    if (!capability) {
      return (await bearerSecret(request))
        ? error(403, 'FORBIDDEN', 'Saving revisions requires an edit-permission share for this project.')
        : error(401, 'UNAUTHORIZED', 'A valid Bearer share secret with edit permission is required.');
    }
    const meta = await store.getProject(id);
    if (!meta) return error(404, 'NOT_FOUND', 'Unknown project.');
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(parsed.status, parsed.code, parsed.message);
    const body = parsed.body as { baseRevisionId?: unknown; snapshot?: unknown; sources?: unknown };
    if (typeof body.baseRevisionId !== 'string') return error(400, 'INVALID_BASE', 'Body.baseRevisionId is required.');
    if (!isProject(body.snapshot)) return error(400, 'INVALID_SNAPSHOT', 'Body.snapshot must be a canonical project snapshot.');
    const sourceError = sourceUploadError(body.sources);
    if (sourceError) return error(413, 'PAYLOAD_TOO_LARGE', sourceError);
    // Optimistic concurrency: a stale base never overwrites newer work (plan §55).
    if (body.baseRevisionId !== meta.currentRevisionId) {
      return json({ error: 'REVISION_CONFLICT', message: 'Another revision was saved first. Reload and compare before saving.', currentRevisionId: meta.currentRevisionId }, 409);
    }
    const now = new Date().toISOString();
    const bytes = new TextEncoder().encode(stableStringify(body.snapshot));
    const hash = await sha256Hex(bytes);
    const rev = revisionId();
    await store.putBlob(hash, bytes, id);
    for (const source of (body.sources ?? []) as { name: string; bytes: number[] }[]) {
      const sourceBytes = new Uint8Array(source.bytes);
      await store.putSource(await sha256Hex(sourceBytes), sourceBytes);
    }
    await store.putRevision({ id: rev, projectId: id, createdAt: now, parentRevisionId: body.baseRevisionId, snapshotHash: hash, schemaVersion: projectSchemaVersion, parserVersion, schedulerVersion, validatorVersion });
    await store.putProject({ ...meta, currentRevisionId: rev, updatedAt: now });
    return json({ projectId: id, revisionId: rev, snapshotHash: `sha256:${hash}` });
  }

  const shareCreateMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/shares$/);
  if (request.method === 'POST' && shareCreateMatch) {
    if (!(await allowMutation(request, env))) return error(429, 'RATE_LIMITED', 'Too many requests; slow down and retry shortly.');
    const id = decodeURIComponent(shareCreateMatch[1]);
    const capability = await editCapability(store, id, request);
    if (!capability) {
      return (await bearerSecret(request))
        ? error(403, 'FORBIDDEN', 'Creating shares requires an edit-permission share for this project.')
        : error(401, 'UNAUTHORIZED', 'A valid Bearer share secret with edit permission is required.');
    }
    const meta = await store.getProject(id);
    if (!meta) return error(404, 'NOT_FOUND', 'Unknown project.');
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return error(parsed.status, parsed.code, parsed.message);
    const body = parsed.body as { permission?: unknown; revisionId?: unknown; expiresAt?: unknown };
    if (!validPermission(body.permission)) return error(400, 'INVALID_SHARE', 'Body.permission must be schedule, audit, full_project or edit.');
    if (body.revisionId !== undefined && typeof body.revisionId !== 'string') return error(400, 'INVALID_SHARE', 'Body.revisionId must be a revision id.');
    if (body.expiresAt !== undefined && (typeof body.expiresAt !== 'string' || Number.isNaN(Date.parse(body.expiresAt)))) {
      return error(400, 'INVALID_SHARE', 'Body.expiresAt must be an ISO date.');
    }
    const secret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const recordId = shareId();
    await store.putShare({
      id: recordId, projectId: id, revisionId: typeof body.revisionId === 'string' ? body.revisionId : undefined,
      permission: body.permission, secretHash: await sha256Hex(new TextEncoder().encode(secret)),
      createdAt: new Date().toISOString(), expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : undefined,
    });
    return json({ shareId: recordId, secret, permission: body.permission }, 201);
  }

  const shareDeleteMatch = pathname.match(/^\/api\/v1\/projects\/([^/]+)\/shares\/([^/]+)$/);
  if (request.method === 'DELETE' && shareDeleteMatch) {
    if (!(await allowMutation(request, env))) return error(429, 'RATE_LIMITED', 'Too many requests; slow down and retry shortly.');
    const id = decodeURIComponent(shareDeleteMatch[1]);
    const capability = await editCapability(store, id, request);
    if (!capability) {
      return (await bearerSecret(request))
        ? error(403, 'FORBIDDEN', 'Revoking shares requires an edit-permission share for this project.')
        : error(401, 'UNAUTHORIZED', 'A valid Bearer share secret with edit permission is required.');
    }
    const record = await store.getShare(decodeURIComponent(shareDeleteMatch[2]));
    if (!record || record.projectId !== id) return error(404, 'NOT_FOUND', 'Unknown share.');
    await store.putShare({ ...record, revokedAt: new Date().toISOString() });
    return json({ revoked: true });
  }

  const shareGetMatch = pathname.match(/^\/api\/v1\/shares\/([^/]+)\/(snapshot|validation|audit)$/);
  if (request.method === 'GET' && shareGetMatch) {
    const record = await authorizedShare(store, decodeURIComponent(shareGetMatch[1]), request);
    if (!record) return error(401, 'UNAUTHORIZED', 'A valid Bearer share secret is required.');
    const kind = shareGetMatch[2];
    const meta = await store.getProject(record.projectId);
    if (!meta) return error(404, 'NOT_FOUND', 'Unknown project.');
    const revision = record.revisionId ? await store.getRevision(record.revisionId) : await store.getRevision(meta.currentRevisionId);
    if (!revision) return error(404, 'NOT_FOUND', 'Unknown revision.');
    const snapshot = await readSnapshot(store, revision.snapshotHash, record.projectId);
    if (!snapshot) return error(404, 'NOT_FOUND', 'Revision blob is missing.');
    // Scoped viewers must never learn the projectId: it is the write-surface handle, and
    // leaking it to read-only shares would invite management attempts against the project.
    const visibleProjectId = record.permission === 'full_project' || record.permission === 'edit' ? record.projectId : null;
    if (kind === 'snapshot') return json({ revisionId: revision.id, projectId: visibleProjectId, projectName: meta.name, permission: record.permission, snapshot: scopeSnapshot(snapshot, record.permission) });
    const validation = validateProject(snapshot);
    if (kind === 'validation') return json(validationResponse(validation, (await buildAuditBundle(snapshot, validation)).scheduleHash, revision.id));
    if (record.permission !== 'audit' && record.permission !== 'full_project' && record.permission !== 'edit') {
      return error(403, 'FORBIDDEN', 'This share does not include audit detail.');
    }
    const bundle = await buildAuditBundle(snapshot, validation);
    return json({ revisionId: revision.id, projectId: visibleProjectId, snapshotHash: `sha256:${bundle.scheduleHash}`, audit: bundle, validation });
  }

  // Raw source artifacts stay private to full-project and edit shares (plan §61); content is addressed by sha256.
  const shareSourceMatch = pathname.match(/^\/api\/v1\/shares\/([^/]+)\/sources\/([0-9a-f]{64})$/);
  if (request.method === 'GET' && shareSourceMatch) {
    const record = await authorizedShare(store, decodeURIComponent(shareSourceMatch[1]), request);
    if (!record) return error(401, 'UNAUTHORIZED', 'A valid Bearer share secret is required.');
    if (record.permission !== 'full_project' && record.permission !== 'edit') return error(403, 'FORBIDDEN', 'This share does not include raw source files.');
    const bytes = await store.getSource(shareSourceMatch[2]);
    if (!bytes) return error(404, 'NOT_FOUND', 'Unknown source artifact.');
    return new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment', ...corsHeaders, ...securityHeaders } });
  }

  return error(404, 'NOT_FOUND', 'Unknown route.');
}

/** Cloudflare Workers entry point: assembles the R2+D1 store from the wrangler.jsonc bindings. */
export default {
  fetch(request: Request, env: WorkerEnv & Partial<Env>): Response | Promise<Response> {
    if (env.store) return handleRequest(request, env as Env & { RATE_LIMITER?: RateLimiterLike });
    if (!env.BUCKET || !env.DB) {
      return error(500, 'MISCONFIGURED', 'The worker needs the BUCKET (R2) and DB (D1) bindings; run scripts/provision-cloud.ts to create them.');
    }
    return handleRequest(request, { store: createR2D1Store(env.BUCKET, env.DB), RATE_LIMITER: env.RATE_LIMITER });
  },
};

export function openapiDocument() {
  const bearer = [{ bearerAuth: [] }];
  return {
    openapi: '3.1.0',
    info: { title: 'Exam Scheduler Audit API', version: '1.1.0' },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Share secret. Management routes (save revisions, create/revoke shares) require a share with edit permission for the project.' } },
    },
    paths: {
      '/api/v1/validate': {
        post: {
          operationId: 'validateProject',
          summary: 'Validate a canonical project snapshot without saving it.',
          requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { '200': { description: 'Validation report with hashes, versions, coverage and issues.' }, '413': { description: 'Body exceeds the size limit.' } },
        },
      },
      '/api/v1/projects': {
        post: {
          operationId: 'createProject',
          summary: 'Create a project and its first immutable revision.',
          responses: { '201': { description: 'Project and revision ids.' }, '413': { description: 'Snapshot or sources exceed the size limits.' }, '429': { description: 'Rate limited.' } },
        },
      },
      '/api/v1/projects/{id}/revisions': {
        put: {
          operationId: 'saveRevision',
          summary: 'Save a revision; requires an edit-permission share. A stale base returns 409 REVISION_CONFLICT.',
          security: bearer,
          responses: { '200': { description: 'New revision.' }, '401': { description: 'Missing share secret.' }, '403': { description: 'Share lacks edit permission.' }, '409': { description: 'Revision conflict.' } },
        },
      },
      '/api/v1/projects/{id}/shares': {
        post: {
          operationId: 'createShare',
          summary: 'Create a share link; requires an edit-permission share.',
          security: bearer,
          responses: { '201': { description: 'Share id, secret and permission.' }, '401': { description: 'Missing share secret.' }, '403': { description: 'Share lacks edit permission.' } },
        },
      },
      '/api/v1/projects/{id}/shares/{shareId}': {
        delete: {
          operationId: 'revokeShare',
          summary: 'Revoke a share; requires an edit-permission share.',
          security: bearer,
          responses: { '200': { description: 'Share revoked.' }, '401': { description: 'Missing share secret.' }, '403': { description: 'Share lacks edit permission.' } },
        },
      },
      '/api/v1/shares/{shareId}/snapshot': {
        get: {
          operationId: 'getProjectSnapshot',
          summary: 'Fetch the shared snapshot scoped by the share permission. projectId is only revealed to full_project and edit shares.',
          security: bearer,
          responses: { '200': { description: 'Scoped snapshot.' }, '401': { description: 'Missing or invalid share secret.' } },
        },
      },
      '/api/v1/shares/{shareId}/validation': {
        get: {
          operationId: 'getValidationReport',
          summary: 'Re-run validation for the shared revision.',
          security: bearer,
          responses: { '200': { description: 'Validation report.' }, '401': { description: 'Missing or invalid share secret.' } },
        },
      },
      '/api/v1/shares/{shareId}/audit': {
        get: {
          operationId: 'getAuditBundle',
          summary: 'Fetch the audit bundle for the shared revision.',
          security: bearer,
          responses: { '200': { description: 'Audit bundle.' }, '401': { description: 'Missing or invalid share secret.' }, '403': { description: 'Share does not include audit detail.' } },
        },
      },
      '/api/v1/shares/{shareId}/sources/{sha256}': {
        get: {
          operationId: 'getSourceArtifact',
          summary: 'Download a raw source artifact by content hash; full_project and edit shares only.',
          security: bearer,
          responses: { '200': { description: 'Raw source bytes.' }, '401': { description: 'Missing or invalid share secret.' }, '403': { description: 'Share does not include raw sources.' } },
        },
      },
    },
  };
}
