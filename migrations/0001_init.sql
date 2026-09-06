-- Cloudflare D1 migration 0001: exam scheduler project metadata (plan §51).
-- Blobs (revision snapshots, source artifacts) live in R2; this schema
-- stores relationships, revision pointers, share records and token hashes.
-- Keep worker/schema.sql in sync with this file.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  current_revision_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  created_at TEXT NOT NULL,
  parent_revision_id TEXT,
  snapshot_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  parser_version TEXT NOT NULL,
  scheduler_version TEXT NOT NULL,
  validator_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revisions_project ON revisions (project_id);

-- Shares are capability records: D1 stores only the secret hash.
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  revision_id TEXT,
  permission TEXT NOT NULL CHECK (permission IN ('schedule', 'audit', 'full_project', 'edit')),
  secret_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_shares_secret ON shares (secret_hash);
