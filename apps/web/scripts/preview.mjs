// `pnpm --filter @sa/web start`: preview the static export the way production serves it.
// Serves apps/web/out and proxies /api/* (including SSE, unbuffered) to the API, like the nginx in front of prod.
// Zero dependencies. Env: PORT (3000), API_PROXY_TARGET (http://localhost:8080).
import { createReadStream, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out');
const port = Number(process.env.PORT ?? 3000);
const target = new URL(process.env.API_PROXY_TARGET ?? 'http://localhost:8080');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function fileFor(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath.split('?')[0] ?? '/')).replace(/^(\.\.[/\\])+/, '');
  for (const candidate of [clean, `${clean}.html`, path.join(clean, 'index.html')]) {
    const abs = path.join(root, candidate);
    if (!abs.startsWith(root)) return null;
    try {
      if (statSync(abs).isFile()) return abs;
    } catch {
      /* try next */
    }
  }
  return null;
}

createServer((req, res) => {
  if (req.url?.startsWith('/api/')) {
    const upstream = request(
      { protocol: target.protocol, hostname: target.hostname, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, host: target.host } },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad_gateway' }));
    });
    // Client went away mid-stream (e.g. a barge-in abort): drop the upstream SSE too.
    res.on('close', () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
    return;
  }
  const file = fileFor(req.url ?? '/') ?? path.join(root, '404.html');
  const ext = path.extname(file);
  res.writeHead(file.endsWith('404.html') && !req.url?.startsWith('/404') ? 404 : 200, {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'cache-control': file.includes(`${path.sep}_next${path.sep}static${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).on('error', () => res.end()).pipe(res);
}).listen(port, () => {
  console.log(`[web] serving ${root} on http://localhost:${port} · /api → ${target.origin}`);
});
