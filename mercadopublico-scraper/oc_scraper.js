require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const { sleepRandomWithJitter, toIsoNow } = require('./utils');
const {
  fetchJsonResilient,
  createStealthBrowser,
  fetchJsonViaPuppeteer,
  isRetryableForFallback
} = require('./anti_block');

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

async function upsertPendingExtensionSync(supabase, row) {
  const now = new Date().toISOString();
  const kind = String(row.kind || '').trim();
  const identifier = String(row.identifier || '').trim();
  if (!kind || !identifier) return;

  // Incrementar attempts si existe (sin depender de RPC)
  const existing = await supabase
    .from('pending_extension_sync')
    .select('id, attempts')
    .eq('kind', kind)
    .eq('identifier', identifier)
    .maybeSingle();

  if (existing.error) {
    console.warn(`[oc] warning: no pude consultar pending_extension_sync (${kind}/${identifier}): ${existing.error.message}`);
    return;
  }

  if (existing.data?.id) {
    const attempts = Number(existing.data.attempts || 0) + 1;
    const upd = await supabase
      .from('pending_extension_sync')
      .update({
        url: row.url || null,
        reason: row.reason || null,
        context: row.context || null,
        attempts,
        last_attempt_at: now
      })
      .eq('id', existing.data.id);
    if (upd.error) console.warn(`[oc] warning: no pude actualizar pending_extension_sync: ${upd.error.message}`);
  } else {
    const ins = await supabase.from('pending_extension_sync').insert({
      kind,
      identifier,
      url: row.url || null,
      reason: row.reason || null,
      context: row.context || null,
      attempts: 1,
      first_seen_at: now,
      last_attempt_at: now
    });
    if (ins.error) console.warn(`[oc] warning: no pude insertar pending_extension_sync: ${ins.error.message}`);
  }
}

async function fetchJsonWithFallback(url, { context, supabase, pendingKind, pendingIdentifier } = {}) {
  let browser = fetchJsonWithFallback._browser || null;

  try {
    return await fetchJsonResilient(url, { context });
  } catch (e) {
    if (!isRetryableForFallback(e)) throw e;

    console.warn(`[oc] fallback a Puppeteer por error API: ${String(e?.message || e)}`);
    try {
      if (!browser) {
        browser = await createStealthBrowser({ headless: true });
        fetchJsonWithFallback._browser = browser;
      }
      return await fetchJsonViaPuppeteer(browser, url, { context });
    } catch (e2) {
      console.warn(`[oc] fallback a extensión (API+Puppeteer fallaron): ${String(e2?.message || e2)}`);
      if (supabase && pendingKind && pendingIdentifier) {
        await upsertPendingExtensionSync(supabase, {
          kind: pendingKind,
          identifier: pendingIdentifier,
          url,
          reason: String(e2?.message || e2).slice(0, 500),
          context: context || null
        });
      }
      throw e2;
    }
  }
}

async function closeFallbackBrowser() {
  const browser = fetchJsonWithFallback._browser;
  fetchJsonWithFallback._browser = null;
  if (browser) {
    try {
      await browser.close();
    } catch (_) {}
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
    raw_json: d,
    last_scraped_at: toIsoNow()
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

  try {
    const from = env('MP_OC_FROM').trim() || todayYYYYMMDD();
    const to = env('MP_OC_TO').trim() || from;
    const fechas = dateRangeDDMMAAAA(from, to);
    if (!fechas.length) throw new Error('Rango inválido. Usa MP_OC_FROM/MP_OC_TO en formato YYYY-MM-DD');

    const codigos = new Set();
    for (const fecha of fechas) {
      const url = buildListUrl({ fechaDDMMAAAA: fecha, ticket });
      try {
        const payload = await fetchJsonWithFallback(url, {
          context: { phase: 'oc_list', fecha },
          supabase,
          pendingKind: 'oc_list',
          pendingIdentifier: fecha
        });
        for (const r of extractList(payload)) {
          const codigo = String(
            pick(r, ['numero_oc', 'NumeroOC', 'Codigo', 'CodigoOrden', 'OrdenCompra', 'NumeroOrden']) || ''
          ).trim();
          if (codigo) codigos.add(codigo);
        }
      } catch (e) {
        console.warn(`[oc] falló listado fecha=${fecha}: ${String(e?.message || e)}`);
      }

      // Entre “páginas” (fechas): 5–15s con jitter
      await sleepRandomWithJitter(
        config.antiBlock.pageDelayMs.min,
        config.antiBlock.pageDelayMs.max,
        config.antiBlock.jitterPct
      );
    }

    console.log(`[oc] codigos únicos: ${codigos.size} (${from}..${to})`);

    // Cache inteligente: si ya existe y fue scrapeado hace <1h, saltar detalle.
    const freshnessMs = 60 * 60 * 1000;
    const cutoffMs = Date.now() - freshnessMs;
    const codigosArr = Array.from(codigos);
    const fresh = new Set();
    for (let i = 0; i < codigosArr.length; i += 200) {
      const batch = codigosArr.slice(i, i + 200);
      const { data, error } = await supabase
        .from('ordenes_compra')
        .select('numero_oc,last_scraped_at')
        .in('numero_oc', batch);
      if (error) {
        console.warn(`[oc] warning: no pude consultar cache (ordenes_compra): ${error.message}`);
        break;
      }
      for (const row of data || []) {
        const t = row?.last_scraped_at ? new Date(row.last_scraped_at).getTime() : NaN;
        if (Number.isFinite(t) && t >= cutoffMs) fresh.add(row.numero_oc);
      }
    }

    const headers = [];
    const itemsByOc = new Map();

    for (const codigoOc of codigos) {
      if (fresh.has(codigoOc)) continue;
      const url = buildDetailUrl({ codigoOc, ticket });
      try {
        const payload = await fetchJsonWithFallback(url, {
          context: { phase: 'oc_detail', codigoOc },
          supabase,
          pendingKind: 'oc_detail',
          pendingIdentifier: codigoOc
        });
        const detail = extractDetail(payload);
        const header = mapHeader(detail);
        if (!header) continue;
        headers.push(header);
        const items = extractItems(detail).map((it) => mapItem(it, header.numero_oc));
        itemsByOc.set(header.numero_oc, items);
      } catch (e) {
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
  } finally {
    await closeFallbackBrowser();
  }
}

main().catch((e) => {
  console.error('[oc] fallo:', e);
  process.exitCode = 1;
});

