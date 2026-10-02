// Local preview that mimics GitHub Pages under the /aws-rangefinder/ base path.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SITE } from './site.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
const PORT = Number(process.env.PORT || 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') { res.writeHead(302, { location: SITE.base }); return res.end(); }
  if (!p.startsWith(SITE.base)) { res.writeHead(404); return res.end('outside base'); }
  p = p.slice(SITE.base.length);
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try { if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html'); } catch {}
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'access-control-allow-origin': '*' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end(await fs.readFile(path.join(ROOT, '404.html')).catch(() => 'not found'));
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}${SITE.base}`));
