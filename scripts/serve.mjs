/** Optional local preview. Playing the saved HTML does not require this server. */

import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  process.argv.includes('--dist') ? 'dist' : '.',
);
const port = Number(process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be an integer from 1 to 65535.');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.md': 'text/plain; charset=utf-8',
};
const config = JSON.parse(
  await readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
);
// Apply the production header rules while previewing the exact dist/ artifact.
function headersFor(name) {
  const headers = {};
  if (process.argv.includes('--dist')) {
    for (const rule of config.headers) {
      if (
        rule.source === '/(.*)' ||
        (rule.source === '/assets/(.*)' && name.startsWith('/assets/'))
      ) {
        for (const { key, value } of rule.headers) headers[key] = value;
      }
    }
  }
  return headers;
}
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405);
      res.end('Method not allowed.');
      return;
    }
    const name = decodeURIComponent(
      new URL(req.url, 'http://localhost').pathname,
    );
    if (name.split('/').some((part) => part.startsWith('.'))) {
      res.writeHead(403);
      res.end('Access denied.');
      return;
    }
    let file = path.resolve(root, '.' + name);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end('Access denied.');
      return;
    }
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headersFor(name),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 400);
    res.end('File not available.');
  }
});
server.on('error', (error) => {
  console.error('SERVER-FAIL / ' + error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () =>
  console.log(`g-zero / http://localhost:${port} / Press Ctrl+C to stop.`),
);
