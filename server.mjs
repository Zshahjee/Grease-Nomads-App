import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.PORT || 5173);
const root = join(process.cwd(), 'dist');
const dataRoot = join(process.cwd(), 'data');
const reportRoot = join(dataRoot, 'reports');
const indexFile = join(root, 'index.html');
const maxBody = 30 * 1024 * 1024;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

await mkdir(reportRoot, { recursive: true });

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > maxBody) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function reportPath(id) {
  return join(reportRoot, `${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}.json`);
}

async function api(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/reports') {
    try {
      const input = JSON.parse(await readBody(req) || '{}');
      const now = new Date().toISOString();
      const id = input.id || randomUUID().slice(0, 12);
      const reportNumber = input.reportNumber || `GN-PPI-${now.slice(0, 10).replaceAll('-', '')}-${id.slice(0, 4).toUpperCase()}`;
      const report = {
        id,
        reportNumber,
        status: input.status || 'completed',
        createdAt: input.createdAt || now,
        updatedAt: now,
        publicPath: `/report/${id}`,
        record: input.record || {},
        data: input.data || {},
        photos: input.photos || {},
        notes: input.notes || {},
        action: input.action || '',
        risk: input.risk || '',
        hybrid: !!input.hybrid,
      };
      await writeFile(reportPath(id), JSON.stringify(report, null, 2), 'utf8');
      json(res, 200, report);
    } catch (error) {
      json(res, error.message === 'Payload too large' ? 413 : 400, { error: error.message || 'Invalid report payload' });
    }
    return true;
  }

  const match = url.pathname.match(/^\/api\/reports\/([^/]+)$/);
  if (req.method === 'GET' && match) {
    try {
      json(res, 200, JSON.parse(await readFile(reportPath(match[1]), 'utf8')));
    } catch {
      json(res, 404, { error: 'Report not found' });
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/reports') {
    const files = existsSync(reportRoot) ? await readdir(reportRoot) : [];
    const reports = [];
    for (const file of files.filter(x => x.endsWith('.json'))) {
      try {
        const r = JSON.parse(await readFile(join(reportRoot, file), 'utf8'));
        reports.push({
          id: r.id,
          reportNumber: r.reportNumber,
          status: r.status,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          publicPath: r.publicPath,
          vehicle: r.record?.['Vehicle Year / Make / Model'] || '',
          customer: r.record?.['Customer Name'] || '',
          vin: r.record?.VIN || '',
          action: r.action || '',
          risk: r.risk || '',
        });
      } catch {}
    }
    json(res, 200, reports.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
    return true;
  }

  return false;
}

async function serveFile(res, path) {
  const body = await readFile(path);
  res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
  res.end(body);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    if (await api(req, res, url)) return;

    const requested = url.pathname === '/' || url.pathname === '/report' || url.pathname.startsWith('/report/') ? '/index.html' : url.pathname;
    const file = normalize(join(root, requested));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    await serveFile(res, file);
  } catch {
    try {
      await serveFile(res, indexFile);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`Serving Grease Nomads PPI on port ${port}`);
});
