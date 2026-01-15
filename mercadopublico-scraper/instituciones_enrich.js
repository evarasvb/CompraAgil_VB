// Enriquecimiento de instituciones usando datos internos (Supabase).
// - No depende de Chrome/Puppeteer.
// - Calcula métricas desde `ordenes_compra` para los RUT presentes en el JSON de api-client.

require('dotenv').config({ quiet: true });

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

function ts() {
  return new Date().toISOString();
}

function log(msg) {
  process.stdout.write(`[${ts()}] ${msg}\n`);
}

function logErr(msg) {
  process.stderr.write(`[${ts()}] ${msg}\n`);
}

function env(name, fallback = '') {
  const v = process.env[name];
  return v == null ? fallback : String(v);
}

function getSupabaseClientOrThrow() {
  const url = env('SUPABASE_URL').trim();
  const key = env('SUPABASE_SERVICE_KEY').trim() || env('SUPABASE_KEY').trim();
  if (!url || !key) throw new Error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY/SUPABASE_KEY.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function parseArgs(argv) {
  const args = { input: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') args.input = argv[++i] || null;
  }
  return args;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isMissingTableError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (msg.includes('does not exist') && msg.includes('relation')) return true;
  if (msg.includes('schema cache') && (msg.includes('not found') || msg.includes('does not exist'))) return true;
  if (msg.includes('could not find the') && msg.includes('table')) return true;
  return false;
}

function normalizeRut(rut) {
  if (!rut) return null;
  const s = String(rut).trim();
  if (!s) return null;
  // Mantener dígito verificador si viene
  const cleaned = s.replace(/\s+/g, '').replace(/\./g, '');
  return cleaned;
}

function extractRutsFromApiClientJson(j) {
  const fichas = j?.fichas && typeof j.fichas === 'object' ? j.fichas : {};
  const out = new Set();
  for (const k of Object.keys(fichas)) {
    const inst = fichas?.[k]?.informacion_institucion;
    const rut = normalizeRut(inst?.rut_organismo_comprador);
    if (rut) out.add(rut);
  }
  return Array.from(out);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    logErr('Uso: node instituciones_enrich.js --input <path.json>');
    process.exitCode = 2;
    return;
  }

  const raw = fs.readFileSync(args.input, 'utf8');
  const j = JSON.parse(raw);
  const ruts = extractRutsFromApiClientJson(j);
  if (!ruts.length) {
    log('No hay RUTs de instituciones en el JSON; nada que enriquecer.');
    return;
  }

  const supabase = getSupabaseClientOrThrow();
  const nowIso = new Date().toISOString();

  // Si no existe la tabla instituciones, salir OK (no romper el workflow)
  // Probamos una operación mínima: upsert vacío NO sirve; hacemos select limitado.
  try {
    const probe = await supabase.from('instituciones').select('rut').limit(1);
    if (probe.error) throw probe.error;
  } catch (e) {
    if (isMissingTableError(e)) {
      logErr("Warning: tabla 'instituciones' no existe; se omite enriquecimiento.");
      return;
    }
    throw e;
  }

  // Leer ordenes_compra por los RUTs del lote actual (si la tabla existe).
  const metrics = new Map(); // rut -> {oc_total, oc_monto_total, oc_ultima_fecha}
  let ocTableAvailable = true;
  for (const batch of chunkArray(ruts, 50)) {
    const q = supabase
      .from('ordenes_compra')
      .select('rut_demandante,total,fecha_envio_oc')
      .in('rut_demandante', batch);
    const { data, error } = await q;
    if (error) {
      if (isMissingTableError(error)) {
        ocTableAvailable = false;
        break;
      }
      throw error;
    }
    for (const row of data || []) {
      const rut = normalizeRut(row?.rut_demandante);
      if (!rut) continue;
      const m = metrics.get(rut) || { oc_total: 0, oc_monto_total: 0, oc_ultima_fecha: null };
      m.oc_total += 1;
      const total = typeof row.total === 'number' ? row.total : Number(row.total);
      if (Number.isFinite(total)) m.oc_monto_total += total;
      const t = row?.fecha_envio_oc ? new Date(row.fecha_envio_oc).toISOString() : null;
      if (t && (!m.oc_ultima_fecha || t > m.oc_ultima_fecha)) m.oc_ultima_fecha = t;
      metrics.set(rut, m);
    }
  }

  const rows = ruts.map((rut) => {
    const m = metrics.get(rut) || null;
    return {
      rut,
      oc_total: ocTableAvailable ? (m ? m.oc_total : 0) : null,
      oc_monto_total: ocTableAvailable ? (m ? m.oc_monto_total : 0) : null,
      oc_ultima_fecha: ocTableAvailable ? (m ? m.oc_ultima_fecha : null) : null,
      updated_at: nowIso,
      last_seen_at: nowIso
    };
  });

  // Upsert por rut (solo actualiza métricas; nombre/división los pone api_client_upload.js)
  for (const batch of chunkArray(rows, 200)) {
    const { error } = await supabase.from('instituciones').upsert(batch, { onConflict: 'rut' });
    if (error) throw error;
  }

  log(`Enriquecidas instituciones=${rows.length} (oc_table=${ocTableAvailable ? 'true' : 'false'})`);
}

main().catch((e) => {
  logErr(`Error: ${e?.message || String(e)}`);
  process.exitCode = 1;
});

