import type { ProjectMeta, RevisionMeta, ShareRecord, Store } from './store.ts';

/** Minimal structural types so the worker compiles without @cloudflare/workers-types. */
export interface R2BucketLike {
  put(key: string, value: Uint8Array | ArrayBuffer | string): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
}
export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
}

const bytesOf = async (object: { arrayBuffer(): Promise<ArrayBuffer> } | null): Promise<Uint8Array | null> => {
  if (!object) return null;
  return new Uint8Array(await object.arrayBuffer());
};

/**
 * R2 stores content-addressed blobs under projects/<projectId>/revisions/<hash>.json
 * and projects/<projectId>/sources/<hash> (plan §52). D1 stores the relational records.
 */
export function createR2D1Store(r2: R2BucketLike, d1: D1DatabaseLike): Store {
  // Revision blobs are keyed under their project; sources are global by hash.
  // getBlob falls back to the legacy unscoped prefix so pre-existing blobs stay
  // readable across the migration.
  const revisionKey = (projectId: string, hash: string) => `projects/${projectId}/revisions/${hash}.json`;
  const sourceKey = (hash: string) => `projects/sources/${hash}`;
  return {
    putBlob: async (hash, bytes, projectId) => {
      await r2.put(revisionKey(projectId ?? 'unscoped', hash), bytes);
    },
    getBlob: async (hash, projectId) => {
      if (projectId) {
        const scoped = await bytesOf(await r2.get(revisionKey(projectId, hash)));
        if (scoped) return scoped;
      }
      return bytesOf(await r2.get(revisionKey('unscoped', hash)));
    },
    putSource: async (hash, bytes) => { await r2.put(sourceKey(hash), bytes); },
    getSource: async hash => bytesOf(await r2.get(sourceKey(hash))),
    getProject: async id => d1.prepare('SELECT id, name, current_revision_id AS currentRevisionId, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE id = ?').bind(id).first<ProjectMeta>(),
    putProject: async meta => {
      await d1.prepare('INSERT INTO projects (id, name, current_revision_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, current_revision_id = excluded.current_revision_id, updated_at = excluded.updated_at')
        .bind(meta.id, meta.name, meta.currentRevisionId, meta.createdAt, meta.updatedAt).run();
    },
    getRevision: async id => d1.prepare('SELECT id, project_id AS projectId, created_at AS createdAt, parent_revision_id AS parentRevisionId, snapshot_hash AS snapshotHash, schema_version AS schemaVersion, parser_version AS parserVersion, scheduler_version AS schedulerVersion, validator_version AS validatorVersion FROM revisions WHERE id = ?').bind(id).first<RevisionMeta>(),
    putRevision: async meta => {
      await d1.prepare('INSERT INTO revisions (id, project_id, created_at, parent_revision_id, snapshot_hash, schema_version, parser_version, scheduler_version, validator_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(meta.id, meta.projectId, meta.createdAt, meta.parentRevisionId ?? null, meta.snapshotHash, meta.schemaVersion, meta.parserVersion, meta.schedulerVersion, meta.validatorVersion).run();
    },
    getShare: async id => d1.prepare('SELECT id, project_id AS projectId, revision_id AS revisionId, permission, secret_hash AS secretHash, created_at AS createdAt, expires_at AS expiresAt, revoked_at AS revokedAt FROM shares WHERE id = ?').bind(id).first<ShareRecord>(),
    putShare: async record => {
      await d1.prepare('INSERT INTO shares (id, project_id, revision_id, permission, secret_hash, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET revoked_at = excluded.revoked_at, expires_at = excluded.expires_at')
        .bind(record.id, record.projectId, record.revisionId ?? null, record.permission, record.secretHash, record.createdAt, record.expiresAt ?? null, record.revokedAt ?? null).run();
    },
    findShareBySecret: async secretHash => d1.prepare('SELECT id, project_id AS projectId, revision_id AS revisionId, permission, secret_hash AS secretHash, created_at AS createdAt, expires_at AS expiresAt, revoked_at AS revokedAt FROM shares WHERE secret_hash = ?').bind(secretHash).first<ShareRecord>(),
  };
}
