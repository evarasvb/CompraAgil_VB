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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function todayYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isDDMMAAAA(s) {
  return /^\d{8}$/.test(String(s || ''));
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

function dateRangeInclusive(fromYYYYMMDD, toYYYYMMDD) {
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
    else if (a === '--max-pages') args.maxPages = Number.parseInt(argv[++i] || '', 10); // compat (no se usa en endpoints oficiales)
    else if (a === '--max-codigos') args.maxPages = Number.parseInt(argv[++i] || '', 10);
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

function getSupabaseClient() {
  const url = env('SUPABASE_URL').trim();
  const key = env('SUPABASE_SERVICE_KEY').trim() || env('SUPABASE_KEY').trim();
  if (!url || !key) throw new Error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY/SUPABASE_KEY');
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

function buildOcListUrl({ fechaDDMMAAAA, ticket }) {
  // Endpoint oficial: listar por fecha (ddmmaaaa)
  const u = new URL('https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json');
  u.searchParams.set('fecha', fechaDDMMAAAA);
  u.searchParams.set('ticket', ticket);
  return u.toString();
}

function buildOcDetailUrl({ codigoOc, ticket }) {
  // Endpoint oficial: detalle OC por código
  const u = new URL('https://api.mercadopublico.cl/servicios/v1/publico/OrdenCompra.json');
  u.searchParams.set('codigo', codigoOc);
  u.searchParams.set('ticket', ticket);
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
      if (res.status === 404) return null; // “Recurso no encontrado.” => tratamos como “sin datos”
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
  if (payload && Array.isArray(payload.OrdenesCompra)) return payload.OrdenesCompra;
  if (payload && Array.isArray(payload.ListaOrdenesCompra)) return payload.ListaOrdenesCompra;
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

function isMissingTableError(err) {
  const code = err?.code ? String(err.code) : '';
  const msg = err?.message ? String(err.message) : '';
  return code === 'PGRST205' || msg.includes("Could not find the table 'public.");
}

async function main() {
  const args = parseArgs(process.argv);
  const supabase = getSupabaseClient();

  const ticket = env('MP_API_TICKET', '').trim();
  if (!ticket) throw new Error('Falta MP_API_TICKET para consultar la API oficial de órdenes de compra.');

  const fromRaw = (args.from || env('MP_OC_FROM', '').trim() || todayYYYYMMDD());
  const toRaw = (args.to || env('MP_OC_TO', '').trim() || todayYYYYMMDD());

  // Soporta:
  // - YYYY-MM-DD (recomendado) => se itera rango y se convierte a ddmmaaaa
  // - ddmmaaaa => se trata como una sola fecha
  const fechasDDMMAAAA = isDDMMAAAA(fromRaw) && isDDMMAAAA(toRaw)
    ? dateRangeInclusive(
        `${fromRaw.slice(4)}-${fromRaw.slice(2, 4)}-${fromRaw.slice(0, 2)}`,
        `${toRaw.slice(4)}-${toRaw.slice(2, 4)}-${toRaw.slice(0, 2)}`
      )
    : isDDMMAAAA(fromRaw) && !toRaw
      ? [fromRaw]
      : dateRangeInclusive(fromRaw, toRaw);

  if (!fechasDDMMAAAA.length) {
    throw new Error('Rango de fechas inválido. Usa YYYY-MM-DD (recomendado) o ddmmaaaa.');
  }

  console.log(`[OC] Fechas: ${fechasDDMMAAAA[0]} -> ${fechasDDMMAAAA[fechasDDMMAAAA.length - 1]} (${fechasDDMMAAAA.length} días). dryRun=${args.dryRun ? 'YES' : 'NO'}`);

  const allHeaders = [];
  const itemsByOc = new Map();

  // 1) Listar OCs por fecha
  const ocCodigos = new Set();
  for (const fecha of fechasDDMMAAAA) {
    const url = buildOcListUrl({ fechaDDMMAAAA: fecha, ticket });
    console.log(`[OC] List fecha=${fecha}: ${url}`);
    const payload = await fetchJsonWithRetries(url, { retries: 3, sleepMs: 1400 });
    if (!payload) {
      console.log(`[OC] fecha=${fecha}: 0 registros (404/no data)`);
      continue;
    }
    const list = extractOcList(payload);
    console.log(`[OC] fecha=${fecha}: ${list.length} registros`);
    for (const raw of list) {
      const codigo =
        normalizeText(pickFirst(raw, ['numero_oc', 'NumeroOC', 'Codigo', 'CodigoOrden', 'OrdenCompra', 'NumeroOrden', 'id']));
      if (codigo) ocCodigos.add(codigo);
    }
  }

  const defaultMax = envInt('MP_OC_MAX_CODIGOS', 200);
  const maxCodigos = Number.isFinite(args.maxPages) && args.maxPages > 0 ? args.maxPages : defaultMax;
  const delayMs = envInt('MP_OC_DELAY_MS', 300);

  const codigosOrdenados = Array.from(ocCodigos).sort();
  const codigosLimitados = maxCodigos ? codigosOrdenados.slice(0, maxCodigos) : codigosOrdenados;

  console.log(
    `[OC] Códigos únicos a detallar: ${ocCodigos.size}. Procesando: ${codigosLimitados.length}. delayMs=${delayMs}`
  );

  // 2) Detalle por OC (cabecera + items)
  for (const codigoOc of codigosLimitados) {
    const url = buildOcDetailUrl({ codigoOc, ticket });
    try {
      const payload = await fetchJsonWithRetries(url, { retries: 3, sleepMs: 1400 });
      if (!payload) {
        console.warn(`[OC] Detalle ${codigoOc}: 404/no data`);
        continue;
      }

      // Flexible: a veces viene envuelto
      const detailObj =
        (payload && payload.OrdenCompra) ||
        (payload && Array.isArray(payload.Listado) && payload.Listado[0]) ||
        payload;

      const header = mapOcHeader(detailObj);
      if (!header) continue;
      allHeaders.push(header);

      const rawItems = extractOcItems(detailObj);
      const mappedItems = rawItems.map((it) => mapOcItem(it, header.numero_oc)).filter((x) => x.numero_oc);
      itemsByOc.set(header.numero_oc, mappedItems);
    } catch (e) {
      console.warn(`[OC] Falló detalle ${codigoOc}: ${String(e?.message || e)}`);
    } finally {
      if (delayMs > 0) await sleep(delayMs);
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

  try {
    await upsertOrdenesCompra(supabase, headers);
    console.log(`[OC] Upsert OK: ${headers.length} filas en ordenes_compra`);

    // items: refresh por OC
    let itemCount = 0;
    for (const [numero_oc, items] of itemsByOc.entries()) {
      await refreshItemsForOc(supabase, numero_oc, items);
      itemCount += items.length;
    }
    console.log(`[OC] Refresh items OK: ${itemCount} filas en ordenes_compra_items`);
  } catch (e) {
    if (isMissingTableError(e)) {
      console.warn(
        "[OC] ⚠️  Las tablas de Supabase no están aplicadas (schema). Ejecuta el workflow 'Apply Supabase schema (manual)' y reintenta."
      );
      return;
    }
    throw e;
  }
}

main().catch((err) => {
  if (isMissingTableError(err)) {
    console.warn(
      "[OC] ⚠️  Las tablas de Supabase no están aplicadas (schema). Ejecuta el workflow 'Apply Supabase schema (manual)' y reintenta."
    );
    process.exitCode = 0;
    return;
  }
  console.error('[OC] Fallo fatal:', err);
  process.exitCode = 1;
});

