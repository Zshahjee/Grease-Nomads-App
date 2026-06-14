import { createServer } from 'node:http';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
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
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '';
const supabaseTable = process.env.SUPABASE_REPORTS_TABLE || 'ppi_reports';
const repairOrdersTable = process.env.SUPABASE_REPAIR_ORDERS_TABLE || 'repair_orders';
const servicePrepsTable = process.env.SUPABASE_SERVICE_PREPS_TABLE || 'service_preps';
const customersTable = process.env.SUPABASE_CUSTOMERS_TABLE || 'customers';
const vehiclesTable = process.env.SUPABASE_VEHICLES_TABLE || 'vehicles';
const mediaAssetsTable = process.env.SUPABASE_MEDIA_ASSETS_TABLE || 'media_assets';
const supabaseBucket = process.env.SUPABASE_PHOTO_BUCKET || 'ppi-photos';
const useSupabase = !!(supabaseUrl && supabaseKey);
const authEnabled = !!(supabaseUrl && supabaseAnonKey);
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

function setAuthCookie(res, token, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `gn_ppi_auth=${token || ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
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

async function supabaseAuthFetch(path, options = {}, token = '') {
  const res = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: supabaseAnonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Supabase auth request failed (${res.status})`);
  return text ? JSON.parse(text) : null;
}

async function currentUser(req) {
  if (!authEnabled) return { id: 'local-dev', email: 'auth-disabled-local' };
  const token = getCookie(req, 'gn_ppi_auth');
  if (!token) return null;
  try {
    const user = await supabaseAuthFetch('/auth/v1/user', {}, token);
    return user?.id ? { id: user.id, email: user.email || '' } : null;
  } catch {
    return null;
  }
}

async function requireAuth(req, res) {
  const user = await currentUser(req);
  if (user) return user;
  json(res, 401, { error: 'Authentication required' });
  return null;
}

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function stableId(prefix, value) {
  const clean = cleanPathPart(value || randomUUID().slice(0, 8)).toLowerCase();
  return `${prefix}-${clean}`;
}

function repairOrderDetails(input = {}) {
  const record = input.record || input.details || {};
  const estimate = input.estimate?.estimate || input.estimate || {};
  return {
    customer: input.customer || record['Customer Name'] || estimate.customer || '',
    phone: input.phone || record['Phone Number'] || estimate.phone || '',
    email: input.email || record.Email || estimate.email || '',
    vehicle: input.vehicle || record['Vehicle Year / Make / Model'] || estimate.vehicle || '',
    vin: input.vin || record.VIN || estimate.vin || '',
    mileage: input.mileage || record.Mileage || estimate.mileage || '',
    color: input.color || record.Color || estimate.color || '',
    trim: input.trim || record.Trim || estimate.trim || '',
    engine: input.engine || record['Engine Code'] || estimate.engine || '',
    transmission: input.transmission || record['Transmission Code'] || estimate.transmission || '',
    chassis: input.chassis || record['Chassis Code'] || estimate.chassis || '',
    repairOrder: input.repairOrder || record['Repair Order Number'] || estimate.repairOrder || '',
  };
}

