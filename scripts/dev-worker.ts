import { createServer } from 'node:http';
import { handleRequest } from '../worker/index.ts';
import { createMemoryStore } from '../worker/storage/memory.ts';

/**
 * Local stand-in for the deployed Cloudflare worker, for browser development:
 *   node scripts/dev-worker.ts            (default port 8787)
 *   PORT=9000 node scripts/dev-worker.ts
 *
 * Serves the exact same request handler and contract as the deployed worker,
 * backed by the in-memory store from the contract tests. Nothing persists
 * across restarts — it is a development and verification convenience, never
 * production infrastructure (that is `wrangler deploy` with R2+D1 bindings).
 */
const port = Number(process.env.PORT ?? 8787);
const store = createMemoryStore();
let mutations = 0;

const server = createServer((incoming, response) => {
  const chunks: Buffer[] = [];
  incoming.on('data', chunk => chunks.push(chunk));
  incoming.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = new URL(incoming.url ?? '/', `http://127.0.0.1:${port}`);
    void handleRequest(new Request(url, {
      method: incoming.method,
      headers: [...Object.entries(incoming.headers)].filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v as string]) as [string, string][],
      body: ['GET', 'HEAD'].includes(incoming.method ?? 'GET') || body.length === 0 ? undefined : body,
    }), { store })
      .then(outgoing => {
        if (incoming.method !== 'GET' && incoming.method !== 'OPTIONS' && outgoing.status < 400) mutations++;
        response.writeHead(outgoing.status, Object.fromEntries(outgoing.headers));
        if (outgoing.body) void outgoing.arrayBuffer().then(bytes => { response.end(Buffer.from(bytes)); });
        else response.end();
      })
      .catch(error => {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'DEV_SERVER', message: String(error) }));
      });
  });
});

const shutdown = () => {
  console.log(`\ndev worker stopped after ${mutations} mutation(s); memory store discarded.`);
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(port, '127.0.0.1', () => {
  console.log(`Exam scheduler cloud API (in-memory) listening on http://127.0.0.1:${port}`);
  console.log('Data does not survive restarts. Deploy the worker for real storage.');
});
