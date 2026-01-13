require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

function env(name, fallback = '') {
  const v = process.env[name];
  return v == null ? fallback : String(v);
}

function envInt(name, fallback) {
  const raw = env(name, '');
  if (!raw.trim()) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function todayYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toIsoDateOnly(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseArgs(argv) {
  const args = {
    from: null,
    to: null,
    maxPages: null,
    dryRun: false
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') args.from = argv[++i] || null;
    else if (a === '--to') args.to = argv[++i] || null;
    else if (a === '--max-pages') args.maxPages = Number.parseInt(argv[++i] || '', 10);
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

function getSupabaseClient() {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_KEY');
  if (!url || !key) throw new Error('Faltan SUPABASE_URL y/o SUPABASE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function toNumberOrNull(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v)
    .replace(/\$/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.]/g, '')
    .trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function normalizeTimestamp(v) {
  // Acepta: ISO, "DD-MM-YYYY HH:mm:ss", "YYYY-MM-DD HH:mm:ss", etc.
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isFinite(d.getTime())) return d.toISOString().replace('T', ' ').replace('Z', '');
  // DD-MM-YYYY HH:mm:ss
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [, dd, mm, yyyy, HH, MI, SS] = m;
    return `${yyyy}-${mm}-${dd} ${HH}:${MI}:${SS}`;
  }
  return null;
}

function buildOcUrl({ endpointTemplate, ticket, from, to, page }) {
  if (endpointTemplate && endpointTemplate.includes('{')) {
    return endpointTemplate
      .replaceAll('{ticket}', encodeURIComponent(ticket || ''))
      .replaceAll('{from}', encodeURIComponent(from))
      .replaceAll('{to}', encodeURIComponent(to))
      .replaceAll('{page}', encodeURIComponent(String(page)));
  }

  // Fallback: URL default (debe ajustarse si tu endpoint real difiere)
  // Nota: el API de MercadoPúblico suele exponer endpoints JSON bajo /servicios/v1/publico/.
  const base = endpointTemplate && endpointTemplate.startsWith('http')
    ? endpointTemplate
    : 'https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json';

  const u = new URL(base);
  if (ticket) u.searchParams.set('ticket', ticket);
  u.searchParams.set('fecha_desde', from);
  u.searchParams.set('fecha_hasta', to);
  u.searchParams.set('pagina', String(page));
  return u.toString();
}

async function fetchJsonWithRetries(url, { retries = 3, sleepMs = 1200 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': 'CompraAgil_VB/oc-scraper',
          accept: 'application/json'
        }
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, sleepMs * attempt));
        continue;
      }
    }
  }
  throw lastErr;
}

function extractOcList(payload) {
  // Flexible: payload puede venir como {Listado: [...]}, {Ordenes: [...]}, o array directo.
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.Listado)) return payload.Listado;
  if (payload && Array.isArray(payload.Ordenes)) return payload.Ordenes;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && String(obj[k]).trim() !== '') return obj[k];
  }
  return null;
}

function mapOcHeader(raw) {
  const numero_oc = normalizeText(pickFirst(raw, ['numero_oc', 'NumeroOC', 'Codigo', 'CodigoOrden', 'OrdenCompra', 'NumeroOrden', 'id'])) || null;
  if (!numero_oc) return null;

  return {
    numero_oc,
    numero_licitacion: normalizeText(pickFirst(raw, ['numero_licitacion', 'NumeroLicitacion', 'CodigoLicitacion'])),
    demandante: normalizeText(pickFirst(raw, ['demandante', 'Demandante', 'Organismo', 'OrganismoComprador', 'NombreOrganismo'])),
    rut_demandante: normalizeText(pickFirst(raw, ['rut_demandante', 'RutDemandante', 'RutOrganismo', 'RutComprador'])),
    unidad_compra: normalizeText(pickFirst(raw, ['unidad_compra', 'UnidadCompra', 'UnidadDeCompra', 'Unidad'])),
    fecha_envio_oc: normalizeTimestamp(pickFirst(raw, ['fecha_envio_oc', 'FechaEnvioOC', 'FechaEnvio', 'Fecha'])),
    estado: normalizeText(pickFirst(raw, ['estado', 'Estado'])),
    proveedor: normalizeText(pickFirst(raw, ['proveedor', 'Proveedor', 'RazonSocialProveedor', 'NombreProveedor'])),
    rut_proveedor: normalizeText(pickFirst(raw, ['rut_proveedor', 'RutProveedor'])),
    neto: toNumberOrNull(pickFirst(raw, ['neto', 'Neto'])),
    iva: toNumberOrNull(pickFirst(raw, ['iva', 'IVA'])),
    total: toNumberOrNull(pickFirst(raw, ['total', 'Total'])),
    subtotal: toNumberOrNull(pickFirst(raw, ['subtotal', 'SubTotal', 'Subtotal']))
  };
}

function extractOcItems(raw) {
  const items = pickFirst(raw, ['Items', 'items', 'Detalle', 'detalle', 'Lineas', 'lineas']);
  if (!Array.isArray(items)) return [];
  return items;
}

