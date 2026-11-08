// Static server for the built site with GitHub Pages' lookup rules: a directory serves its
// index.html, an extensionless path falls back to <path>.html (/blog/<slug> -> blog/<slug>.html),
// anything else is a 404. Used in-process by check.js; `node server.js <root> [port]` runs it alone.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.pdf': 'application/pdf', '.webmanifest': 'application/manifest+json',
};

function isFile(p) { return fs.existsSync(p) && fs.statSync(p).isFile(); }
function isDir(p) { return fs.existsSync(p) && fs.statSync(p).isDirectory(); }

// Returns {file} to serve, {redirect} for a directory without its slash, or null for a 404.
function resolve(root, urlPath) {
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const abs = path.join(root, rel);
  if (!abs.startsWith(root)) return null;
  if (isDir(abs)) {
    if (!urlPath.endsWith('/')) return { redirect: urlPath + '/' };
    return isFile(path.join(abs, 'index.html')) ? { file: path.join(abs, 'index.html') } : null;
  }
  if (isFile(abs)) return { file: abs };
  if (!path.extname(abs) && isFile(abs + '.html')) return { file: abs + '.html' };
  return null;
}

function serve(root, port = 0, host = '127.0.0.1') {
  root = path.resolve(root);
  const server = http.createServer((req, res) => {
    const urlPath = new URL(req.url, 'http://x').pathname;
    const hit = resolve(root, urlPath);
    if (hit && hit.redirect) { res.writeHead(301, { Location: hit.redirect }); res.end(); return; }
    if (!hit) {
      const nf = path.join(root, '404.html');
      res.writeHead(404, { 'Content-Type': TYPES['.html'] });
      res.end(isFile(nf) ? fs.readFileSync(nf) : 'Not found');
      return;
    }
    // GitHub Pages sends ACAO *; the giscus iframe needs it to load a template's giscus.css.
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(hit.file).toLowerCase()] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(hit.file).pipe(res);
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok({ server, origin: `http://${host}:${server.address().port}` }));
  });
}

module.exports = { serve };

if (require.main === module) {
  const [root = 'out/site', port = '0'] = process.argv.slice(2);
  serve(root, Number(port)).then(({ origin }) => console.log(`serving ${root} at ${origin}`));
}
