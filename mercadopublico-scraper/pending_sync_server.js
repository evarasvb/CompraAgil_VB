require('dotenv').config();

const http = require('http');
const { URL } = require('url');
const { createClient } = require('@supabase/supabase-js');

function env(name, fallback = '') {
  const v = process.env[name];
  return v == null ? fallback : String(v);
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-api-key'
  });
  res.end(payload);
}

function unauthorized(res) {
  json(res, 401, { error: 'unauthorized' });
}

function badRequest(res, message) {
  json(res, 400, { error: 'bad_request', message });
}

function getSupabaseClient() {
  const url = env('SUPABASE_URL').trim();
  const key = env('SUPABASE_SERVICE_KEY').trim() || env('SUPABASE_KEY').trim();
  if (!url || !key) throw new Error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY/SUPABASE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function isAuthorized(req) {
  const required = env('PENDING_SYNC_API_KEY').trim();
  if (!required) return true; // si no se configura, queda abierto (útil en dev)
  const got = String(req.headers['x-api-key'] || '').trim();
  return got && got === required;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function handlePendingSync(req, res, supabase, parsedUrl) {
  const limit = Math.max(1, Math.min(200, Number(parsedUrl.searchParams.get('limit') || 50)));
  const kind = String(parsedUrl.searchParams.get('kind') || '').trim();

  let q = supabase
    .from('pending_extension_sync')
    .select('id,kind,identifier,url,context,attempts,first_seen_at,last_attempt_at,status')
    .eq('status', 'pending')
    .order('last_attempt_at', { ascending: true })
    .limit(limit);
  if (kind) q = q.eq('kind', kind);

  const { data, error } = await q;
  if (error) return json(res, 500, { error: 'supabase_error', message: error.message });

  const now = new Date().toISOString();
  // Marcar que se entregaron (incrementar attempts / actualizar last_attempt_at)
  for (const row of data || []) {
    const nextAttempts = Number(row.attempts || 0) + 1;
    await supabase
      .from('pending_extension_sync')
      .update({ attempts: nextAttempts, last_attempt_at: now })
      .eq('id', row.id);
  }

  return json(res, 200, { items: data || [] });
}

function normalizeCompraAgilPayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const licitaciones =
    (Array.isArray(p.licitaciones) && p.licitaciones) ||
    (p.licitacion && typeof p.licitacion === 'object' ? [p.licitacion] : []) ||
    (p.codigo ? [p] : []);

  const items =
    (Array.isArray(p.licitacion_items) && p.licitacion_items) ||
    (Array.isArray(p.items) && p.items) ||
    [];

  return { licitaciones, items };
}

function normalizeOcPayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const header =
    (p.orden_compra && typeof p.orden_compra === 'object' ? p.orden_compra : null) ||
    (p.header && typeof p.header === 'object' ? p.header : null) ||
    (p.numero_oc ? p : null);

  const items =
    (Array.isArray(p.ordenes_compra_items) && p.ordenes_compra_items) ||
    (Array.isArray(p.items) && p.items) ||
    [];

  return { header, items };
}

function normalizeLicitacionApiPayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const row =
    (p.licitacion && typeof p.licitacion === 'object' ? p.licitacion : null) ||
    (p.row && typeof p.row === 'object' ? p.row : null) ||
    (p.codigo ? p : null);
  return { row };
}

async function upsertRows(supabase, table, rows, onConflict) {
  if (!Array.isArray(rows) || !rows.length) return { count: 0 };
  let total = 0;
  for (const batch of chunkArray(rows, 200)) {
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`${table} upsert error: ${error.message}`);
    total += batch.length;
  }
  return { count: total };
}

async function applyCompraAgil({ kind, payload, supabase }) {
  const { licitaciones, items } = normalizeCompraAgilPayload(payload);
  const licRows = (licitaciones || []).filter((r) => r && r.codigo);

  // upsert licitaciones
  const licRes = await upsertRows(supabase, 'licitaciones', licRows, 'codigo');

  // upsert items si vienen
  let itemCount = 0;
  if (Array.isArray(items) && items.length) {
    // asegurar licitacion_codigo + item_index
    const normalized = [];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const licitacion_codigo = it.licitacion_codigo || it.codigo || it.licitacionCodigo || null;
      if (!licitacion_codigo) continue;
      normalized.push({
        ...it,
        licitacion_codigo,
        item_index: it.item_index != null ? it.item_index : it.itemIndex != null ? it.itemIndex : null
      });
    }

    // si faltan item_index, asignar secuencial por licitación
    const byLic = new Map();
    for (const it of normalized) {
      const code = String(it.licitacion_codigo);
      if (!byLic.has(code)) byLic.set(code, []);
      byLic.get(code).push(it);
    }

    const finalItems = [];
    for (const [code, arr] of byLic.entries()) {
      let idx = 1;
      for (const it of arr) {
        const item_index = it.item_index != null ? Number(it.item_index) : idx;
        idx += 1;
        finalItems.push({ ...it, licitacion_codigo: code, item_index });
      }
    }

    const itemRes = await upsertRows(supabase, 'licitacion_items', finalItems, 'licitacion_codigo,item_index');
    itemCount = itemRes.count;
  }

  return { kind, licitaciones: licRes.count, items: itemCount };
}

