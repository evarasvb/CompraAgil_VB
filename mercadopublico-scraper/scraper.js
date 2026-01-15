require('dotenv').config();

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');
const { matchLicitacion } = require('./matcher_firmavb');

// Mitigar bloqueos anti-bot (CloudFront/WAF) ocultando señales de automatización.
puppeteer.use(StealthPlugin());

const config = require('./config');
const { parseDateCL, parseBudgetCLP, splitOrganismoDepartamento, sleepRandom, toIsoNow } = require('./utils');

// -----------------------------
// Anti-bloqueo (CloudFront/WAF)
// -----------------------------
// Requerimiento: rotar User-Agents entre Chrome 120-125.
const CHROME_UAS_120_125 = [
  // Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  // macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  // Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
];

function randomInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function pickRandom(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomViewport() {
  // Requerimiento: viewport aleatorio 1280-1920 de ancho
  const width = randomInt(1280, 1920);
  // Alturas plausibles (evita fingerprints raros)
  const height = Math.max(720, Math.min(1080, randomInt(Math.round(width * 0.56), Math.round(width * 0.75))));
  return { width, height };
}

function buildRealisticNavigationHeaders({ referer } = {}) {
  return {
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-site',
    'Sec-Fetch-User': '?1',
    ...(referer ? { Referer: referer } : {})
  };
}

async function applyAntiBlockProfile(page, { referer } = {}) {
  const ua = pickRandom(CHROME_UAS_120_125) || config.getRandomUserAgent();
  await page.setViewport(randomViewport());
  await page.setUserAgent(ua);
  await page.setExtraHTTPHeaders(buildRealisticNavigationHeaders({ referer }));
  return { ua };
}

function is403OrBlockError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('http 403') ||
    msg.includes('403') ||
    msg.includes('access denied') ||
    msg.includes('captcha') ||
    msg.includes('robot') ||
    msg.includes('bloqueo') ||
    msg.includes('blocked') ||
    msg.includes('waf')
  );
}

