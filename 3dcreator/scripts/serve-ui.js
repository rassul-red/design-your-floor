#!/usr/bin/env node
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'dist');

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const reqPath = req.url ? req.url.split('?')[0] : '/';
  const rel = reqPath === '/' ? '/ui.html' : reqPath;
  const normalized = path.normalize(rel).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(root, normalized);

  if (!filePath.startsWith(root)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  res.setHeader('Content-Type', contentType(filePath));
  fs.createReadStream(filePath).pipe(res);
});

server.listen(4174, '127.0.0.1', () => {
  console.log('UI server running at http://127.0.0.1:4174');
  console.log('Open /ui.html (or /) in your browser.');
});
