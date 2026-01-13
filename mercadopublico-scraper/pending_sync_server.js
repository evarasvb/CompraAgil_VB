require('dotenv').config();

const http = require('http');
const { URL } = require('url');
const { createClient } = require('@supabase/supabase-js');

function env(name, fallback = '') {
  const v = process.env[name];
  return v == null ? fallback : String(v);
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

async function handleComplete(req, res, supabase) {
  const body = await readJsonBody(req);
  const id = String(body.id || '').trim();
  const status = String(body.status || '').trim(); // done|failed
  if (!id) return badRequest(res, 'Falta id');
  if (!['done', 'failed'].includes(status)) return badRequest(res, 'status debe ser done|failed');

  const patch = {
    status,
    completed_at: status === 'done' ? new Date().toISOString() : null,
    last_error: body.last_error ? String(body.last_error).slice(0, 2000) : null,
    payload: body.payload ?? null
  };

  const { error } = await supabase.from('pending_extension_sync').update(patch).eq('id', id);
  if (error) return json(res, 500, { error: 'supabase_error', message: error.message });
  return json(res, 200, { ok: true });
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

main().catch((e) => {
  console.error('[pending-sync] fatal:', e);
  process.exitCode = 1;
});

