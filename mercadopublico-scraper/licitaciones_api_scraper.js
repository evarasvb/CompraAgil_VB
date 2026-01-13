require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

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
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'CompraAgil_VB/licitaciones-api' } });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return JSON.parse(text);
}

function isSimultaneousRequestError(err) {
  if (!err || typeof err !== 'object') return false;
  if (err.status !== 500) return false;
  const body = typeof err.body === 'string' ? err.body : '';
  return body.includes('"Codigo":10500') || body.toLowerCase().includes('peticiones simult');
}

async function fetchJsonWithRetry(url, { retries = 5, baseDelayMs = 600 } = {}) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fetchJson(url);
    } catch (e) {
      attempt += 1;
      const status = e && typeof e === 'object' ? e.status : undefined;
      // Reintentar solo casos típicos del API MP (rate-limit / simultáneas / inestabilidad)
      const retryable = status === 429 || status === 502 || status === 503 || status === 504 || isSimultaneousRequestError(e);
      if (!retryable || attempt > retries) throw e;
      const wait = baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(wait);
    }
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
    raw_json: d
  };
}

async function main() {
  const supabase = getSupabaseClient();
  const ticket = env('MP_API_TICKET').trim();
  if (!ticket) throw new Error('Falta MP_API_TICKET');

  const from = env('MP_LIC_FROM').trim() || todayYYYYMMDD();
  const to = env('MP_LIC_TO').trim() || from;
  const estado = env('MP_LIC_ESTADO').trim() || '';
  const fechas = dateRangeDDMMAAAA(from, to);
  if (!fechas.length) throw new Error('Rango inválido. Usa MP_LIC_FROM/MP_LIC_TO en formato YYYY-MM-DD');

  const codigos = new Set();
  for (const fecha of fechas) {
    const url = buildListUrl({ fechaDDMMAAAA: fecha, ticket, estado });
    const payload = await fetchJsonWithRetry(url, { retries: 5, baseDelayMs: 600 });
    const listado = extractListado(payload);
    for (const r of listado) {
      const codigo = String(pick(r, ['CodigoExterno', 'codigo', 'Codigo', 'CodigoLicitacion']) || '').trim();
      if (codigo) codigos.add(codigo);
    }
  }

  console.log(`[lic-api] codigos únicos: ${codigos.size} (${from}..${to}) estado=${estado || '(sin filtro)'}`);

  const rows = [];
  for (const codigo of codigos) {
    try {
      const url = buildDetailUrl({ codigo, ticket });
      const payload = await fetchJsonWithRetry(url, { retries: 6, baseDelayMs: 700 });
      // Muchos responses incluyen Listado/Licitacion; tomamos el primer objeto de detalle.
      const list = extractListado(payload);
      const detail = list && list.length ? list[0] : payload;
      const mapped = mapApiRowToMinimal({}, detail);
      if (mapped) rows.push(mapped);
      // Throttle para evitar errores 10500 (peticiones simultáneas)
      await sleep(150);
    } catch (e) {
      console.warn(`[lic-api] falló detalle ${codigo}: ${String(e?.message || e)}`);
    }
  }

  if (rows.length) {
    const { error } = await supabase.from('licitaciones_api').upsert(rows, { onConflict: 'codigo' });
    if (error) throw error;
  }

  console.log(`[lic-api] upsert filas=${rows.length}`);
}

main().catch((e) => {
  console.error('[lic-api] fallo:', e);
  process.exitCode = 1;
});

