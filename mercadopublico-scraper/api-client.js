require('dotenv').config();

/**
 * Cliente API interno del buscador de Compras Ágiles (sin Puppeteer).
 *
 * Descubierto desde el bundle de `https://buscador.mercadopublico.cl/compra-agil`:
 * - Base API: https://api.buscador.mercadopublico.cl
 * - Endpoint listado: GET /compra-agil?{queryString} (requiere header `x-api-key`)
 * - Endpoint ficha:   GET /compra-agil?action=ficha&code=<CODIGO> (requiere `x-api-key`)
 *
 * Uso rápido:
 *   node api-client.js --from 2025-01-15 --to 2025-01-15 --pages 1 --status all --include-ficha
 */

const DEFAULT_API_BASE = 'https://api.buscador.mercadopublico.cl';
// API key expuesta públicamente por el frontend (se puede override vía env)
const DEFAULT_X_API_KEY = 'e93089e4-437c-4723-b343-4fa20045e3bc';

const REFERER = 'https://buscador.mercadopublico.cl/compra-agil';
const ORIGIN = 'https://buscador.mercadopublico.cl';

function ts() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const args = {
    from: null,
    to: null,
    pages: 1,
    status: 'all',
    region: 'all',
    orderBy: 'recent',
    keywords: null,
    includeFicha: false,
    maxFicha: null,
    timeoutMs: 30000
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') args.from = argv[++i] || null;
    else if (a === '--to') args.to = argv[++i] || null;
    else if (a === '--pages') args.pages = Number.parseInt(argv[++i] || '1', 10);
    else if (a === '--status') args.status = argv[++i] || 'all';
    else if (a === '--region') args.region = argv[++i] || 'all';
    else if (a === '--order-by') args.orderBy = argv[++i] || 'recent';
    else if (a === '--keywords') args.keywords = argv[++i] || null;
    else if (a === '--include-ficha') args.includeFicha = true;
    else if (a === '--max-ficha') args.maxFicha = Number.parseInt(argv[++i] || '', 10);
    else if (a === '--timeout-ms') args.timeoutMs = Number.parseInt(argv[++i] || '30000', 10);
  }
  return args;
}

function todayYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getApiConfig() {
  const apiBase = process.env.MP_CA_API_BASE || process.env.MP_SEARCH_API_BASE || DEFAULT_API_BASE;
  const xApiKey = process.env.MP_CA_X_API_KEY || process.env.MP_SEARCH_X_API_KEY || DEFAULT_X_API_KEY;
  return { apiBase, xApiKey };
}

function buildHeaders({ xApiKey }) {
  return {
    // Fingerprint mínimo “browser-like” (similar a lo que requiere CloudFront/CORS)
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
    Origin: ORIGIN,
    Referer: REFERER,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'x-api-key': xApiKey
  };
}

async function fetchJson(url, { headers, timeoutMs }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} al llamar ${url}: ${text.slice(0, 400)}`);
      err.status = res.status;
      err.body = text;
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      const err = new Error(`Respuesta no-JSON desde ${url}: ${text.slice(0, 200)}`);
      err.body = text;
      throw err;
    }
  } finally {
    clearTimeout(t);
  }
}

function normalizeStatusParam(status) {
  if (status == null) return null;
  const s = String(status).trim();
  if (!s) return null;
  if (s.toLowerCase() === 'all') {
    // Importante: el backend responde 502 con status=all; el frontend usa CSV.
    return '2,3,4,5,6';
  }
  return s;
}

function buildCompraAgilQuery({
  date_from,
  date_to,
  order_by,
  page_number,
  region,
  status,
  keywords
}) {
  const qp = {};
  if (date_from) qp.date_from = date_from;
  if (date_to) qp.date_to = date_to;
  if (order_by) qp.order_by = order_by;
  if (page_number != null) qp.page_number = String(page_number);

  const regionValue = region == null ? null : String(region).trim();
  // Importante: el frontend omite region cuando es "all".
  if (regionValue && regionValue.toLowerCase() !== 'all') qp.region = regionValue;

  const statusValue = normalizeStatusParam(status);
  if (statusValue) qp.status = statusValue;

  const kw = keywords == null ? null : String(keywords).trim();
  if (kw) qp.keywords = kw;

  return new URLSearchParams(qp).toString();
}

async function searchCompraAgil({ apiBase, headers, timeoutMs, queryString }) {
  const url = `${apiBase}/compra-agil?${queryString}`;
  return await fetchJson(url, { headers, timeoutMs });
}

async function fetchFichaCompraAgil({ apiBase, headers, timeoutMs, codigo }) {
  const url = `${apiBase}/compra-agil?action=ficha&code=${encodeURIComponent(codigo)}`;
  return await fetchJson(url, { headers, timeoutMs });
}

async function main() {
  const args = parseArgs(process.argv);
  const { apiBase, xApiKey } = getApiConfig();
  const headers = buildHeaders({ xApiKey });

  const dateFrom = args.from || todayYYYYMMDD();
  const dateTo = args.to || dateFrom;
  const pages = Number.isFinite(args.pages) && args.pages > 0 ? args.pages : 1;

  const all = [];
  let total = null;
  let pageCount = null;

  for (let page = 1; page <= pages; page++) {
    const queryString = buildCompraAgilQuery({
      date_from: dateFrom,
      date_to: dateTo,
      order_by: args.orderBy,
      page_number: page,
      region: args.region,
      status: args.status,
      keywords: args.keywords
    });

    console.log(`[${ts()}] GET ${apiBase}/compra-agil?${queryString}`);
    const resp = await searchCompraAgil({ apiBase, headers, timeoutMs: args.timeoutMs, queryString });

    const payload = resp?.payload || {};
    const resultados = Array.isArray(payload.resultados) ? payload.resultados : [];
    if (total == null && Number.isFinite(payload.resultCount)) total = payload.resultCount;
    if (pageCount == null && Number.isFinite(payload.pageCount)) pageCount = payload.pageCount;

    all.push(...resultados);

    // Si el backend reporta pageCount menor que lo solicitado, cortar temprano.
    if (Number.isFinite(pageCount) && page >= pageCount) break;
  }

  let fichas = null;
  if (args.includeFicha) {
    fichas = {};
    const max = Number.isFinite(args.maxFicha) ? args.maxFicha : all.length;
    const slice = all.slice(0, Math.max(0, max));

    for (const it of slice) {
      const codigo = it?.codigo;
      if (!codigo) continue;
      console.log(`[${ts()}] GET ${apiBase}/compra-agil?action=ficha&code=${codigo}`);
      const ficha = await fetchFichaCompraAgil({
        apiBase,
        headers,
        timeoutMs: args.timeoutMs,
        codigo
      });
      fichas[codigo] = ficha?.payload || null;
    }
  }

  const out = {
    meta: {
      apiBase,
      date_from: dateFrom,
      date_to: dateTo,
      order_by: args.orderBy,
      status: args.status,
      region: args.region,
      keywords: args.keywords,
      requested_pages: pages,
      result_count: total,
      page_count: pageCount,
      returned: all.length,
      include_ficha: args.includeFicha
    },
    resultados: all,
    fichas
  };

  process.stdout.write(`${JSON.stringify(out)}\n`);
}

main().catch((err) => {
  console.error(`[${ts()}] Error:`, err?.message || err);
  process.exitCode = 1;
});