async function upsertCustomer(details = {}, existingId = '') {
  if (!useSupabase) return existingId || '';
  const phone = normalizePhone(details.phone);
  const id = existingId || stableId('cust', details.email || phone || details.customer);
  const row = {
    id,
    name: details.customer || '',
    phone,
    email: details.email || '',
    updated_at: new Date().toISOString(),
    payload: details,
  };
  await supabaseFetch(`/rest/v1/${customersTable}?on_conflict=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
  return id;
}

async function upsertVehicle(details = {}, customerId = '', existingId = '') {
  if (!useSupabase) return existingId || '';
  const id = existingId || stableId('veh', details.vin || `${customerId}-${details.vehicle}`);
  const row = {
    id,
    customer_id: customerId || null,
    year_make_model: details.vehicle || '',
    vin: details.vin || '',
    mileage: details.mileage || '',
    color: details.color || '',
    trim: details.trim || '',
    engine: details.engine || '',
    transmission: details.transmission || '',
    chassis: details.chassis || '',
    updated_at: new Date().toISOString(),
    payload: details,
  };
  await supabaseFetch(`/rest/v1/${vehiclesTable}?on_conflict=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
  return id;
}

async function ensureCustomerVehicle(input = {}) {
  if (!useSupabase) return { customerId: input.customerId || '', vehicleId: input.vehicleId || '', details: repairOrderDetails(input) };
  const details = repairOrderDetails(input);
  const customerId = await upsertCustomer(details, input.customerId || '');
  const vehicleId = await upsertVehicle(details, customerId, input.vehicleId || '');
  return { customerId, vehicleId, details };
}

async function saveMediaAsset(asset = {}) {
  if (!useSupabase) return;
  const row = {
    id: asset.id,
    repair_order_id: asset.repairOrderId || null,
    customer_id: asset.customerId || null,
    vehicle_id: asset.vehicleId || null,
    module: asset.module || '',
    parent_id: asset.parentId || '',
    line_item_id: asset.lineItemId || '',
    label: asset.label || '',
    file_name: asset.fileName || '',
    file_type: asset.fileType || '',
    storage_path: asset.storagePath || '',
    public_url: asset.publicUrl || '',
    updated_at: new Date().toISOString(),
    payload: asset.payload || {},
  };
  await supabaseFetch(`/rest/v1/${mediaAssetsTable}?on_conflict=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
}

async function uploadMediaMap({ repairOrderId = '', module = 'inspection', parentId = '', media = {}, customerId = '', vehicleId = '' }) {
  if (!useSupabase) return media;
  const next = {};
  for (const [rowKey, files] of Object.entries(media || {})) {
    next[rowKey] = [];
    for (let i = 0; i < (files || []).length; i += 1) {
      const file = files[i] || {};
      const parsed = photoBuffer(file);
      if (!parsed) {
        next[rowKey].push(file);
        continue;
      }
      const ext = cleanPathPart((file.name || '').split('.').pop() || parsed.type.split('/').pop() || 'jpg');
      const mediaId = String(file.id || randomUUID());
      const path = [
        'repair-orders',
        cleanPathPart(repairOrderId || 'unassigned-ro'),
        cleanPathPart(module),
        cleanPathPart(parentId || 'draft'),
        cleanPathPart(rowKey),
        `${cleanPathPart(mediaId)}-${String(i + 1).padStart(2, '0')}-${cleanPathPart(file.name || `media.${ext}`)}`,
      ].join('/');
      await supabaseFetch(`/storage/v1/object/${supabaseBucket}/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': parsed.type,
          'x-upsert': 'true',
        },
        body: parsed.body,
      });
      const uploaded = { ...file, id: mediaId, url: publicStorageUrl(path), storagePath: path, type: parsed.type };
      next[rowKey].push(uploaded);
      await saveMediaAsset({
        id: mediaId,
        repairOrderId,
        customerId,
        vehicleId,
        module,
        parentId,
        lineItemId: rowKey,
        label: file.label || '',
        fileName: file.name || '',
        fileType: parsed.type,
        storagePath: path,
        publicUrl: uploaded.url,
        payload: uploaded,
      });
    }
  }
  return next;
}

async function uploadReportPhotos(id, photos = {}, context = {}) {
  return uploadMediaMap({
    repairOrderId: context.repairOrderId || id,
    module: context.module || 'inspection-report',
    parentId: id,
    media: photos,
    customerId: context.customerId || '',
    vehicleId: context.vehicleId || '',
  });
}

