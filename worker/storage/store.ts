/** Narrow persistence boundary for cloud project storage (plan §50/§51).
 *
 * The worker talks only to this interface. Cloudflare R2+D1 is one
 * implementation, the in-memory store (used by contract tests) is another.
 * Blobs (snapshots, source artifacts) are content-addressed by sha256;
 * metadata (projects, revisions, shares) is relational.
 */
export interface RevisionMeta {
  id: string;
  projectId: string;
  createdAt: string;
  parentRevisionId?: string;
  snapshotHash: string;
  schemaVersion: number;
  parserVersion: string;
  schedulerVersion: string;
  validatorVersion: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  currentRevisionId: string;
  createdAt: string;
  updatedAt: string;
}

export type SharePermission = 'schedule' | 'audit' | 'full_project' | 'edit';

export interface ShareRecord {
  id: string;
  projectId: string;
  /** Pinned revision for snapshot shares; absent for live shares. */
  revisionId?: string;
  permission: SharePermission;
  /** sha256 hex of the bearer secret; the secret itself is never stored. */
  secretHash: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface Store {
  // Blobs, keyed by sha256 hex. R2-backed stores key revision snapshots under the
  // owning project when the caller passes its id; omitting it falls back to the
  // legacy unscoped prefix.
  putBlob(hash: string, bytes: Uint8Array, projectId?: string): Promise<void>;
  getBlob(hash: string, projectId?: string): Promise<Uint8Array | null>;
  // Sources are stored once per content hash and referenced by revision blobs.
  putSource(hash: string, bytes: Uint8Array): Promise<void>;
  getSource(hash: string): Promise<Uint8Array | null>;

  getProject(id: string): Promise<ProjectMeta | null>;
  putProject(meta: ProjectMeta): Promise<void>;

  getRevision(id: string): Promise<RevisionMeta | null>;
  putRevision(meta: RevisionMeta): Promise<void>;

  getShare(id: string): Promise<ShareRecord | null>;
  putShare(record: ShareRecord): Promise<void>;
  /** Find a share by its secret hash (shares are addressed publicly by id + secret). */
  findShareBySecret(secretHash: string): Promise<ShareRecord | null>;
}

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

/** Deterministic JSON: objects serialize with sorted keys so revision hashes are stable. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (value instanceof Uint8Array) return JSON.stringify([...value]);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}