function mapOcItem(rawItem, numero_oc) {
  return {
    // id: omitimos para que la DB use default gen_random_uuid()
    numero_oc,
    codigo_producto: normalizeText(pickFirst(rawItem, ['codigo_producto', 'CodigoProducto', 'Codigo', 'ProductoCodigo'])),
    producto: normalizeText(pickFirst(rawItem, ['producto', 'Producto', 'NombreProducto', 'DescripcionProducto', 'Descripción', 'Descripcion'])),
    cantidad: toNumberOrNull(pickFirst(rawItem, ['cantidad', 'Cantidad'])),
    unidad: normalizeText(pickFirst(rawItem, ['unidad', 'Unidad'])),
    precio_unitario: toNumberOrNull(pickFirst(rawItem, ['precio_unitario', 'PrecioUnitario', 'Precio'])),
    descuento: toNumberOrNull(pickFirst(rawItem, ['descuento', 'Descuento'])),
    cargos: toNumberOrNull(pickFirst(rawItem, ['cargos', 'Cargos'])),
    valor_total: toNumberOrNull(pickFirst(rawItem, ['valor_total', 'ValorTotal', 'Total'])),
    especificaciones: normalizeText(
      pickFirst(rawItem, [
        'especificaciones',
        'Especificaciones',
        'EspecificacionesComprador',
        'EspecificacionesProveedor',
        'Detalle'
      ])
    )
  };
}

async function upsertOrdenesCompra(supabase, headers) {
  if (!headers.length) return;
  const { error } = await supabase.from('ordenes_compra').upsert(headers, { onConflict: 'numero_oc' });
  if (error) throw error;
}

async function refreshItemsForOc(supabase, numero_oc, items) {
  // Estrategia idempotente sin constraints extra:
  // 1) borrar items existentes de la OC
  // 2) insertar items actuales
  const del = await supabase.from('ordenes_compra_items').delete().eq('numero_oc', numero_oc);
  if (del.error) throw del.error;
  if (!items.length) return;
  const ins = await supabase.from('ordenes_compra_items').insert(items);
  if (ins.error) throw ins.error;
}

async function main() {
  const args = parseArgs(process.argv);
  const supabase = getSupabaseClient();

  const endpointTemplate = env('MP_OC_ENDPOINT', '').trim();
  const ticket = env('MP_API_TICKET', '').trim();

  const from = (args.from || env('MP_OC_FROM', '').trim() || todayYYYYMMDD());
  const to = (args.to || env('MP_OC_TO', '').trim() || todayYYYYMMDD());

  const maxPages = Number.isFinite(args.maxPages) ? args.maxPages : envInt('MP_OC_MAX_PAGES', 10);

  if (!endpointTemplate && !ticket) {
    throw new Error('Falta MP_OC_ENDPOINT o MP_API_TICKET para consultar el endpoint de órdenes de compra.');
  }

  console.log(`[OC] Rango: ${from} -> ${to}. maxPages=${maxPages}. dryRun=${args.dryRun ? 'YES' : 'NO'}`);

  const allHeaders = [];
  const itemsByOc = new Map();

  for (let page = 1; page <= maxPages; page++) {
    const url = buildOcUrl({ endpointTemplate, ticket, from, to, page });
    console.log(`[OC] Fetch page ${page}: ${url}`);

    const payload = await fetchJsonWithRetries(url, { retries: 3, sleepMs: 1400 });
    const list = extractOcList(payload);
    console.log(`[OC] Page ${page}: ${list.length} registros`);
    if (!list.length) break;

    for (const raw of list) {
      const header = mapOcHeader(raw);
      if (!header) continue;
      allHeaders.push(header);

      const rawItems = extractOcItems(raw);
      const mappedItems = rawItems.map((it) => mapOcItem(it, header.numero_oc)).filter((x) => x.numero_oc);
      itemsByOc.set(header.numero_oc, mappedItems);
    }
  }

  // Dedup headers por numero_oc (último gana)
  const byId = new Map();
  for (const h of allHeaders) byId.set(h.numero_oc, h);
  const headers = Array.from(byId.values());

  console.log(`[OC] Headers únicos: ${headers.length}. OCs con items: ${itemsByOc.size}`);

  if (args.dryRun) {
    const sample = headers.slice(0, 3).map((h) => ({ numero_oc: h.numero_oc, total: h.total, demandante: h.demandante }));
    console.log('[OC][dry-run] Sample headers:', sample);
    return;
  }

  await upsertOrdenesCompra(supabase, headers);
  console.log(`[OC] Upsert OK: ${headers.length} filas en ordenes_compra`);

  // items: refresh por OC
  let itemCount = 0;
  for (const [numero_oc, items] of itemsByOc.entries()) {
    await refreshItemsForOc(supabase, numero_oc, items);
    itemCount += items.length;
  }
  console.log(`[OC] Refresh items OK: ${itemCount} filas en ordenes_compra_items`);
}

main().catch((err) => {
  console.error('[OC] Fallo fatal:', err);
  process.exitCode = 1;
});