async function uploadRepairOrderMedia(payload = {}) {
  if (!useSupabase) return payload;
  const context = {
    repairOrderId: payload.id,
    customerId: payload.customerId || '',
    vehicleId: payload.vehicleId || '',
  };
  const next = { ...payload };
  if (next.serviceSummary?.media) {
    next.serviceSummary = {
      ...next.serviceSummary,
      media: await uploadMediaMap({
        ...context,
        module: 'service-summary',
        parentId: next.serviceSummary.id || next.serviceSummaryId || 'service-summary',
        media: next.serviceSummary.media,
      }),
    };
  }
  if (next.inspectionReport?.photos) {
    next.inspectionReport = {
      ...next.inspectionReport,
      photos: await uploadMediaMap({
        ...context,
        module: 'inspection',
        parentId: next.inspectionReport.id || next.inspectionId || 'inspection',
        media: next.inspectionReport.photos,
      }),
    };
  }
  if (next.inspection?.photos) {
    next.inspection = {
      ...next.inspection,
      photos: await uploadMediaMap({
        ...context,
        module: 'inspection',
        parentId: next.inspection.id || next.inspectionId || 'inspection',
        media: next.inspection.photos,
      }),
    };
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
    inspectionType: p.inspectionType || r.inspection_type || 'ppi',
    inspectionDate: p.record?.['Inspection Date'] || '',
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
  const links = await ensureCustomerVehicle(report);
  const uploaded = {
    ...report,
    customerId: links.customerId || report.customerId || '',
    vehicleId: links.vehicleId || report.vehicleId || '',
    photos: await uploadReportPhotos(report.id, report.photos, {
      repairOrderId: report.repairOrderId || report.id,
      customerId: links.customerId || report.customerId || '',
      vehicleId: links.vehicleId || report.vehicleId || '',
      module: 'inspection',
    }),
  };
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
    customer_id: uploaded.customerId || null,
    vehicle_id: uploaded.vehicleId || null,
    repair_order_id: uploaded.repairOrderId || null,
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
  if (String(rows[0].payload.status || '').toLowerCase() === 'draft') return rows[0].payload;
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
  const rows = await supabaseFetch(`/rest/v1/${supabaseTable}?select=id,report_number,status,created_at,updated_at,public_path,vehicle,customer,vin,action,risk,sent_at,viewed_at,payload&order=updated_at.desc`);
  return (rows || []).map(reportListItem);
}

async function deleteReport(id) {
  const cleanId = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleanId) throw new Error('Missing report ID');
  if (!useSupabase) {
    const path = reportPath(cleanId);
    if (existsSync(path)) await unlink(path);
    return { ok: true };
  }
  await supabaseFetch(`/rest/v1/${supabaseTable}?id=eq.${encodeURIComponent(cleanId)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  return { ok: true };
}

function repairOrderListItem(row) {
  const p = row.payload || row;
  return {
    ...(p || {}),
    id: p?.id || row.id,
    status: p?.status || row.status || 'estimates',
    customer: p?.customer || row.customer || '',
    vehicle: p?.vehicle || row.vehicle || '',
    repairOrder: p?.repairOrder || row.repair_order || '',
    customerId: p?.customerId || row.customer_id || '',
    vehicleId: p?.vehicleId || row.vehicle_id || '',
    jobType: p?.jobType || row.job_type || '',
    updatedAt: p?.updatedAt || row.updated_at || '',
    createdAt: p?.createdAt || row.created_at || '',
  };
}

async function saveRepairOrder(input = {}) {
  const now = new Date().toISOString();
  const id = String(input.id || `ro-${Date.now()}-${randomUUID().slice(0, 4)}`);
  const links = await ensureCustomerVehicle({ ...input, id });
  const basePayload = {
    ...input,
    id,
    status: input.status || 'estimates',
    createdAt: input.createdAt || now,
    updatedAt: now,
    customerId: links.customerId || input.customerId || '',
    vehicleId: links.vehicleId || input.vehicleId || '',
    jobType: input.jobType || input.inspectionType || input.inspectionChoice || input.estimate?.estimate?.jobType || 'service',
  };
  const payload = useSupabase ? await uploadRepairOrderMedia(basePayload) : basePayload;
  if (!useSupabase) {
    const root = join(dataRoot, 'repair-orders');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, `${cleanPathPart(id)}.json`), JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  }
  const row = {
    id,
    status: payload.status,
    customer: payload.customer || '',
    vehicle: payload.vehicle || '',
    repair_order: payload.repairOrder || '',
    estimate_id: payload.estimateId || payload.estimate?.id || '',
    inspection_id: payload.inspectionId || '',
    inspection_type: payload.inspectionType || '',
    service_summary_id: payload.serviceSummaryId || payload.serviceSummary?.id || '',
    customer_id: payload.customerId || null,
    vehicle_id: payload.vehicleId || null,
    job_type: payload.jobType || '',
    created_at: payload.createdAt,
    updated_at: payload.updatedAt,
    payload,
  };
  const saved = await supabaseFetch(`/rest/v1/${repairOrdersTable}?on_conflict=id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
  });
  return repairOrderListItem(saved?.[0] || row);
}

