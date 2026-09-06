import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * One-command cloud setup (plan §50-52): creates the R2 bucket and D1 database,
 * writes the database_id into wrangler.jsonc, applies migrations/0001_init.sql
 * and deploys the worker. Requires a Cloudflare login:
 *   wrangler login            (interactive)
 *   CLOUDFLARE_API_TOKEN=…    (CI)
 *
 * Idempotent: existing resources are detected and reused.
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(root, 'wrangler.jsonc');
const r2Bucket = 'exam-scheduler-blobs';
const d1Name = 'exam-scheduler';

const wrangler = (args: string[], opts: { capture?: boolean } = {}) => {
  const result = spawnSync('npx', ['wrangler', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

const die = (message: string): never => {
  console.error(`✘ ${message}`);
  process.exit(1);
};

// 1. Cloudflare credentials.
const who = wrangler(['whoami'], { capture: true });
if (!who.ok) {
  die('Not logged in to Cloudflare. Run `npx wrangler login` in an interactive terminal, or set CLOUDFLARE_API_TOKEN, then re-run.');
}
const account = who.output.match(/@[\w.-]+/)?.[0] ?? 'your account';
console.log(`✔ Logged in as ${account.trim()}`);

// 2. R2 bucket for content-addressed snapshots and source artifacts.
console.log(`→ Ensuring R2 bucket ${r2Bucket}…`);
const bucket = wrangler(['r2', 'bucket', 'create', r2Bucket], { capture: true });
if (bucket.ok) console.log(`✔ Created R2 bucket ${r2Bucket}`);
else if (/already exists|A bucket with this name/i.test(bucket.output)) console.log(`✔ R2 bucket ${r2Bucket} already exists`);
else die(`Could not create the R2 bucket:\n${bucket.output}`);

// 3. D1 database for project/revision/share metadata; capture its id.
console.log(`→ Ensuring D1 database ${d1Name}…`);
const created = wrangler(['d1', 'create', d1Name], { capture: true });
let databaseId = created.output.match(/database_id\s*=?\s*"([0-9a-f-]{36})"/)?.[1] ?? '';
if (!created.ok && !databaseId) {
  // `d1 info <name>` resolves against wrangler.jsonc, so a PENDING_PROVISION placeholder
  // makes it query the wrong database; list all databases and match by name instead.
  const listing = wrangler(['d1', 'list'], { capture: true });
  databaseId = listing.output.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[^\n]*exam-scheduler/)?.[1] ?? '';
  if (!databaseId) {
    const info = wrangler(['d1', 'info', d1Name, '--json'], { capture: true });
    try {
      databaseId = JSON.parse(info.output).uuid ?? '';
    } catch {
      databaseId = info.output.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)?.[1] ?? '';
    }
    if (info.ok || databaseId) console.log(`✔ D1 database ${d1Name} already exists`);
  } else console.log(`✔ D1 database ${d1Name} already exists`);
}
if (!databaseId) die(`Could not determine the D1 database id. Run \`npx wrangler d1 create ${d1Name}\` and paste database_id into wrangler.jsonc.\n${created.output}`);
console.log(`✔ D1 database id ${databaseId}`);

// 4. Persist the id so `wrangler deploy` finds the binding.
const config = readFileSync(configPath, 'utf8');
writeFileSync(configPath, config.replace('"database_id": "PENDING_PROVISION"', `"database_id": "${databaseId}"`));
console.log('✔ wrangler.jsonc updated');

// 5. Schema, then the worker itself.
console.log('→ Applying D1 migrations…');
if (!wrangler(['d1', 'migrations', 'apply', d1Name, '--remote']).ok) die('D1 migration failed.');
console.log('→ Deploying worker…');
const deploy = wrangler(['deploy'], { capture: true });
if (!deploy.ok) die(`Deploy failed:\n${deploy.output}`);
const url = deploy.output.match(/https:\/\/\S+\.workers\.dev/)?.[0];
console.log(`✔ Deployed${url ? ` to ${url}` : ''}`);
console.log(`\nSet this URL as the cloud server in the app's Save & share view: ${url ?? 'see deploy output above'}`);
