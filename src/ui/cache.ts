import type { Project } from '../lib/types.ts';
import type { SharePermission } from '../lib/api.ts';
import type { ScheduleResult } from './jobs.ts';

const databaseName = 'exam-scheduler';
const storeName = 'projects';
const version = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, version);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    database =>
      new Promise<T>((resolve, reject) => {
        const tx = database.transaction(storeName, mode);
        const request = work(tx.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
        tx.oncomplete = () => database.close();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB unavailable'));
      }),
  );
}

/** Local project cache (plan §57): large state plus raw source blobs survive reloads and cloud outages. */
export interface CachedSource { name: string; kind: 'course' | 'rules' | 'rooms' | 'proctors'; role?: string; bytes: number[] }

/** Everything a browser needs to keep saving: the project, the owner capability, and the revision it sits on. */
export interface CloudConnection {
  projectId: string;
  name: string;
  ownerShareId: string;
  ownerSecret: string;
  revisionId: string;
  savedAt?: string;
}

/** Shares this browser created, so their links can be copied again and revoked (the API has no list-shares route). */
export interface ShareLinkInfo {
  shareId: string;
  secret: string;
  permission: SharePermission;
  /** Pinned revision for snapshot shares; absent for live shares. */
  revisionId?: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface CachedProject {
  key: string;
  updatedAt: string;
  project: Project;
  sources: CachedSource[];
  /** The generated schedule this browser last held, so a reload replays the full state, not just the import. */
  result?: ScheduleResult | null;
  cloud?: CloudConnection | null;
  shares?: ShareLinkInfo[];
}

export const cacheProject = (entry: CachedProject): Promise<void> =>
  transaction('readwrite', store => store.put(entry, entry.key)).then(() => undefined);

export const loadCachedProject = (key: string): Promise<CachedProject | null> =>
  transaction('readonly', store => store.get(key)).then(value => (value as CachedProject | undefined) ?? null);

export const listCachedProjects = (): Promise<{ key: string; updatedAt: string }[]> =>
  transaction('readonly', store => store.getAll()).then(entries =>
    ((entries as CachedProject[] | undefined) ?? []).map(e => ({ key: e.key, updatedAt: e.updatedAt })),
  );

export const clearCachedProject = (key: string): Promise<void> =>
  transaction('readwrite', store => store.delete(key)).then(() => undefined);