async function listRepairOrders() {
  if (!useSupabase) {
    const root = join(dataRoot, 'repair-orders');
    const files = existsSync(root) ? await readdir(root) : [];
    const orders = [];
    for (const file of files.filter(x => x.endsWith('.json'))) {
      try {
        orders.push(JSON.parse(await readFile(join(root, file), 'utf8')));
      } catch {}
    }
    return orders.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  const rows = await supabaseFetch(`/rest/v1/${repairOrdersTable}?select=id,status,customer,vehicle,repair_order,estimate_id,inspection_id,inspection_type,service_summary_id,customer_id,vehicle_id,job_type,created_at,updated_at,payload&order=updated_at.desc`);
  return (rows || []).map(repairOrderListItem);
}

async function getRepairOrder(id) {
  if (!useSupabase) {
    const root = join(dataRoot, 'repair-orders');
    return JSON.parse(await readFile(join(root, `${cleanPathPart(id)}.json`), 'utf8'));
  }
  const rows = await supabaseFetch(`/rest/v1/${repairOrdersTable}?id=eq.${encodeURIComponent(id)}&select=payload`);
  if (!rows?.[0]?.payload) throw new Error('Repair order not found');
  return rows[0].payload;
}

async function deleteRepairOrder(id) {
  if (!id) throw new Error('Repair order ID is required');
  if (!useSupabase) {
    const root = join(dataRoot, 'repair-orders');
    await unlink(join(root, `${cleanPathPart(id)}.json`)).catch(error => {
      if (error?.code !== 'ENOENT') throw error;
    });
    return { deleted: true };
  }
  await supabaseFetch(`/rest/v1/${repairOrdersTable}?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  return { deleted: true };
}

async function saveServicePrep(input = {}) {
  const now = new Date().toISOString();
  const id = String(input.id || `prep-${Date.now()}-${randomUUID().slice(0, 4)}`);
  const payload = { ...input, id, updatedAt: now, createdAt: input.createdAt || now };
  if (!useSupabase) return payload;
  const row = {
    id,
    service: payload.service || payload.title || '',
    chassis: payload.chassis || '',
    trim: payload.trim || '',
    engine: payload.engine || '',
    transmission: payload.transmission || '',
    drivetrain: payload.drivetrain || '',
    created_at: payload.createdAt,
    updated_at: payload.updatedAt,
    payload,
  };
  const saved = await supabaseFetch(`/rest/v1/${servicePrepsTable}?on_conflict=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row),
  });
  return saved?.[0]?.payload || payload;
}

async function listServicePreps() {
  if (!useSupabase) return [];
  const rows = await supabaseFetch(`/rest/v1/${servicePrepsTable}?select=payload&order=updated_at.desc`);
  return (rows || []).map(r => r.payload).filter(Boolean);
}

