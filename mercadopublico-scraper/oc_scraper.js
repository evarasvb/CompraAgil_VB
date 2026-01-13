require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const { sleepRandomWithJitter, toIsoNow } = require('./utils');
const {
  fetchJsonResilient,
  createStealthBrowser,
  fetchJsonViaPuppeteer,
  isRetryableForFallback,
  getBlockMetricsSnapshot
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
        status: 'pending',
        completed_at: null,
        last_error: null,
        payload: null,
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
      status: 'pending',
      attempts: 1,
      first_seen_at: now,
      last_attempt_at: now
    });
    if (ins.error) console.warn(`[oc] warning: no pude insertar pending_extension_sync: ${ins.error.message}`);
  }
}

async function logScraperHealth(supabase, { tipo_scraper, status, duracion_ms, items_obtenidos, errores, meta } = {}) {
  if (!supabase) return;
  const row = {
    tipo_scraper: String(tipo_scraper || 'oc_api'),
    status: String(status || 'ok'),
    duracion_ms: duracion_ms != null ? Number(duracion_ms) : null,
    items_obtenidos: items_obtenidos != null ? Number(items_obtenidos) : null,
    errores: errores ? String(errores).slice(0, 2000) : null,
    meta: meta || null
  };
  const ins = await supabase.from('scraper_health_log').insert(row);
  if (ins.error) console.warn(`[oc] warning: no pude insertar scraper_health_log: ${ins.error.message}`);

  // Alerta si hay 5 fallos consecutivos
  if (row.status === 'fail') {
    const last = await supabase
      .from('scraper_health_log')
      .select('status,created_at')
      .eq('tipo_scraper', row.tipo_scraper)
      .order('created_at', { ascending: false })
      .limit(5);
    if (!last.error) {
      const statuses = (last.data || []).map((r) => r.status);
      const allFail = statuses.length === 5 && statuses.every((s) => s === 'fail');
      if (allFail) {
        await supabase.from('scraper_health_log').insert({
          tipo_scraper: row.tipo_scraper,
          status: 'alert',
          errores: '5 fallos consecutivos detectados',
          meta: { window: 'last_5', statuses }
        });
        console.warn(`[ALERTA] 5 fallos consecutivos en ${row.tipo_scraper}`);
      }
    }
  }
}

async function fetchJsonWithFallback(url, { context, supabase, pendingKind, pendingIdentifier } = {}) {
  let browser = fetchJsonWithFallback._browser || null;

  try {
    // Importante: modo "rápido" para fallback (no quemar 5*min antes de ir a Puppeteer)
    return await fetchJsonResilient(url, { context, maxAttempts: 1 });
  } catch (e) {
    if (!isRetryableForFallback(e)) throw e;

    const status = e?.meta?.status;
    console.warn(
      `[FALLBACK] API falló${status ? ` con ${status}` : ''}, cambiando a Puppeteer... (${String(e?.message || e)})`
    );
    try {
      if (!browser) {
        browser = await createStealthBrowser({ headless: true });
        fetchJsonWithFallback._browser = browser;
      }
      return await fetchJsonViaPuppeteer(browser, url, { context });
    } catch (e2) {
      console.warn(`[FALLBACK] API+Puppeteer fallaron, enviando a pending_extension_sync... (${String(e2?.message || e2)})`);
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

  const runStartedAt = Date.now();
  let status = 'ok';
  let errores = null;
  let itemsObtenidos = 0;
  let headersObtenidos = 0;
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

    // Cache inteligente: si ya existe y fue scrapeado hace <30min, saltar detalle.
    // Si está viejo, marcar como "stale" y NO re-scrapear inmediatamente (ver schema).
    const freshnessMs = 30 * 60 * 1000;
    const cutoffMs = Date.now() - freshnessMs;
    const codigosArr = Array.from(codigos);
    const fresh = new Set();
    const staleCandidates = [];
    for (let i = 0; i < codigosArr.length; i += 200) {
      const batch = codigosArr.slice(i, i + 200);
      const { data, error } = await supabase
        .from('ordenes_compra')
        .select('numero_oc,last_scraped_at,stale,stale_marked_at')
        .in('numero_oc', batch);
      if (error) {
        console.warn(`[oc] warning: no pude consultar cache (ordenes_compra): ${error.message}`);
        break;
      }
      for (const row of data || []) {
        const t = row?.last_scraped_at ? new Date(row.last_scraped_at).getTime() : NaN;
        if (Number.isFinite(t) && t >= cutoffMs) {
          fresh.add(row.numero_oc);
          continue;
        }
        // si está viejo, lo marcamos stale (y lo saltamos en esta corrida) salvo que ya lleve
        // suficiente tiempo stale para reintentar.
        if (row?.numero_oc) staleCandidates.push(row);
      }
    }

    const headers = [];
    const itemsByOc = new Map();

    for (const codigoOc of codigos) {
      if (fresh.has(codigoOc)) continue;

      const staleRow = staleCandidates.find((r) => r.numero_oc === codigoOc);
      if (staleRow) {
        const staleMarkedAt = staleRow?.stale_marked_at ? new Date(staleRow.stale_marked_at).getTime() : NaN;
        const rescrapeAfterMs = Number(env('STALE_RESCRAPE_AFTER_MIN', '60')) * 60 * 1000;
        const isStale = Boolean(staleRow?.stale);
        const canRescrape = isStale && Number.isFinite(staleMarkedAt) && Date.now() - staleMarkedAt >= rescrapeAfterMs;
        if (!canRescrape) {
          if (!isStale) {
            const upd = await supabase
              .from('ordenes_compra')
              .update({ stale: true, stale_marked_at: new Date().toISOString() })
              .eq('numero_oc', codigoOc);
            if (upd.error) console.warn(`[oc] warning: no pude marcar stale ${codigoOc}: ${upd.error.message}`);
          }
          continue;
        }
      }

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

    headersObtenidos = headers.length;
    itemsObtenidos = totalItems;
    console.log(`[oc] upsert headers=${headers.length} refresh items=${totalItems}`);
    console.log(`[oc] métricas anti-bloqueo: ${JSON.stringify(getBlockMetricsSnapshot())}`);
  } catch (e) {
    status = 'fail';
    errores = String(e?.message || e);
    throw e;
  } finally {
    const duracionMs = Date.now() - runStartedAt;
    await logScraperHealth(supabase, {
      tipo_scraper: 'oc_api',
      status,
      duracion_ms: duracionMs,
      items_obtenidos: headersObtenidos,
      errores,
      meta: { items_lineas: itemsObtenidos, anti_block: getBlockMetricsSnapshot() }
    });
    await closeFallbackBrowser();
  }
}

main().catch((e) => {
  console.error('[oc] fallo:', e);
  process.exitCode = 1;
});

