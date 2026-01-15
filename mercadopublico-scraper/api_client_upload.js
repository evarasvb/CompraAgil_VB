// Mantener salida predecible en CI
require('dotenv').config({ quiet: true });

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { matchLicitacion } = require('./matcher_firmavb');
const { toIsoNow } = require('./utils');

function ts() {
  return new Date().toISOString();
}

function log(msg) {
  process.stdout.write(`[${ts()}] ${msg}\n`);
}

function logErr(msg) {
  process.stderr.write(`[${ts()}] ${msg}\n`);
}

function parseArgs(argv) {
  const args = {
    input: null,
    dryRun: false
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') args.input = argv[++i] || null;
    else if (a === '--dry-run') args.dryRun = true;
  }

  return args;
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

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isMissingTableError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  // Postgres: relation "x" does not exist
  if (msg.includes('does not exist') && msg.includes('relation')) return true;
  // Supabase PostgREST cache/schema errors
  if (msg.includes('schema cache') && (msg.includes('not found') || msg.includes('does not exist'))) return true;
  if (msg.includes('could not find the') && msg.includes('table')) return true;
  return false;
}

async function upsertWithFallback(supabase, { tables, rows, onConflict }) {
  let lastError = null;
  for (const table of tables) {
    try {
      const { error } = await supabase.from(table).upsert(rows, { onConflict });
      if (error) throw error;
      return table;
    } catch (e) {
      lastError = e;
      if (!isMissingTableError(e)) throw e;
      logErr(`Tabla '${table}' no existe o no está expuesta; probando fallback... (${String(e?.message || e)})`);
    }
  }
  throw lastError;
}

// "2026-01-14 21:21" -> "2026-01-14T21:21:00"
function parseApiDateTime(dateStr) {
  if (!dateStr) return null;
  const cleaned = String(dateStr).trim();
  const m = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, yyyy, mm, dd, HH, MM] = m;
  return `${yyyy}-${mm}-${dd}T${HH}:${MM}:00`;
}

function toStringOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function buildLinkDetalle(codigo) {
  return `https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(codigo)}`;
}

function normalizeProductosSolicitados(productos) {
  if (!Array.isArray(productos)) return [];
  return productos
    .map((p) => ({
      id: toStringOrNull(p?.codigo_producto),
      nombre: toStringOrNull(p?.nombre) || '',
      descripcion: toStringOrNull(p?.descripcion) || ''
    }))
    .filter((p) => p.nombre || p.descripcion || p.id);
}

function mapToLicitacionRow({ resultado, ficha, nowIso }) {
  const codigo = toStringOrNull(resultado?.codigo || ficha?.codigo);
  if (!codigo) return null;

  const titulo = toStringOrNull(resultado?.nombre || ficha?.nombre);
  const descripcion = toStringOrNull(ficha?.descripcion) || '';

  const productos = normalizeProductosSolicitados(ficha?.productos_solicitados);
  const matchResult = matchLicitacion({
    titulo: titulo || '',
    descripcion,
    items: productos.map((p) => ({ nombre: p.nombre, descripcion: p.descripcion }))
  });

  const institucion = ficha?.informacion_institucion || {};

  // presupuesto: preferir detalle, luego listado
  const presupuesto =
    (Number.isFinite(ficha?.presupuesto_estimado) ? ficha.presupuesto_estimado : null) ??
    (Number.isFinite(resultado?.monto_disponible_CLP) ? resultado.monto_disponible_CLP : null) ??
    (Number.isFinite(resultado?.monto_disponible) ? resultado.monto_disponible : null) ??
    null;

  return {
    codigo,
    titulo,
    estado: toStringOrNull(resultado?.estado || ficha?.estado),
    estado_detallado: null,
    publicada_el: parseApiDateTime(resultado?.fecha_publicacion || ficha?.fecha_publicacion),
    finaliza_el: parseApiDateTime(resultado?.fecha_cierre || ficha?.fecha_cierre),
    organismo: toStringOrNull(resultado?.organismo || institucion?.organismo_comprador),
    rut_institucion: toStringOrNull(institucion?.rut_organismo_comprador),
    departamento: toStringOrNull(resultado?.unidad || institucion?.division),
    presupuesto_estimado: presupuesto,
    tipo_presupuesto: toStringOrNull(ficha?.tipo_presupuesto),
    direccion_entrega: toStringOrNull(ficha?.direccion_entrega),
    plazo_entrega: toStringOrNull(ficha?.plazo_entrega),
    link_detalle: buildLinkDetalle(codigo),
    categoria: matchResult?.categoria ?? null,
    categoria_match: matchResult?.categoria_match ?? null,
    match_score: matchResult?.match_score ?? 0,
    palabras_encontradas: Array.isArray(matchResult?.palabras_encontradas) ? matchResult.palabras_encontradas : [],
    match_encontrado: Boolean(matchResult?.categoria),
    fecha_extraccion: nowIso
  };
}

function mapToItemRows({ codigo, ficha }) {
  const productos = Array.isArray(ficha?.productos_solicitados) ? ficha.productos_solicitados : [];
  const rows = [];
  for (let i = 0; i < productos.length; i++) {
    const p = productos[i] || {};
    rows.push({
      licitacion_codigo: codigo,
      item_index: i + 1,
      producto_id: toStringOrNull(p.codigo_producto),
      nombre: toStringOrNull(p.nombre) || '',
      descripcion: toStringOrNull(p.descripcion) || '',
      cantidad: p.cantidad == null ? null : String(p.cantidad),
      unidad: toStringOrNull(p.unidad_medida)
    });
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    logErr('Uso: node api_client_upload.js --input <path.json> [--dry-run]');
    process.exitCode = 2;
    return;
  }

  const raw = fs.readFileSync(args.input, 'utf8');
  const payload = JSON.parse(raw);
  const resultados = Array.isArray(payload?.resultados) ? payload.resultados : [];
  const fichas = payload?.fichas && typeof payload.fichas === 'object' ? payload.fichas : {};

  const nowIso = toIsoNow();
  const licRows = [];
  const itemRows = [];

  for (const r of resultados) {
    const codigo = toStringOrNull(r?.codigo);
    if (!codigo) continue;
    const ficha = fichas?.[codigo] || null;
    const lic = mapToLicitacionRow({ resultado: r, ficha, nowIso });
    if (lic) licRows.push(lic);
    if (ficha) itemRows.push(...mapToItemRows({ codigo, ficha }));
  }

  log(`Preparado: licitaciones=${licRows.length}, items=${itemRows.length}, dryRun=${args.dryRun ? 'true' : 'false'}`);

  if (args.dryRun) return;

  const supabase = getSupabaseClientOrThrow();

  // Upsert licitaciones
  for (const batch of chunkArray(licRows, 200)) {
    await upsertWithFallback(supabase, { tables: ['licitaciones', 'compras_agiles'], rows: batch, onConflict: 'codigo' });
  }
  log('Upsert OK: licitaciones');

  // Upsert items (si vienen fichas)
  for (const batch of chunkArray(itemRows, 200)) {
    await upsertWithFallback(supabase, {
      tables: ['licitacion_items', 'compras_agiles_items'],
      rows: batch,
      onConflict: 'licitacion_codigo,item_index'
    });
  }
  log('Upsert OK: licitacion_items');
}

main().catch((err) => {
  logErr(`Error: ${err?.message || String(err)}`);
  process.exitCode = 1;
});