async function api(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    json(res, 200, { required: authEnabled, user: await currentUser(req) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    if (!authEnabled) {
      json(res, 200, { required: false, user: { id: 'local-dev', email: 'auth-disabled-local' } });
      return true;
    }
    try {
      const input = JSON.parse(await readBody(req) || '{}');
      const result = await supabaseAuthFetch('/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.email, password: input.password }),
      });
      const token = result?.access_token;
      if (!token) throw new Error('No session token returned');
      setAuthCookie(res, token, result.expires_in || 3600);
      json(res, 200, { required: true, user: result.user ? { id: result.user.id, email: result.user.email || '' } : null });
    } catch (error) {
      json(res, 401, { error: 'Login failed. Check the email and password.' });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    setAuthCookie(res, '', 0);
    json(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/reports') {
    if (!(await requireAuth(req, res))) return true;
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
        inspectionType: input.inspectionType || 'ppi',
        repairOrderId: input.repairOrderId || '',
        customerId: input.customerId || '',
        vehicleId: input.vehicleId || '',
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

  if (req.method === 'DELETE' && match) {
    if (!(await requireAuth(req, res))) return true;
    try {
      json(res, 200, await deleteReport(match[1]));
    } catch (error) {
      console.error('Report delete failed:', error);
      json(res, 400, { error: error.message || 'Report could not be deleted' });
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/reports') {
    if (!(await requireAuth(req, res))) return true;
    json(res, 200, await listReports());
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/repair-orders') {
    if (!(await requireAuth(req, res))) return true;
    try {
      json(res, 200, await listRepairOrders());
    } catch (error) {
      console.error('Repair order list failed:', error);
      json(res, 400, { error: error.message || 'Could not load repair orders' });
    }
    return true;
  }

  const publicRoMatch = url.pathname.match(/^\/api\/public\/repair-orders\/([^/]+)$/);
  if (req.method === 'GET' && publicRoMatch) {
    try {
      const ro = await getRepairOrder(publicRoMatch[1]);
      const viewedAt = ro.customerViewedAt || new Date().toISOString();
      const payload = { ...ro, customerViewedAt: viewedAt, updatedAt: ro.updatedAt || viewedAt };
      saveRepairOrder(payload).catch(error => console.error('Public repair order viewed save failed:', error));
      json(res, 200, payload);
    } catch (error) {
      json(res, 404, { error: error.message || 'Repair order not found' });
    }
    return true;
  }

  if (req.method === 'POST' && publicRoMatch) {
    try {
      const existing = await getRepairOrder(publicRoMatch[1]);
      const input = JSON.parse(await readBody(req) || '{}');
      const estimate = input.estimate ? {
        ...(existing.estimate || {}),
        ...input.estimate,
        estimate: { ...((existing.estimate || {}).estimate || {}), ...(input.estimate.estimate || {}) },
      } : existing.estimate;
      const authorizedAt = input.authorizedAt || estimate?.estimate?.authorizedAt || existing.authorizedAt || '';
      const status = authorizedAt ? 'scheduled' : (existing.status || 'waiting');
      const payload = {
        ...existing,
        estimate,
        estimateId: input.estimateId || existing.estimateId || estimate?.id || '',
        status,
        inspectionChoice: estimate?.estimate?.inspectionChoice || existing.inspectionChoice,
        authorizedAt,
        scheduledAt: authorizedAt ? (existing.scheduledAt || authorizedAt) : existing.scheduledAt,
        authorizedName: input.authorizedName || estimate?.estimate?.authorizedName || existing.authorizedName,
        authorizedSignature: input.authorizedSignature || estimate?.estimate?.authorizedSignature || existing.authorizedSignature,
      };
      json(res, 200, await saveRepairOrder(payload));
    } catch (error) {
      json(res, 400, { error: error.message || 'Could not update repair order' });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/repair-orders') {
    if (!(await requireAuth(req, res))) return true;
    try {
      json(res, 200, await saveRepairOrder(JSON.parse(await readBody(req) || '{}')));
    } catch (error) {
      console.error('Repair order save failed:', error);
      json(res, error.message === 'Payload too large' ? 413 : 400, { error: error.message || 'Could not save repair order' });
    }
    return true;
  }

  const roMatch = url.pathname.match(/^\/api\/repair-orders\/([^/]+)$/);
  if (req.method === 'GET' && roMatch) {
    if (!(await requireAuth(req, res))) return true;
    try {
      json(res, 200, await getRepairOrder(roMatch[1]));
    } catch (error) {
      json(res, 404, { error: error.message || 'Repair order not found' });
    }
    return true;
  }

  if (req.method === 'DELETE' && roMatch) {
    if (!(await requireAuth(req, res))) return true;
    try {
      json(res, 200, await deleteRepairOrder(roMatch[1]));
    } catch (error) {
      console.error('Repair order delete failed:', error);
      json(res, 400, { error: error.message || 'Could not delete repair order' });
    }
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/service-preps') {
    if (!(await requireAuth(req, res))) return true;
    try {
      json(res, 200, await listServicePreps());
    } catch (error) {
      console.error('Service prep list failed:', error);
      json(res, 400, { error: error.message || 'Could not load service preps' });
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/service-preps') {
    if (!(await requireAuth(req, res))) return true;
    try {
      json(res, 200, await saveServicePrep(JSON.parse(await readBody(req) || '{}')));
    } catch (error) {
      console.error('Service prep save failed:', error);
      json(res, error.message === 'Payload too large' ? 413 : 400, { error: error.message || 'Could not save service prep' });
    }
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
