import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath);
const gz = zlib.gzipSync(html, { level: 9 });
const port = Number(process.env.PORT || 5201);

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  const isHome = pathname === '/' || pathname === '/index.html';
  if (!isHome) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const accept = String(req.headers['accept-encoding'] || '');
  if (accept.includes('gzip')) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Content-Length': gz.length,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(gz);
  } else {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': html.length,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(html);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Long March sandbox: http://127.0.0.1:${port}/`);
  console.log('Keep this window open. Press Ctrl+C to stop.');
});
