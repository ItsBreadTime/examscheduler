/** Cloud persistence client (plan §50/§55/§60-64).
 *
 * Thin transport over the Worker API: creating projects, saving immutable
 * revisions with optimistic concurrency, and capability-based shares. The
 * domain model never changes shape here — the snapshot is the canonical
 * Project; the same validator runs everywhere.
 */
import type { Project } from './types.ts';
import type { AuditBundle } from './audit.ts';
import type { ValidationReport } from './types.ts';

export type SharePermission = 'schedule' | 'audit' | 'full_project' | 'edit';

/** The creator receives the project's owner capability: an edit-permission share that is
 * the only credential allowed to save revisions or create/revoke shares. */
export interface CloudRevision { projectId: string; revisionId: string; snapshotHash: string; ownerShareId: string; ownerSecret: string }
export interface CloudShare { shareId: string; secret: string; permission: SharePermission }
/** projectId is only revealed to full_project and edit shares; scoped viewers receive null. */
export interface ShareSnapshotResponse { revisionId: string; projectId: string | null; projectName: string; permission: SharePermission; snapshot: Project }
export interface ShareAuditResponse { revisionId: string; projectId: string | null; snapshotHash: string; audit: AuditBundle; validation: ValidationReport }
export interface SourceUpload { name: string; bytes: Uint8Array }

/** Raised when another revision was saved first; the caller must offer a reload/compare flow, never overwrite (plan §55). */
export class RevisionConflictError extends Error {
  readonly currentRevisionId: string;
  constructor(currentRevisionId: string) {
    super('REVISION_CONFLICT');
    this.name = 'RevisionConflictError';
    this.currentRevisionId = currentRevisionId;
  }
}

const base = (serverUrl: string) => serverUrl.trim().replace(/\/+$/, '');

async function request<T>(serverUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base(serverUrl)}${path}`, init);
  } catch (cause) {
    throw new Error(`Cannot reach the cloud server at ${base(serverUrl)}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  let body: Record<string, unknown> = {};
  try { body = await response.json() as Record<string, unknown>; } catch { /* empty body, e.g. binary responses */ }
  if (!response.ok) {
    if (body.error === 'REVISION_CONFLICT' && typeof body.currentRevisionId === 'string') throw new RevisionConflictError(body.currentRevisionId);
    throw new Error(`${response.status} ${String(body.error ?? response.status)}: ${String(body.message ?? 'request failed')}`);
  }
  return body as T;
}

const sourcesBody = (sources: SourceUpload[]) => sources.map(s => ({ name: s.name, bytes: [...s.bytes] }));

export function createCloudProject(serverUrl: string, name: string, snapshot: Project, sources: SourceUpload[]): Promise<CloudRevision> {
  return request<CloudRevision>(serverUrl, '/api/v1/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, snapshot, sources: sourcesBody(sources) }) });
}

/** Saving requires an edit-permission share secret; the worker rejects unauthenticated writes. */
export function saveCloudRevision(serverUrl: string, projectId: string, baseRevisionId: string, snapshot: Project, sources: SourceUpload[], secret: string): Promise<CloudRevision> {
  return request<CloudRevision>(serverUrl, `/api/v1/projects/${encodeURIComponent(projectId)}/revisions`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` }, body: JSON.stringify({ baseRevisionId, snapshot, sources: sourcesBody(sources) }) });
}

export function fetchShareSnapshot(serverUrl: string, shareId: string, secret: string): Promise<ShareSnapshotResponse> {
  return request<ShareSnapshotResponse>(serverUrl, `/api/v1/shares/${encodeURIComponent(shareId)}/snapshot`, { headers: { authorization: `Bearer ${secret}` } });
}

export interface ShareValidationResponse { revisionId: string; status: ValidationReport['overallStatus']; coverage: ValidationReport['coverage']; issues: ValidationReport['issues'] }
export function fetchShareValidation(serverUrl: string, shareId: string, secret: string): Promise<ShareValidationResponse> {
  return request<ShareValidationResponse>(serverUrl, `/api/v1/shares/${encodeURIComponent(shareId)}/validation`, { headers: { authorization: `Bearer ${secret}` } });
}

export function fetchShareAudit(serverUrl: string, shareId: string, secret: string): Promise<ShareAuditResponse> {
  return request<ShareAuditResponse>(serverUrl, `/api/v1/shares/${encodeURIComponent(shareId)}/audit`, { headers: { authorization: `Bearer ${secret}` } });
}

/** Raw source artifacts are content-addressed by their sha256 and only visible to full_project/edit shares. */
export async function fetchShareSource(serverUrl: string, shareId: string, secret: string, sha256: string): Promise<Uint8Array> {
  const response = await fetch(`${base(serverUrl)}/api/v1/shares/${encodeURIComponent(shareId)}/sources/${sha256}`, { headers: { authorization: `Bearer ${secret}` } });
  if (!response.ok) throw new Error(`${response.status}: Could not download the source artifact ${sha256.slice(0, 12)}…`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Creating and revoking shares requires an edit-permission share secret. */
export function createCloudShare(serverUrl: string, projectId: string, permission: SharePermission, options: { revisionId?: string; expiresAt?: string } = {}, secret: string): Promise<CloudShare> {
  return request<CloudShare>(serverUrl, `/api/v1/projects/${encodeURIComponent(projectId)}/shares`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: JSON.stringify({ permission, revisionId: options.revisionId, expiresAt: options.expiresAt }),
  });
}

export function revokeCloudShare(serverUrl: string, projectId: string, shareId: string, secret: string): Promise<void> {
  return request(serverUrl, `/api/v1/projects/${encodeURIComponent(projectId)}/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE', headers: { authorization: `Bearer ${secret}` } }).then(() => undefined);
}

/** Public share URL: the SPA carries the share id publicly and exchanges the secret capability with the worker (plan §64). */
export const shareLink = (shareId: string, secret: string) => `${location.origin}${location.pathname}#/share/${shareId}/${secret}`;

/** Accepts a pasted share URL, or a bare `shareId/secret` pair. Returns null when the text is not a link. */
export function parseShareRef(text: string): { shareId: string; secret: string } | null {
  const match = text.trim().match(/(?:#\/share\/|^)(shr_[0-9a-f]+)[/:]([0-9a-f]{16,})/);
  return match ? { shareId: match[1], secret: match[2] } : null;
}
