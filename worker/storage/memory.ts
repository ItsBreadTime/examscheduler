import type { ProjectMeta, RevisionMeta, ShareRecord, Store } from './store.ts';

/** In-memory Store for contract tests: same revision/share semantics as D1+R2, no network. */
export function createMemoryStore(): Store {
  const blobs = new Map<string, Uint8Array>();
  const sources = new Map<string, Uint8Array>();
  const projects = new Map<string, ProjectMeta>();
  const revisions = new Map<string, RevisionMeta>();
  const shares = new Map<string, ShareRecord>();
  const copy = (bytes: Uint8Array) => new Uint8Array(bytes);
  return {
    putBlob: async (hash, bytes) => { blobs.set(hash, copy(bytes)); },
    getBlob: async hash => { const found = blobs.get(hash); return found ? copy(found) : null; },
    putSource: async (hash, bytes) => { sources.set(hash, copy(bytes)); },
    getSource: async hash => { const found = sources.get(hash); return found ? copy(found) : null; },
    getProject: async id => projects.get(id) ?? null,
    putProject: async meta => { projects.set(meta.id, { ...meta }); },
    getRevision: async id => revisions.get(id) ?? null,
    putRevision: async meta => { revisions.set(meta.id, { ...meta }); },
    getShare: async id => shares.get(id) ?? null,
    putShare: async record => { shares.set(record.id, { ...record }); },
    findShareBySecret: async secretHash => {
      for (const record of shares.values()) if (record.secretHash === secretHash) return { ...record };
      return null;
    },
  };
}