async function applyOcDetail({ payload, supabase }) {
  const { header, items } = normalizeOcPayload(payload);
  if (!header || !header.numero_oc) throw new Error('Payload OC inválido: falta header.numero_oc');

  // upsert cabecera
  await upsertRows(supabase, 'ordenes_compra', [header], 'numero_oc');

  // refrescar items: delete + insert (no hay unique natural para upsert)
  const numero_oc = String(header.numero_oc);
  const del = await supabase.from('ordenes_compra_items').delete().eq('numero_oc', numero_oc);
  if (del.error) throw new Error(`ordenes_compra_items delete error: ${del.error.message}`);

  const normalizedItems = (Array.isArray(items) ? items : [])
    .filter((it) => it && typeof it === 'object')
    .map((it) => ({ ...it, numero_oc }));

  let inserted = 0;
  for (const batch of chunkArray(normalizedItems, 200)) {
    if (!batch.length) continue;
    const ins = await supabase.from('ordenes_compra_items').insert(batch);
    if (ins.error) throw new Error(`ordenes_compra_items insert error: ${ins.error.message}`);
    inserted += batch.length;
  }

  return { numero_oc, items: inserted };
}

async function applyLicitacionesApiDetail({ payload, supabase }) {
  const { row } = normalizeLicitacionApiPayload(payload);
  if (!row || !row.codigo) throw new Error('Payload licitaciones_api inválido: falta codigo');
  const res = await upsertRows(supabase, 'licitaciones_api', [row], 'codigo');
  return { codigo: row.codigo, rows: res.count };
}

async function applyPayloadForTask({ task, payload, supabase }) {
  const kind = String(task.kind || '').trim();
  if (!kind) throw new Error('Tarea inválida: falta kind');

  // Compra Ágil
  if (kind === 'compra_agil_list' || kind === 'compra_agil_detail') {
    return await applyCompraAgil({ kind, payload, supabase });
  }

  // OC
  if (kind === 'oc_detail') {
    return await applyOcDetail({ payload, supabase });
  }

  // Licitaciones API (compatibilidad: lic_detail / licitacion_detail)
  if (kind === 'lic_detail' || kind === 'licitacion_detail' || kind === 'lic_detail_api') {
    return await applyLicitacionesApiDetail({ payload, supabase });
  }

  // Otros kinds: solo guardar payload y marcar done
  return { kind, skipped: true };
}

async function handleComplete(req, res, supabase) {
  const body = await readJsonBody(req);
  const id = String(body.id || '').trim();
  if (!id) return badRequest(res, 'Falta id');

  // Obtener tarea para enrutar por kind
  const taskRes = await supabase
    .from('pending_extension_sync')
    .select('id,kind,identifier,url,status')
    .eq('id', id)
    .maybeSingle();
  if (taskRes.error) return json(res, 500, { error: 'supabase_error', message: taskRes.error.message });
  if (!taskRes.data) return json(res, 404, { error: 'not_found', message: 'Tarea no existe' });

  const payload = body.payload ?? null;
  const explicitStatus = String(body.status || '').trim(); // opcional: done|failed

  // Si la extensión reporta failed explícito sin payload, solo marcar failed
  if (explicitStatus === 'failed' && payload == null) {
    const patchFailed = {
      status: 'failed',
      completed_at: null,
      last_error: body.last_error ? String(body.last_error).slice(0, 2000) : 'failed (sin detalle)',
      payload: null
    };
    const upd = await supabase.from('pending_extension_sync').update(patchFailed).eq('id', id);
    if (upd.error) return json(res, 500, { error: 'supabase_error', message: upd.error.message });
    return json(res, 200, { ok: true, status: 'failed' });
  }

  // Intentar aplicar payload -> upsert según kind
  try {
    const applyResult = await applyPayloadForTask({ task: taskRes.data, payload, supabase });
    const patchDone = {
      status: 'done',
      completed_at: new Date().toISOString(),
      last_error: null,
      payload
    };
    const upd = await supabase.from('pending_extension_sync').update(patchDone).eq('id', id);
    if (upd.error) return json(res, 500, { error: 'supabase_error', message: upd.error.message });
    return json(res, 200, { ok: true, status: 'done', applied: applyResult });
  } catch (e) {
    const patchFailed = {
      status: 'failed',
      completed_at: null,
      last_error: String(e?.message || e).slice(0, 2000),
      payload
    };
    const upd = await supabase.from('pending_extension_sync').update(patchFailed).eq('id', id);
    if (upd.error) return json(res, 500, { error: 'supabase_error', message: upd.error.message });
    return json(res, 200, { ok: false, status: 'failed', error: patchFailed.last_error });
  }

}

async function main() {
  const supabase = getSupabaseClient();
  const port = Number(env('PORT', '8787')) || 8787;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const path = parsedUrl.pathname;

      if (path === '/health') return json(res, 200, { ok: true });

      if (!isAuthorized(req)) return unauthorized(res);

      if (req.method === 'GET' && path === '/api/pending-sync') {
        return await handlePendingSync(req, res, supabase, parsedUrl);
      }
      if (req.method === 'POST' && path === '/api/pending-sync/complete') {
        return await handleComplete(req, res, supabase);
      }

      return json(res, 404, { error: 'not_found' });
    } catch (e) {
      return json(res, 500, { error: 'server_error', message: String(e?.message || e) });
    }
  });

  server.listen(port, () => {
    console.log(`[pending-sync] listening on :${port}`);
  });
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[pending-sync] fatal:', e);
    process.exitCode = 1;
  });
}

