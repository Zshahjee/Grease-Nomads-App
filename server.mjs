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
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseTable = process.env.SUPABASE_REPORTS_TABLE || 'ppi_reports';
const supabaseBucket = process.env.SUPABASE_PHOTO_BUCKET || 'ppi-photos';
const useSupabase = !!(supabaseUrl && supabaseKey);
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

function cleanPathPart(value, fallback = 'file') {
  return String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || fallback;
}

function publicStorageUrl(path) {
  return `${supabaseUrl}/storage/v1/object/public/${supabaseBucket}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function photoBuffer(photo) {
  const dataUrl = String(photo?.url || '');
  const match = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/);
  if (!match) return null;
  return {
    type: photo.type || match[1] || 'application/octet-stream',
    body: Buffer.from(match[2], 'base64'),
  };
}

async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Supabase request failed (${res.status})`);
  return text ? JSON.parse(text) : null;
}

async function uploadReportPhotos(id, photos = {}) {
  if (!useSupabase) return photos;
  const next = {};
  for (const [rowKey, files] of Object.entries(photos || {})) {
    next[rowKey] = [];
    for (let i = 0; i < (files || []).length; i += 1) {
      const file = files[i] || {};
      const parsed = photoBuffer(file);
      if (!parsed) {
        next[rowKey].push(file);
        continue;
      }
      const ext = cleanPathPart((file.name || '').split('.').pop() || parsed.type.split('/').pop() || 'jpg');
      const path = `${cleanPathPart(id)}/${cleanPathPart(rowKey)}/${String(i + 1).padStart(2, '0')}-${cleanPathPart(file.name || `photo.${ext}`)}`;
      await supabaseFetch(`/storage/v1/object/${supabaseBucket}/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': parsed.type,
          'x-upsert': 'true',
        },
        body: parsed.body,
      });
      next[rowKey].push({ ...file, url: publicStorageUrl(path), storagePath: path, type: parsed.type });
    }
  }
  return next;
}

function reportListItem(r) {
  const p = r.payload || r;
  return {
    id: p.id || r.id,
    reportNumber: p.reportNumber || r.report_number,
    status: p.status || r.status,
    createdAt: p.createdAt || r.created_at,
    updatedAt: p.updatedAt || r.updated_at,
    publicPath: p.publicPath || r.public_path,
    vehicle: p.record?.['Vehicle Year / Make / Model'] || r.vehicle || '',
    customer: p.record?.['Customer Name'] || r.customer || '',
    vin: p.record?.VIN || r.vin || '',
    action: p.action || r.action || '',
    risk: p.risk || r.risk || '',
    sentAt: p.sentAt || r.sent_at || p.createdAt || r.created_at,
    viewedAt: p.viewedAt || r.viewed_at || '',
  };
}

async function saveReport(report) {
  if (!useSupabase) {
    await writeFile(reportPath(report.id), JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
  const uploaded = { ...report, photos: await uploadReportPhotos(report.id, report.photos) };
  const row = {
    id: uploaded.id,
    report_number: uploaded.reportNumber,
    status: uploaded.status,
    created_at: uploaded.createdAt,
    updated_at: uploaded.updatedAt,
    public_path: uploaded.publicPath,
    vehicle: uploaded.record?.['Vehicle Year / Make / Model'] || '',
    customer: uploaded.record?.['Customer Name'] || '',
    vin: uploaded.record?.VIN || '',
    action: uploaded.action || '',
    risk: uploaded.risk || '',
    sent_at: uploaded.sentAt || uploaded.createdAt,
    viewed_at: uploaded.viewedAt || null,
    payload: uploaded,
  };
  const saved = await supabaseFetch(`/rest/v1/${supabaseTable}?on_conflict=id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
  });
  return saved?.[0]?.payload || uploaded;
}

async function getReport(id) {
  if (!useSupabase) return JSON.parse(await readFile(reportPath(id), 'utf8'));
  const rows = await supabaseFetch(`/rest/v1/${supabaseTable}?id=eq.${encodeURIComponent(id)}&select=payload`);
  if (!rows?.[0]?.payload) throw new Error('Report not found');
  const payload = { ...rows[0].payload, viewedAt: rows[0].payload.viewedAt || new Date().toISOString() };
  await supabaseFetch(`/rest/v1/${supabaseTable}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ viewed_at: payload.viewedAt, payload }),
  });
  return payload;
}

async function listReports() {
  if (!useSupabase) {
    const files = existsSync(reportRoot) ? await readdir(reportRoot) : [];
    const reports = [];
    for (const file of files.filter(x => x.endsWith('.json'))) {
      try {
        reports.push(reportListItem(JSON.parse(await readFile(join(reportRoot, file), 'utf8'))));
      } catch {}
    }
    return reports.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  const rows = await supabaseFetch(`/rest/v1/${supabaseTable}?select=id,report_number,status,created_at,updated_at,public_path,vehicle,customer,vin,action,risk,sent_at,viewed_at&order=updated_at.desc`);
  return (rows || []).map(reportListItem);
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
        publicPath: `/report/${id}/the-vehicles-inspection-result`,
        record: input.record || {},
        data: input.data || {},
        photos: input.photos || {},
        notes: input.notes || {},
        action: input.action || '',
        risk: input.risk || '',
        hybrid: !!input.hybrid,
      };
      json(res, 200, await saveReport(report));
    } catch (error) {
      console.error('Report save failed:', error);
      json(res, error.message === 'Payload too large' ? 413 : 400, { error: error.message || 'Invalid report payload' });
    }
    return true;
  }

  const match = url.pathname.match(/^\/api\/reports\/([^/]+)$/);
  if (req.method === 'GET' && match) {
    try {
      json(res, 200, await getReport(match[1]));
    } catch (error) {
      console.error('Report load failed:', error);
      json(res, 404, { error: error.message || 'Report not found' });
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/reports') {
    json(res, 200, await listReports());
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

    const requested = url.pathname.startsWith('/report/assets/')
      ? url.pathname.replace('/report', '')
      : url.pathname === '/' || url.pathname === '/report' || url.pathname.startsWith('/report/')
        ? '/index.html'
        : url.pathname;
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