function parseArgs(argv) {
  const args = {
    test: false,
    testSimple: false,
    headed: false,
    from: null,
    to: null,
    pages: null,
    out: null,
    incremental: null
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--test') args.test = true;
    else if (a === '--test-simple') args.testSimple = true;
    else if (a === '--headed') args.headed = true;
    else if (a === '--from') args.from = argv[++i] || null;
    else if (a === '--to') args.to = argv[++i] || null;
    else if (a === '--pages') args.pages = Number.parseInt(argv[++i] || '', 10);
    else if (a === '--out') args.out = argv[++i] || null;
    else if (a === '--incremental') args.incremental = true;
    else if (a === '--no-incremental') args.incremental = false;
  }
  return args;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function envBool(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return defaultValue;
}

function formatDateYYYYMMDD(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseLocalIsoToDate(isoLocal) {
  if (!isoLocal) return null;
  const d = new Date(isoLocal); // ISO sin zona => local time
  return Number.isFinite(d.getTime()) ? d : null;
}

function resolveIncrementalMode(args) {
  // Prioridad: flag CLI -> env -> default false
  if (args.incremental === true) return true;
  if (args.incremental === false) return false;
  return envBool('INCREMENTAL_MODE', false);
}

function withConcurrencyLimit(limit) {
  let active = 0;
  const queue = [];

  const next = () => {
    active -= 1;
    if (queue.length) queue.shift()();
  };

  return async function run(task) {
    if (active >= limit) {
      await new Promise((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      next();
    }
  };
}

function buildUrl(pageNumber, params) {
  const url = new URL(config.baseUrl);
  const sp = new URLSearchParams({
    date_from: params.date_from,
    date_to: params.date_to,
    order_by: params.order_by,
    page_number: String(pageNumber),
    region: params.region,
    status: params.status
  });
  url.search = sp.toString();
  return url.toString();
}

async function withRetries(fn, { retries, onRetry }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt < retries && onRetry) await onRetry(err, attempt);
    }
  }
  throw lastErr;
}

function ts() {
  return new Date().toISOString();
}

function stringifyErr(err) {
  const msg = String(err?.message || err || '');
  return msg || 'Error desconocido';
}

async function waitForResults(page, { timeoutMs }) {
  // En CI evitamos delays largos: preferimos reintentar rápido + reload.
  const isCI = Boolean(process.env.GITHUB_ACTIONS);
  await sleepRandom(isCI ? 200 : 3000, isCI ? 900 : 8000);

  console.log(`[${ts()}] Esperando resultados (timeout=${timeoutMs}ms)...`);

  // React: tolerante a cambios de DOM (texto o patrones).
  // Usamos waitForFunction para detectar cuando HAY datos visibles, sin depender
  // de un selector frágil.
  const handle = await page.waitForFunction(() => {
    const bodyText = (document.body && (document.body.innerText || document.body.textContent)) || '';
    const lower = String(bodyText).toLowerCase();

    // Señales típicas de bloqueo/WAF/captcha.
    if (lower.includes('access denied') || lower.includes('captcha') || lower.includes('robot')) {
      return 'blocked';
    }

    const hasCodigo = /\d{6,7}-\d+-[A-Z]{2,6}\d+/.test(bodyText);
    const hasTotal = /Existen\s+[\d\.\,]+\s+resultados(?:\s+para\s+tu\s+búsqueda)?/i.test(bodyText);

    const candidates = Array.from(document.querySelectorAll('button, a'));
    // Texto actualizado del sitio: "Revisar detalle"
    const hasDetalle = candidates.some((el) => /revisar detalle/i.test(el.textContent || ''));

    if (hasDetalle || hasCodigo || hasTotal) return 'ready';
    return false;
  }, { timeout: timeoutMs, polling: 500 });

  const state = await handle.jsonValue();
  if (state === 'blocked') {
    throw new Error('Detectado posible bloqueo/WAF/captcha al esperar resultados.');
  }

  console.log(`[${ts()}] Resultados detectados.`);
}

async function gotoListadoConResiliencia(page, url, { retries }) {
  const DEFAULT_TIMEOUT_MS = 30000; // requerido: setDefaultTimeout(30000) + esperas cortas
  const NAV_TIMEOUT_MS = 60000; // requerido: máximo 60s por navegación

  return await withRetries(
    async (attempt) => {
      const label = `Listado intento ${attempt}/${retries}`;
      const t0 = Date.now();
      console.log(`[${ts()}] ${label}: goto ${url}`);
      // Requerimiento: delays aleatorios 3-8 segundos entre requests + rotación de fingerprint.
      await applyAntiBlockProfile(page, { referer: 'https://www.mercadopublico.cl/' });
      await sleepRandom(3000, 8000);
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      const status = resp ? resp.status() : null;
      if (status === 403) throw new Error('HTTP 403 (posible bloqueo CloudFront/WAF) en listado.');
      console.log(`[${ts()}] ${label}: domcontentloaded en ${Date.now() - t0}ms`);

      // Requerido: si en 30s no aparecen elementos/datos, fallar para forzar reload+retry.
      await waitForResults(page, { timeoutMs: DEFAULT_TIMEOUT_MS });
    },
    {
      retries,
      onRetry: async (err, attempt) => {
        console.warn(`[${ts()}] Listado falló (intento ${attempt}/${retries}): ${stringifyErr(err)}`);
        await debugDumpPage(page);
        if (is403OrBlockError(err)) {
          // Requerimiento: si detecta 403 o bloqueo, esperar 30 segundos y reintentar con diferentes headers
          console.warn(`[${ts()}] Bloqueo/403 detectado: esperando 30s y rotando headers/UA/viewport...`);
          await sleepRandom(30000, 30000);
          await applyAntiBlockProfile(page, { referer: 'https://www.mercadopublico.cl/' });
        }
        console.warn(`[${ts()}] Recargando página y reintentando...`);
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        } catch (e) {
          console.warn(`[${ts()}] reload() falló: ${stringifyErr(e)}`);
        }
        await sleepRandom(3000, 8000);
      }
    }
  );
}

