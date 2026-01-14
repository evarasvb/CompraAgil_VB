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
const { logSystemEvent } = require('./system_logs');

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

  const existing = await supabase
    .from('pending_extension_sync')
    .select('id, attempts')
    .eq('kind', kind)
    .eq('identifier', identifier)
    .maybeSingle();

  if (existing.error) {
    console.warn(`[lic-api] warning: no pude consultar pending_extension_sync (${kind}/${identifier}): ${existing.error.message}`);
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
    if (upd.error) console.warn(`[lic-api] warning: no pude actualizar pending_extension_sync: ${upd.error.message}`);
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
    if (ins.error) console.warn(`[lic-api] warning: no pude insertar pending_extension_sync: ${ins.error.message}`);
  }
}

async function logScraperHealth(supabase, { tipo_scraper, status, duracion_ms, items_obtenidos, errores, meta } = {}) {
  if (!supabase) return;
  const row = {
    tipo_scraper: String(tipo_scraper || 'lic_api'),
    status: String(status || 'ok'),
    duracion_ms: duracion_ms != null ? Number(duracion_ms) : null,
    items_obtenidos: items_obtenidos != null ? Number(items_obtenidos) : null,
    errores: errores ? String(errores).slice(0, 2000) : null,
    meta: meta || null
  };
  const ins = await supabase.from('scraper_health_log').insert(row);
  if (ins.error) console.warn(`[lic-api] warning: no pude insertar scraper_health_log: ${ins.error.message}`);

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

function buildListUrl({ fechaDDMMAAAA, ticket, estado }) {
  const u = new URL('https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json');
  u.searchParams.set('fecha', fechaDDMMAAAA);
  if (estado) u.searchParams.set('estado', estado);
  u.searchParams.set('ticket', ticket);
  return u.toString();
}

function buildDetailUrl({ codigo, ticket }) {
  const u = new URL('https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json');
  u.searchParams.set('codigo', codigo);
  u.searchParams.set('ticket', ticket);
  return u.toString();
}

function extractListado(payload) {
  if (payload && Array.isArray(payload.Listado)) return payload.Listado;
  if (payload && payload.Listado && Array.isArray(payload.Listado.Licitacion)) return payload.Listado.Licitacion;
  if (payload && Array.isArray(payload.licitaciones)) return payload.licitaciones;
  if (Array.isArray(payload)) return payload;
  return [];
}

function pick(o, keys) {
  for (const k of keys) {
    if (o && o[k] != null && String(o[k]).trim() !== '') return o[k];
  }
  return null;
}

function toTs(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isFinite(d.getTime())) return d.toISOString();
  // dd-mm-yyyy hh:mm:ss
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m) {
    const [, dd, mm, yyyy, HH, MI, SS] = m;
    return new Date(`${yyyy}-${mm}-${dd}T${HH}:${MI}:${SS}Z`).toISOString();
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

function mapApiRowToMinimal(raw, detailMaybe) {
  const d = detailMaybe || raw;
  const codigo = String(pick(d, ['CodigoExterno', 'codigo', 'Codigo', 'CodigoLicitacion', 'CodigoLicitacionMercadoPublico']) || '').trim();
  if (!codigo) return null;

  const titulo = pick(d, ['Nombre', 'nombre', 'Titulo', 'titulo']);
  const organismo = pick(d, ['NombreOrganismo', 'Organismo', 'organismo']);
  const descripcion = pick(d, ['Descripcion', 'descripcion']);
  const estado = pick(d, ['Estado', 'estado', 'CodigoEstado', 'codigo_estado']);
  const fecha_publicacion = toTs(pick(d, ['FechaPublicacion', 'fecha_publicacion', 'FechaCreacion', 'FechaInicio']));
  const fecha_cierre = toTs(pick(d, ['FechaCierre', 'fecha_cierre', 'FechaFinal', 'FechaAdjudicacion', 'FechaCierreLicitacion']));
  const link_detalle =
    pick(d, ['Url', 'URL', 'Link', 'link_detalle']) ||
    `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?qs=${encodeURIComponent(codigo)}`;
  const presupuesto_estimado = toNum(pick(d, ['MontoEstimado', 'PresupuestoEstimado', 'monto_estimado', 'presupuesto_estimado']));

  return {
    codigo,
    titulo: titulo ?? null,
    organismo: organismo ?? null,
    descripcion: descripcion ?? null,
    estado: estado != null ? String(estado) : null,
    fecha_publicacion,
    fecha_cierre,
    link_detalle: link_detalle ? String(link_detalle) : null,
    presupuesto_estimado,
    raw_json: d,
    last_scraped_at: toIsoNow()
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
  try {
    await logSystemEvent('INFO', 'SCRAPER', 'Inicio del ciclo de scraping (Licitaciones API)', null);
    const from = env('MP_LIC_FROM').trim() || todayYYYYMMDD();
    const to = env('MP_LIC_TO').trim() || from;
    const estado = env('MP_LIC_ESTADO').trim() || '';
    const fechas = dateRangeDDMMAAAA(from, to);
    if (!fechas.length) throw new Error('Rango inválido. Usa MP_LIC_FROM/MP_LIC_TO en formato YYYY-MM-DD');

    const codigos = new Set();
    for (const fecha of fechas) {
      const url = buildListUrl({ fechaDDMMAAAA: fecha, ticket, estado });
      try {
        const payload = await fetchJsonWithFallback(url, {
          context: { phase: 'lic_list', fecha, estado },
          supabase,
          pendingKind: 'lic_list',
          pendingIdentifier: `${fecha}|${estado || ''}`.slice(0, 200)
        });
        const listado = extractListado(payload);
        for (const r of listado) {
          const codigo = String(pick(r, ['CodigoExterno', 'codigo', 'Codigo', 'CodigoLicitacion']) || '').trim();
          if (codigo) codigos.add(codigo);
        }
      } catch (e) {
        console.warn(`[lic-api] falló listado fecha=${fecha}: ${String(e?.message || e)}`);
      }

      // Entre “páginas” (fechas): 5–15s con jitter
      await sleepRandomWithJitter(
        config.antiBlock.pageDelayMs.min,
        config.antiBlock.pageDelayMs.max,
        config.antiBlock.jitterPct
      );
    }

    console.log(`[lic-api] codigos únicos: ${codigos.size} (${from}..${to}) estado=${estado || '(sin filtro)'}`);
    await logSystemEvent('INFO', 'SCRAPER', `Se encontraron ${codigos.size} licitaciones (códigos únicos)`, {
      from,
      to,
      estado: estado || null
    });

    // Cache inteligente: si ya existe y fue scrapeado hace <30min, saltar detalle.
    // No re-scrapear licitaciones cerradas.
    // Si está viejo, marcar como "stale" y NO re-scrapear inmediatamente (ver schema).
    const freshnessMs = 30 * 60 * 1000;
    const cutoffMs = Date.now() - freshnessMs;
    const codigosArr = Array.from(codigos);
    const fresh = new Set();
    const closed = new Set();
    const staleCandidates = [];
    for (let i = 0; i < codigosArr.length; i += 200) {
      const batch = codigosArr.slice(i, i + 200);
      const { data, error } = await supabase
        .from('licitaciones_api')
        .select('codigo,last_scraped_at,fecha_cierre,stale,stale_marked_at')
        .in('codigo', batch);
      if (error) {
        console.warn(`[lic-api] warning: no pude consultar cache (licitaciones_api): ${error.message}`);
        break;
      }
      for (const row of data || []) {
        const cierreMs = row?.fecha_cierre ? new Date(row.fecha_cierre).getTime() : NaN;
        if (Number.isFinite(cierreMs) && cierreMs < Date.now()) {
          closed.add(row.codigo);
          continue;
        }
        const t = row?.last_scraped_at ? new Date(row.last_scraped_at).getTime() : NaN;
        if (Number.isFinite(t) && t >= cutoffMs) {
          fresh.add(row.codigo);
          continue;
        }
        if (row?.codigo) staleCandidates.push(row);
      }
    }

    const rows = [];
    for (const codigo of codigos) {
      if (fresh.has(codigo)) continue;
      if (closed.has(codigo)) continue;

      const staleRow = staleCandidates.find((r) => r.codigo === codigo);
      if (staleRow) {
        const staleMarkedAt = staleRow?.stale_marked_at ? new Date(staleRow.stale_marked_at).getTime() : NaN;
        const rescrapeAfterMs = Number(env('STALE_RESCRAPE_AFTER_MIN', '60')) * 60 * 1000;
        const isStale = Boolean(staleRow?.stale);
        const canRescrape = isStale && Number.isFinite(staleMarkedAt) && Date.now() - staleMarkedAt >= rescrapeAfterMs;
        if (!canRescrape) {
          if (!isStale) {
            const upd = await supabase
              .from('licitaciones_api')
              .update({ stale: true, stale_marked_at: new Date().toISOString() })
              .eq('codigo', codigo);
            if (upd.error) console.warn(`[lic-api] warning: no pude marcar stale ${codigo}: ${upd.error.message}`);
          }
          continue;
        }
      }
      try {
        const url = buildDetailUrl({ codigo, ticket });
        const payload = await fetchJsonWithFallback(url, {
          context: { phase: 'lic_detail', codigo },
          supabase,
          pendingKind: 'lic_detail',
          pendingIdentifier: codigo
        });
        // Muchos responses incluyen Listado/Licitacion; tomamos el primer objeto de detalle.
        const list = extractListado(payload);
        const detail = list && list.length ? list[0] : payload;
        const mapped = mapApiRowToMinimal({}, detail);
        if (mapped) rows.push(mapped);
      } catch (e) {
        console.warn(`[lic-api] falló detalle ${codigo}: ${String(e?.message || e)}`);
      }
    }

    if (rows.length) {
      const { error } = await supabase.from('licitaciones_api').upsert(rows, { onConflict: 'codigo' });
      if (error) throw error;
    }

    console.log(`[lic-api] upsert filas=${rows.length}`);
    console.log(`[lic-api] métricas anti-bloqueo: ${JSON.stringify(getBlockMetricsSnapshot())}`);
    itemsObtenidos = rows.length;
    await logSystemEvent('SUCCESS', 'SCRAPER', 'Ciclo finalizado correctamente (Licitaciones API)', { processed: rows.length });
  } catch (e) {
    status = 'fail';
    errores = String(e?.message || e);
    await logSystemEvent('ERROR', 'SCRAPER', 'Fallo crítico en ejecución (Licitaciones API)', { error: errores });
    throw e;
  } finally {
    const duracionMs = Date.now() - runStartedAt;
    await logScraperHealth(supabase, {
      tipo_scraper: 'lic_api',
      status,
      duracion_ms: duracionMs,
      items_obtenidos: itemsObtenidos,
      errores,
      meta: { anti_block: getBlockMetricsSnapshot() }
    });
    await closeFallbackBrowser();
  }
}

main().catch((e) => {
  console.error('[lic-api] fallo:', e);
  process.exitCode = 1;
});

