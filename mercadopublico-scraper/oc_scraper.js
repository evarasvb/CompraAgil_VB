require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
// Nota: este scraper tolera 404 en detalle y reintenta errores transitorios del API.

function env(name, fallback = '') {
  const v = process.env[name];
  return v == null ? fallback : String(v);
}

function todayYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseYYYYMMDDToDate(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatDDMMAAAA(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}${mm}${yyyy}`;
}

function dateRangeDDMMAAAA(fromYYYYMMDD, toYYYYMMDD) {
  const from = parseYYYYMMDDToDate(fromYYYYMMDD);
  const to = parseYYYYMMDDToDate(toYYYYMMDD);
  if (!from || !to) return [];
  const out = [];
  const cur = new Date(from.getTime());
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to.getTime());
  end.setHours(0, 0, 0, 0);
  while (cur.getTime() <= end.getTime()) {
    out.push(formatDDMMAAAA(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function getSupabaseClient() {
  const url = env('SUPABASE_URL').trim();
  const key = env('SUPABASE_SERVICE_KEY').trim() || env('SUPABASE_KEY').trim();
  if (!url || !key) throw new Error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY/SUPABASE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'CompraAgil_VB/oc-scraper' } });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return JSON.parse(text);
}

async function fetchJsonWithRetry(url, { retries = 3, baseDelayMs = 400 } = {}) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fetchJson(url);
    } catch (e) {
      attempt += 1;
      const status = e && typeof e === 'object' ? e.status : undefined;
      // No reintentar 404: son OCs inexistentes/ocultas y se deben saltar.
      if (status === 404) throw e;
      if (attempt > retries) throw e;
      const wait = baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(wait);
    }
  }
}

function pick(o, keys) {
  for (const k of keys) {
    if (o && o[k] != null && String(o[k]).trim() !== '') return o[k];
  }
  return null;
}

function toNum(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).replace(/\$/g, '').replace(/\./g, '').replace(/,/g, '.').replace(/[^\d.]/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toTs(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isFinite(d.getTime())) return d.toISOString();
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [, dd, mm, yyyy, HH, MI, SS] = m;
    return new Date(`${yyyy}-${mm}-${dd}T${HH}:${MI}:${SS}Z`).toISOString();
  }
  return null;
}

function buildListUrl({ fechaDDMMAAAA, ticket }) {
  const u = new URL('https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json');
  u.searchParams.set('fecha', fechaDDMMAAAA);
  u.searchParams.set('ticket', ticket);
  return u.toString();
}

function buildDetailUrl({ codigoOc, ticket }) {
  const u = new URL('https://api.mercadopublico.cl/servicios/v1/publico/OrdenCompra.json');
  u.searchParams.set('codigo', codigoOc);
  u.searchParams.set('ticket', ticket);
  return u.toString();
}

function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.Listado)) return payload.Listado;
  if (payload && Array.isArray(payload.OrdenesCompra)) return payload.OrdenesCompra;
  if (payload && Array.isArray(payload.ListaOrdenesCompra)) return payload.ListaOrdenesCompra;
  return [];
}

function extractDetail(payload) {
  if (payload && payload.OrdenCompra) return payload.OrdenCompra;
  if (payload && Array.isArray(payload.Listado) && payload.Listado[0]) return payload.Listado[0];
  return payload;
}

function mapHeader(d) {
  const numero_oc = String(pick(d, ['numero_oc', 'NumeroOC', 'Codigo', 'CodigoOrden', 'OrdenCompra', 'NumeroOrden']) || '').trim();
  if (!numero_oc) return null;
  return {
    numero_oc,
    numero_licitacion: pick(d, ['numero_licitacion', 'NumeroLicitacion', 'CodigoLicitacion']),
    demandante: pick(d, ['demandante', 'Demandante', 'Organismo', 'OrganismoComprador', 'NombreOrganismo']),
    rut_demandante: pick(d, ['rut_demandante', 'RutDemandante', 'RutOrganismo', 'RutComprador']),
    unidad_compra: pick(d, ['unidad_compra', 'UnidadCompra', 'UnidadDeCompra', 'Unidad']),
    fecha_envio_oc: toTs(pick(d, ['fecha_envio_oc', 'FechaEnvioOC', 'FechaEnvio', 'Fecha'])),
    estado: pick(d, ['estado', 'Estado']),
    proveedor: pick(d, ['proveedor', 'Proveedor', 'RazonSocialProveedor', 'NombreProveedor']),
    rut_proveedor: pick(d, ['rut_proveedor', 'RutProveedor']),
    neto: toNum(pick(d, ['neto', 'Neto'])),
    iva: toNum(pick(d, ['iva', 'IVA'])),
    total: toNum(pick(d, ['total', 'Total'])),
    subtotal: toNum(pick(d, ['subtotal', 'SubTotal', 'Subtotal'])),
    raw_json: d
  };
}

function extractItems(d) {
  const items = pick(d, ['Items', 'items', 'Detalle', 'detalle', 'Lineas', 'lineas']);
  return Array.isArray(items) ? items : [];
}

function mapItem(it, numero_oc) {
  return {
    numero_oc,
    codigo_producto: pick(it, ['codigo_producto', 'CodigoProducto', 'Codigo', 'ProductoCodigo']),
    producto: pick(it, ['producto', 'Producto', 'NombreProducto', 'DescripcionProducto', 'Descripción', 'Descripcion']),
    cantidad: toNum(pick(it, ['cantidad', 'Cantidad'])),
    unidad: pick(it, ['unidad', 'Unidad']),
    precio_unitario: toNum(pick(it, ['precio_unitario', 'PrecioUnitario', 'Precio'])),
    descuento: toNum(pick(it, ['descuento', 'Descuento'])),
    cargos: toNum(pick(it, ['cargos', 'Cargos'])),
    valor_total: toNum(pick(it, ['valor_total', 'ValorTotal', 'Total'])),
    especificaciones: pick(it, ['especificaciones', 'Especificaciones', 'Detalle', 'Descripcion']),
    raw_json: it
  };
}

async function main() {
  const supabase = getSupabaseClient();
  const ticket = env('MP_API_TICKET').trim();
  if (!ticket) throw new Error('Falta MP_API_TICKET');

  const from = env('MP_OC_FROM').trim() || todayYYYYMMDD();
  const to = env('MP_OC_TO').trim() || from;
  const fechas = dateRangeDDMMAAAA(from, to);
  if (!fechas.length) throw new Error('Rango inválido. Usa MP_OC_FROM/MP_OC_TO en formato YYYY-MM-DD');

  const codigos = new Set();
  for (const fecha of fechas) {
    const url = buildListUrl({ fechaDDMMAAAA: fecha, ticket });
    const payload = await fetchJson(url);
    for (const r of extractList(payload)) {
      const codigo = String(pick(r, ['numero_oc', 'NumeroOC', 'Codigo', 'CodigoOrden', 'OrdenCompra', 'NumeroOrden']) || '').trim();
      if (codigo) codigos.add(codigo);
    }
  }

  console.log(`[oc] codigos únicos: ${codigos.size} (${from}..${to})`);

  const headers = [];
  const itemsByOc = new Map();

  for (const codigoOc of codigos) {
    try {
      const url = buildDetailUrl({ codigoOc, ticket });
      const payload = await fetchJsonWithRetry(url, { retries: 3, baseDelayMs: 500 });
      const detail = extractDetail(payload);
      const header = mapHeader(detail);
      if (!header) continue;
      headers.push(header);
      const items = extractItems(detail).map((it) => mapItem(it, header.numero_oc));
      itemsByOc.set(header.numero_oc, items);
      // Micro pausa para evitar gatillar rate-limits del API
      await sleep(120);
    } catch (e) {
      if (e && typeof e === 'object' && e.status === 404) {
        console.warn(`[oc] detalle 404 (se omite): ${codigoOc}`);
        continue;
      }
      console.warn(`[oc] falló detalle ${codigoOc}: ${String(e?.message || e)}`);
    }
  }

  if (headers.length) {
    const { error } = await supabase.from('ordenes_compra').upsert(headers, { onConflict: 'numero_oc' });
    if (error) throw error;
  }

  let totalItems = 0;
  for (const [numero_oc, items] of itemsByOc.entries()) {
    // Idempotente: borrar e insertar ítems de la OC
    const del = await supabase.from('ordenes_compra_items').delete().eq('numero_oc', numero_oc);
    if (del.error) throw del.error;
    if (items.length) {
      const ins = await supabase.from('ordenes_compra_items').insert(items);
      if (ins.error) throw ins.error;
      totalItems += items.length;
    }
  }

  console.log(`[oc] upsert headers=${headers.length} refresh items=${totalItems}`);
}

main().catch((e) => {
  console.error('[oc] fallo:', e);
  process.exitCode = 1;
});