async function extractTotalResultados(page) {
  // Buscar el texto tipo: "Existen X resultados para tu búsqueda"
  const text = await page.evaluate(() => document.body?.innerText || '');
  // DOM actual: "Existen 4.415 resultados" (a veces también incluye "para tu búsqueda")
  const m = text.match(/Existen\s+([\d\.\,]+)\s+resultados(?:\s+para\s+tu\s+búsqueda)?/i);
  if (!m) return null;
  const n = Number.parseInt(m[1].replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

async function extractComprasFromPage(page) {
  const rawItems = await page.evaluate(() => {
    const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const getLines = (el) =>
      normalize(el?.innerText || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

    const seen = new Set();
    const results = [];

    function findCardContainer(nodeStart) {
      // Subir niveles y elegir el primer ancestro que contenga un código de compra
      const codeRe = /\d{6,7}-\d+-[A-Z]{2,6}\d+/;
      let node = nodeStart;
      for (let i = 0; i < 10 && node; i++) {
        if (node instanceof HTMLElement) {
          const txt = node.innerText || '';
          if (codeRe.test(txt)) return node;
        }
        node = node.parentElement;
      }
      return (nodeStart && nodeStart.parentElement) || nodeStart;
    }

    function extractLinkFromCard(card) {
      // Preferir el CTA "Revisar detalle" dentro del card
      const ctas = Array.from(card.querySelectorAll('button, a')).filter((el) => /revisar detalle/i.test(el.textContent || ''));
      const el = ctas[0] || null;

      const extractFromEl = (node) => {
        if (!node) return null;
        if (node.tagName && node.tagName.toLowerCase() === 'a') {
          const href = node.getAttribute('href');
          return href ? href : null;
        }
        const a = node.closest ? node.closest('a') : null;
        if (a) {
          const href = a.getAttribute('href');
          return href ? href : null;
        }
        const onclick = node.getAttribute ? node.getAttribute('onclick') : null;
        return onclick ? onclick : null;
      };

      // Si el CTA no es <a>, intentar con su closest('a') o onclick; si no existe, caer al primer link del card
      const viaCta = extractFromEl(el);
      if (viaCta) return viaCta;

      const anyLink = card.querySelector('a[href]');
      if (anyLink) return anyLink.getAttribute('href') || null;
      return null;
    }

    const codeRe = /\d{6,7}-\d+-[A-Z]{2,6}\d+/;
    const dateRe = /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/g;

    // DOM tolerante: preferir headings (role=heading o tags h*). Si no existen, caer al CTA "Revisar detalle".
    const headingSelectors = '[role="heading"], h1, h2, h3, h4, h5';
    let anchors = Array.from(document.querySelectorAll(headingSelectors));
    if (!anchors.length) {
      anchors = Array.from(document.querySelectorAll('button, a')).filter((el) => /revisar detalle/i.test(el.textContent || ''));
    }

    for (const anchor of anchors) {
      const card = findCardContainer(anchor);
      if (!card) continue;

      const blob = normalize(card?.innerText || '');
      const lines = getLines(card);

      // Código: tolerante (buscar en todo el card). Si el DOM trae roles "generic", intentar usarlo como pista.
      let codigo = (blob.match(codeRe) || [null])[0];
      if (!codigo) {
        const generics = Array.from(card.querySelectorAll('[role="generic"]'));
        for (const g of generics) {
          const t = normalize(g.innerText || g.textContent || '');
          const m = t.match(codeRe);
          if (m) {
            codigo = m[0];
            break;
          }
        }
      }
      if (!codigo) continue;
      if (seen.has(codigo)) continue;
      seen.add(codigo);

      // Estado (tolerante): buscar algo que contenga "Publicada", "Cerrada", etc.
      const estado =
        lines.find((l) => /(Publicada|Cerrada|Cancelada|Desierta|Adjudicada)/i.test(l)) ||
        '';

      // Título: preferir heading dentro del card; si no existe, usar texto del anchor si parece heading; si no, fallback.
      const cardHeading =
        card.querySelector(headingSelectors) ||
        null;
      const titulo =
        normalize(cardHeading?.innerText || cardHeading?.textContent || '') ||
        normalize(anchor?.innerText || anchor?.textContent || '') ||
        '';

      const fechas = blob.match(dateRe) || [];
      const publicada_el = fechas[0] || '';
      const finaliza_el = fechas[1] || '';

      const presupuestoLine = lines.find((l) => /\$\s*\d/.test(l)) || '';

      const orgLine =
        lines.find((l) => l.includes(' - ') && l.length > 15) ||
        lines.find((l) => /MUNICIPALIDAD|MINISTERIO|SERVICIO|GOBIERNO|HOSPITAL|UNIVERSIDAD/i.test(l)) ||
        '';

      const link_detalle = extractLinkFromCard(card);

      results.push({
        codigo,
        titulo: titulo || '',
        estado,
        publicada_el,
        finaliza_el,
        presupuesto_estimado: presupuestoLine,
        organismo_raw: orgLine,
        link_detalle,
        card_text: blob
      });
    }

    return results;
  });

  // Post-procesado en Node (parseo y normalización)
  return rawItems.map((it) => {
    const { organismo, departamento } = splitOrganismoDepartamento(it.organismo_raw);
    const estado = it.estado || '';
    const estado_detallado = estado
      ? estado.replace(/^Publicada\s*/i, '').trim()
      : '';

    // Normalizar href relativo (si el sitio entrega rutas relativas)
    let link = it.link_detalle || null;
    if (link && typeof link === 'string' && link.startsWith('/')) {
      link = new URL(link, config.baseUrl).toString();
    }

    return {
      codigo: it.codigo,
      titulo: it.titulo || '',
      estado: estado || '',
      publicada_el: parseDateCL(it.publicada_el),
      finaliza_el: parseDateCL(it.finaliza_el),
      presupuesto_estimado: parseBudgetCLP(it.presupuesto_estimado) ?? 0,
      organismo: organismo || '',
      departamento: departamento || '',
      link_detalle: link,
      estado_detallado
    };
  });
}

function getSupabaseClientOrNull({ allowNull }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  if (!url || !key) {
    if (allowNull) return null;
    throw new Error('Faltan variables de entorno SUPABASE_URL y/o SUPABASE_KEY.');
  }

  return createClient(url, key, {
    auth: { persistSession: false }
  });
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
      // Si la tabla no existe, probamos la siguiente alternativa.
      console.warn(`Tabla '${table}' no existe o no está expuesta; probando fallback... (${String(e?.message || e)})`);
    }
  }
  throw lastError;
}

async function debugDumpPage(page) {
  try {
    const title = await page.title();
    const url = page.url();
    const snippet = await page.evaluate(() => {
      const t = (document.body && (document.body.innerText || document.body.textContent)) || '';
      return String(t).replace(/\s+/g, ' ').trim().slice(0, 800);
    });
    console.log(`DEBUG title="${title}" url="${url}" snippet="${snippet}"`);
  } catch (e) {
    console.warn(`DEBUG dump falló: ${String(e?.message || e)}`);
  }
}

async function upsertLicitaciones(supabase, rows) {
  const tables = ['licitaciones', 'compras_agiles'];
  const batches = chunkArray(rows, 200);

  for (const batch of batches) {
    await upsertWithFallback(supabase, { tables, rows: batch, onConflict: 'codigo' });
  }
}

async function upsertLicitacionItems(supabase, rows) {
  const tables = ['licitacion_items', 'compras_agiles_items'];
  const batches = chunkArray(rows, 200);

  for (const batch of batches) {
    await upsertWithFallback(supabase, { tables, rows: batch, onConflict: 'licitacion_codigo,item_index' });
  }
}

async function scrapeCompraDetallada(page, codigo) {
  const url = `https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(codigo)}`;
  const DEFAULT_TIMEOUT_MS = 30000;
  const NAV_TIMEOUT_MS = 60000;

  // En vez de esperar 5 minutos, hacemos esperas cortas con reload.
  await withRetries(
    async (attempt) => {
      const label = `Detalle ${codigo} intento ${attempt}/2`;
      const t0 = Date.now();
      console.log(`[${ts()}] ${label}: goto ${url}`);
      await applyAntiBlockProfile(page, { referer: 'https://buscador.mercadopublico.cl/' });
      await sleepRandom(3000, 8000);
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      const status = resp ? resp.status() : null;
      if (status === 403) throw new Error('HTTP 403 (posible bloqueo CloudFront/WAF) en detalle.');
      console.log(`[${ts()}] ${label}: domcontentloaded en ${Date.now() - t0}ms`);

      // Requerido: waitForFunction para detectar que ya hay datos.
      await page.waitForFunction(() => {
        const t = (document.body && (document.body.innerText || document.body.textContent)) || '';
        const lower = String(t).toLowerCase();
        if (lower.includes('access denied') || lower.includes('captcha') || lower.includes('robot')) return true;
        return /Listado de productos solicitados/i.test(t) || t.length > 400;
      }, { timeout: DEFAULT_TIMEOUT_MS, polling: 500 });

      // Si hay señales de bloqueo, forzar error para que el retry haga reload.
      const maybeBlocked = await page.evaluate(() => {
        const t = (document.body && (document.body.innerText || document.body.textContent)) || '';
        const lower = String(t).toLowerCase();
        return lower.includes('access denied') || lower.includes('captcha') || lower.includes('robot');
      });
      if (maybeBlocked) throw new Error('Detectado posible bloqueo/WAF/captcha en detalle.');
    },
    {
      retries: 2,
      onRetry: async (err, attempt) => {
        console.warn(`[${ts()}] Detalle ${codigo} falló (intento ${attempt}/2): ${stringifyErr(err)}`);
        await debugDumpPage(page);
        if (is403OrBlockError(err)) {
          console.warn(`[${ts()}] Detalle ${codigo}: bloqueo/403 detectado, esperando 30s y rotando fingerprint...`);
          await sleepRandom(30000, 30000);
          await applyAntiBlockProfile(page, { referer: 'https://buscador.mercadopublico.cl/' });
        }
        console.warn(`[${ts()}] Detalle ${codigo}: reload() y reintento...`);
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        } catch (e) {
          console.warn(`[${ts()}] Detalle ${codigo}: reload() falló: ${stringifyErr(e)}`);
        }
        await sleepRandom(3000, 8000);
      }
    }
  );

  const detalle = await page.evaluate(() => {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

    function textOf(el) {
      return norm(el?.innerText || el?.textContent || '');
    }

    function findHeading(textNeedle) {
      const needle = textNeedle.toLowerCase();
      const candidates = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,div,span,p,strong'));
      return candidates.find((el) => textOf(el).toLowerCase().includes(needle)) || null;
    }

    function findTableNear(anchorEl) {
      if (!anchorEl) return null;
      // buscar tabla en ancestros cercanos y siguientes
      let node = anchorEl;
      for (let i = 0; i < 6 && node; i++) {
        const table = node.querySelector && node.querySelector('table');
        if (table) return table;
        node = node.parentElement;
      }
      // fallback: primera tabla de la página
      return document.querySelector('table');
    }

    function extractProductos() {
      const heading = findHeading('Listado de productos solicitados');
      const table = findTableNear(heading);
      const productos = [];

      if (table) {
        const headerCells = Array.from(table.querySelectorAll('thead th')).map((th) => norm(th.innerText));
        const headerMap = new Map();
        headerCells.forEach((h, idx) => headerMap.set(h.toLowerCase(), idx));

        const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
        for (const tr of bodyRows) {
          const tds = Array.from(tr.querySelectorAll('td')).map((td) => norm(td.innerText));
          if (!tds.length) continue;

          const getByHeader = (reList) => {
            for (const [h, idx] of headerMap.entries()) {
              if (reList.some((re) => re.test(h))) return tds[idx] || '';
            }
            return '';
          };

          const id =
            getByHeader([/^id$/, /producto id/, /c[oó]digo/]) ||
            (tds[0] && /^\d+$/.test(tds[0]) ? tds[0] : '');

          const nombre =
            getByHeader([/nombre/, /producto/]) ||
            tds.find((t) => t && t.length >= 3) ||
            '';

          const descripcion =
            getByHeader([/descripci[oó]n/, /detalle/]) ||
            '';

          const cantidad =
            getByHeader([/cantidad/, /cant\./]) ||
            '';

          const unidad =
            getByHeader([/unidad/, /u\./]) ||
            '';

          // Evitar filas vacías/headers
          const joined = tds.join(' | ');
          if (!joined || joined.length < 5) continue;

          productos.push({ id, nombre, descripcion, cantidad, unidad });
        }
      }

      // Fallback si no hay tabla o viene vacía: buscar cards/listas cercanas al heading
      if (!productos.length) {
        const heading = findHeading('Listado de productos solicitados');
        const container = heading?.parentElement || document.body;
        const isBadLine = (t) => {
          const s = String(t || '').toLowerCase();
          // Evitar basura típica (teléfonos, mails, rut, urls, etc.)
          if (!s) return true;
          if (s.includes('@') || s.includes('http')) return true;
          if (s.includes('tel') || s.includes('telefono') || s.includes('dirección') || s.includes('direccion')) return true;
          if (s.includes('rut')) return true;
          // líneas numéricas o de "contacto" tipo +56 44 2...
          if (/^\+?\d[\d\s-]{6,}$/.test(s)) return true;
          // Requiere al menos una letra
          if (!/[a-záéíóúñ]/i.test(s)) return true;
          return false;
        };
        const candidates = Array.from(container.querySelectorAll('li, div'))
          .map((el) => norm(el.innerText))
          .filter((t) => t.length >= 20 && t.length <= 300)
          .filter((t) => !isBadLine(t))
          .slice(0, 120);

        for (const t of candidates.slice(0, 40)) {
          // Heurística muy simple
          productos.push({ id: '', nombre: t.slice(0, 200), descripcion: t.slice(0, 800), cantidad: '', unidad: '' });
        }
      }

      // Dedupe por (id|nombre|descripcion)
      const seen = new Set();
      const out = [];
      for (const p of productos) {
        const key = `${p.id}|${p.nombre}|${p.descripcion}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(p);
      }
      return out;
    }

    function extractDocumentos() {
      const heading = findHeading('documentos adjuntos') || findHeading('adjuntos') || null;
      const container = heading?.parentElement || document.body;
      const links = Array.from(container.querySelectorAll('a'))
        .map((a) => ({
          nombre: norm(a.innerText),
          url: a.href ? String(a.href) : ''
        }))
        .filter((l) => l.url && /^https?:\/\//.test(l.url));

      const filtered = links.filter((l) => {
        const t = (l.nombre || '').toLowerCase();
        return (
          t.includes('doc') ||
          t.includes('pdf') ||
          /\.(pdf|doc|docx|xls|xlsx|zip|rar)(\?|$)/i.test(l.url)
        );
      });

      // Dedupe por url
      const seen = new Set();
      const out = [];
      for (const d of (filtered.length ? filtered : links)) {
        if (!d.url || seen.has(d.url)) continue;
        seen.add(d.url);
        out.push({ nombre: d.nombre || '', url: d.url });
      }
      return out.slice(0, 50);
    }

    return {
      productos: extractProductos(),
      documentos: extractDocumentos()
    };
  });

  return detalle;
}

async function fetchExistingCodigos(supabase, codigos) {
  const existing = new Set();
  const batches = chunkArray(codigos, 200);
  for (const batch of batches) {
    // Compatibilidad: algunos entornos usan `compras_agiles` en vez de `licitaciones`.
    let data = null;
    try {
      const r1 = await supabase.from('licitaciones').select('codigo').in('codigo', batch);
      if (r1.error) throw r1.error;
      data = r1.data;
    } catch (e) {
      if (!isMissingTableError(e)) throw e;
      const r2 = await supabase.from('compras_agiles').select('codigo').in('codigo', batch);
      if (r2.error) throw r2.error;
      data = r2.data;
    }
    for (const row of data || []) existing.add(row.codigo);
  }
  return existing;
}

async function main() {
  const args = parseArgs(process.argv);

  const incrementalMode = args.testSimple ? false : resolveIncrementalMode(args);
  const now = new Date();
  const incrementalSince = new Date(now.getTime() - 75 * 60 * 1000);

  const baseParams = {
    ...config.params,
    ...(args.from ? { date_from: args.from } : {}),
    ...(args.to ? { date_to: args.to } : {})
  };

  const params = incrementalMode
    ? {
        ...baseParams,
        // La URL acepta YYYY-MM-DD. Para “últimos 75 min” usamos el día correspondiente
        // y filtramos por hora vía `publicada_el` después de extraer.
        date_from: formatDateYYYYMMDD(incrementalSince),
        date_to: formatDateYYYYMMDD(now)
      }
    : baseParams;

  // --test-simple: NO Supabase, NO detalle (solo listado + conteo)
  const supabase = args.testSimple ? null : getSupabaseClientOrNull({ allowNull: args.test });
  const dryRun = args.testSimple ? true : !supabase;

  const isHeadless = args.headed ? false : config.headless;

  const browser = await puppeteer.launch({
    headless: isHeadless ? 'new' : false,
        protocolTimeout: 300000, // 5 minutos para evitar timeout de protocolo
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage'
    ]
  });

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    // Hardening extra: ocultar webdriver y simular plugins/languages
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    } catch (_) {}
    try {
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    } catch (_) {}
    try {
      Object.defineProperty(navigator, 'languages', { get: () => ['es-CL', 'es', 'en'] });
    } catch (_) {}
    // Algunos sitios esperan window.chrome
    try {
      window.chrome = window.chrome || { runtime: {} };
    } catch (_) {}
  });
  await applyAntiBlockProfile(page, { referer: 'https://www.mercadopublico.cl/' });
  page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  // Requerido: default timeout 30s para esperas/seletores/funciones.
  page.setDefaultTimeout(30000);

  const allCompras = [];
  const startPage = 1;

  let totalResultados = null;

  const maxPagesArg = args.testSimple ? 1 : (args.test ? 1 : (Number.isFinite(args.pages) ? args.pages : null));
  let maxPages = maxPagesArg ?? config.maxPages;

  try {
    let currentPage = startPage;
    const runDetail = withConcurrencyLimit(3);

    while (true) {
      const url = buildUrl(currentPage, params);
      console.log(`[${new Date().toISOString()}] Página ${currentPage}${maxPages ? `/${maxPages}` : ''}: ${url}`);

      // Navegación/listado: fallar rápido con reintentos cortos + reload.
      await gotoListadoConResiliencia(page, url, { retries: 2 });

      if (totalResultados == null) {
        totalResultados = await extractTotalResultados(page);
        if (totalResultados != null) {
          console.log(`Total resultados detectado: ${totalResultados}`);
          if (maxPages == null) maxPages = Math.ceil(totalResultados / 15);
        } else {
          console.warn('No pude detectar el total de resultados (seguiré sin calcular maxPages automáticamente).');
          if (maxPages == null && args.test) maxPages = 1;
        }
      }

      // Scroll (por si hay lazy-loading)
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleepRandom(500, 1200);

      const compras = await withRetries(
        async () => await extractComprasFromPage(page),
        {
          retries: config.maxRetries,
          onRetry: async (err, attempt) => {
            console.warn(`Reintento extracción (intento ${attempt}/${config.maxRetries}): ${String(err?.message || err)}`);
            await sleepRandom(1000, 2500);
          }
        }
      );

      console.log(`Extraídas ${compras.length} compras en la página ${currentPage}`);

      if (args.testSimple) {
        // Modo “empezar simple”: sin Supabase ni detalle
        const codigos = compras.map((c) => c.codigo).filter(Boolean);
        console.log(`[test-simple] Total compras encontradas en listado: ${compras.length}`);
        console.log(`[test-simple] Códigos (primeros 10): ${codigos.slice(0, 10).join(', ')}`);
        // guardar en memoria para el resumen final
        const existing = new Set(allCompras.map((c) => c.codigo));
        for (const c of compras) if (!existing.has(c.codigo)) allCompras.push(c);

        if (maxPages && currentPage >= maxPages) break;
        currentPage += 1;
        // Requerimiento: delays aleatorios 3-8 segundos entre requests
        await sleepRandom(3000, 8000);
        continue;
      }

      // Incremental: filtrar por timestamp (últimos 75 min)
      const comprasFiltradas = incrementalMode
        ? compras.filter((c) => {
            const d = parseLocalIsoToDate(c.publicada_el);
            return d && d.getTime() >= incrementalSince.getTime();
          })
        : compras;

      if (incrementalMode) {
        console.log(`Incremental ON: ${comprasFiltradas.length}/${compras.length} compras dentro de últimos 75 min`);
      }

      // Incremental: evitar reprocesar códigos ya existentes en Supabase
      let comprasNuevas = comprasFiltradas;
      if (incrementalMode && !dryRun && comprasFiltradas.length) {
        const codigos = comprasFiltradas.map((c) => c.codigo);
        const existentes = await withRetries(
          async () => await fetchExistingCodigos(supabase, codigos),
          {
            retries: config.maxRetries,
            onRetry: async (err, attempt) => {
              console.warn(`Reintento verificación existentes (intento ${attempt}/${config.maxRetries}): ${String(err?.message || err)}`);
              await sleepRandom(800, 1600);
            }
          }
        );
        comprasNuevas = comprasFiltradas.filter((c) => !existentes.has(c.codigo));
        console.log(`Incremental: nuevas=${comprasNuevas.length}, ya-existían=${comprasFiltradas.length - comprasNuevas.length}`);
      }

      const nowIso = toIsoNow();
      const licRows = comprasNuevas.map((c) => {
        // Agregar matching FirmaVB (por ahora basado en título; los items se procesan después)
        const matchResult = matchLicitacion({
          titulo: c.titulo || '',
          descripcion: '',
          items: []
        });

        return {
          ...c,
          categoria: matchResult?.categoria ?? null,
          categoria_match: matchResult?.categoria_match ?? null,
          match_score: matchResult?.match_score ?? 0,
          palabras_encontradas:
            Array.isArray(matchResult?.palabras_encontradas) && matchResult.palabras_encontradas.length
              ? JSON.stringify(matchResult.palabras_encontradas)
              : null,
          match_encontrado: Boolean(matchResult?.categoria),
          fecha_extraccion: nowIso
        };
      });
      if (dryRun) {
        console.log(`[dry-run] Enviaría ${licRows.length} filas a 'licitaciones' (upsert por codigo).`);
      } else {
        if (licRows.length) {
          await upsertLicitaciones(supabase, licRows);
          console.log(`Upsert OK: ${licRows.length} filas en 'licitaciones'.`);
        }
      }

      // Detalle completo (productos/documentos) en paralelo, con límite de 3 páginas concurrentes
      const detailTasks = comprasNuevas.map((compra) =>
        runDetail(async () => {
          const detailPage = await browser.newPage();
          await detailPage.evaluateOnNewDocument(() => {
            try {
              Object.defineProperty(navigator, 'webdriver', { get: () => false });
            } catch (_) {}
            try {
              Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            } catch (_) {}
            try {
              Object.defineProperty(navigator, 'languages', { get: () => ['es-CL', 'es', 'en'] });
            } catch (_) {}
            try {
              window.chrome = window.chrome || { runtime: {} };
            } catch (_) {}
          });
          await applyAntiBlockProfile(detailPage, { referer: 'https://buscador.mercadopublico.cl/' });
          detailPage.setDefaultNavigationTimeout(config.navigationTimeoutMs);
          detailPage.setDefaultTimeout(30000);

          try {
            const detalle = await withRetries(
              async () => await scrapeCompraDetallada(detailPage, compra.codigo),
              {
                // Detalle: reintentos cortos; el propio scrapeCompraDetallada ya hace reload+retry.
                retries: 2,
                onRetry: async (err, attempt) => {
                  console.warn(`Retry detalle (${compra.codigo}) intento ${attempt}/${config.maxRetries}: ${String(err?.message || err)}`);
                  if (is403OrBlockError(err)) {
                    await sleepRandom(30000, 30000);
                    await applyAntiBlockProfile(detailPage, { referer: 'https://buscador.mercadopublico.cl/' });
                  }
                  await sleepRandom(3000, 8000);
                }
              }
            );

            const productos = Array.isArray(detalle.productos) ? detalle.productos : [];

            // Normalización y persistencia de items
            const sorted = productos.slice().sort((a, b) => {
              const ai = String(a.id || '');
              const bi = String(b.id || '');
              if (ai && bi && ai !== bi) return ai.localeCompare(bi);
              return String(a.nombre || '').localeCompare(String(b.nombre || ''));
            });

            const itemRows = (sorted.length ? sorted : [{ id: '', nombre: compra.titulo || '', descripcion: '', cantidad: '', unidad: '' }])
              .map((p, idx) => ({
                licitacion_codigo: compra.codigo,
                item_index: idx + 1,
                producto_id: p.id || null,
                nombre: p.nombre || '',
                descripcion: p.descripcion || '',
                cantidad: p.cantidad || null,
                unidad: p.unidad || ''
              }));

            if (dryRun) {
              console.log(`[dry-run] ${compra.codigo}: productos=${sorted.length} -> enviaría ${itemRows.length} a 'licitacion_items'.`);
            } else {
              await upsertLicitacionItems(supabase, itemRows);
            }

            // Documentos (opcional): intentamos guardar en tabla extra si existe
            const documentos = Array.isArray(detalle.documentos) ? detalle.documentos : [];
            if (!dryRun && documentos.length) {
              const docRows = documentos.map((d) => ({
                licitacion_codigo: compra.codigo,
                nombre: d.nombre || '',
                url: d.url || ''
              }));
              try {
                await upsertWithFallback(supabase, {
                  tables: ['licitacion_documentos', 'compras_agiles_documentos'],
                  rows: docRows,
                  onConflict: 'licitacion_codigo,url'
                });
              } catch (e) {
                console.warn(
                  `Tabla de documentos no disponible o falló inserción (${compra.codigo}): ${String(e?.message || e)}`
                );
              }
            }
          } finally {
            await detailPage.close();
          }
        })
      );

      await Promise.all(detailTasks);

      // Mantener en memoria un resumen (útil para logs/fin de corrida)
      const existing = new Set(allCompras.map((c) => c.codigo));
      for (const c of compras) if (!existing.has(c.codigo)) allCompras.push(c);

      if (maxPages && currentPage >= maxPages) break;
      if (!maxPages && args.test) break;

      currentPage += 1;
      // Requerimiento: delays aleatorios 3-8 segundos entre requests
      await sleepRandom(3000, 8000);
    }
  } catch (err) {
    console.error('Error durante el scraping:', err);
    // Importante: en CI queremos que el workflow falle si no se pudo scrapear/persistir.
    process.exitCode = 1;
  } finally {
    await browser.close();
    console.log(
      `Finalizado. Compras únicas vistas (memoria): ${allCompras.length}. Total resultados detectado: ${totalResultados ?? 'N/A'}. Incremental=${incrementalMode ? 'ON' : 'OFF'}.`
    );
  }
}

main().catch((err) => {
  console.error('Fallo fatal:', err);
  process.exitCode = 1;
});

