// Refresco periódico de instituciones (cada ~15 días).
// Lee instituciones desde Supabase y re-enriquece usando APIs públicas del "comprador".
//
// Uso:
//   node comprador_ficha_refresh.js --days 15 --limit 200
//
// Requiere: SUPABASE_URL + (SUPABASE_SERVICE_KEY o SUPABASE_KEY)

require('dotenv').config({ quiet: true });

const { createClient } = require('@supabase/supabase-js');

function ts() {
  return new Date().toISOString();
}

function log(msg) {
  process.stdout.write(`[${ts()}] ${msg}\n`);
}

function logErr(msg) {
  process.stderr.write(`[${ts()}] ${msg}\n`);
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

function parseArgs(argv) {
  const args = {
    days: 15,
    limit: 200,
    concurrency: 5
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--days') args.days = Number.parseInt(argv[++i] || '15', 10);
    else if (a === '--limit') args.limit = Number.parseInt(argv[++i] || '200', 10);
    else if (a === '--concurrency') args.concurrency = Number.parseInt(argv[++i] || '5', 10);
  }
  return args;
}

function normalizeRut(rut) {
  if (!rut) return null;
  const s = String(rut).trim();
  if (!s) return null;
  return s.replace(/\s+/g, '').replace(/\./g, '');
}

async function getPublicAccessToken() {
  const url = 'https://servicios-prd.mercadopublico.cl/v1/auth/publico';
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
  const j = await res.json().catch(() => null);
  const token = j?.payload?.access_token || null;
  if (!token) throw new Error(`No pude obtener access_token (status=${res.status})`);
  return token;
}

async function fetchJson(url, { token, rut } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/json, text/plain, */*',
        Authorization: `Bearer ${token}`,
        Origin: 'https://comprador.mercadopublico.cl',
        Referer: rut ? `https://comprador.mercadopublico.cl/ficha/${rut}` : 'https://comprador.mercadopublico.cl/ficha/'
      }
    });
    const text = await res.text();
    let j = null;
    try {
      j = JSON.parse(text);
    } catch (_) {}
    return { status: res.status, json: j };
  } finally {
    clearTimeout(t);
  }
}

function parseDDMMYYYYtoIso(ddmmyyyy) {
  if (!ddmmyyyy) return null;
  const m = String(ddmmyyyy).trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function safeJsonForMeta(obj, maxLen = 6000) {
  try {
    const s = JSON.stringify(obj);
    if (s.length <= maxLen) return obj;
    return { truncated: true, size: s.length };
  } catch (_) {
    return { unserializable: true };
  }
}

function withConcurrencyLimit(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    active -= 1;
    if (queue.length) queue.shift()();
  };
  return async function run(task) {
    if (active >= limit) await new Promise((resolve) => queue.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      next();
    }
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const days = Number.isFinite(args.days) ? Math.max(1, args.days) : 15;
  const limit = Number.isFinite(args.limit) ? Math.max(1, args.limit) : 200;
  const concurrency = Number.isFinite(args.concurrency) ? Math.max(1, args.concurrency) : 5;

  const supabase = getSupabaseClientOrThrow();
  const token = await getPublicAccessToken();

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  log(`Refresco instituciones: days=${days} cutoff=${cutoff} limit=${limit} concurrency=${concurrency}`);

  // Seleccionar por updated_at antiguo. Si hay nulls, no entran en lt(); hacemos fallback con paginación.
  const { data: rows, error } = await supabase
    .from('instituciones')
    .select('rut,updated_at')
    .or(`updated_at.is.null,updated_at.lt.${cutoff}`)
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw error;

  const ruts = (rows || [])
    .map((r) => normalizeRut(r?.rut))
    .filter(Boolean);

  if (!ruts.length) {
    log('No hay instituciones para refrescar (según cutoff).');
    return;
  }

  log(`Instituciones a refrescar: ${ruts.length}`);

  const base = 'https://comprador-api-pro.mercadopublico.cl/comprador';
  const nowIso = new Date().toISOString();
  const run = withConcurrencyLimit(concurrency);

  const outRows = [];
  await Promise.all(
    ruts.map((rut) =>
      run(async () => {
        const infoUrl = `${base}/ficha/informacion_institucion?rut=${encodeURIComponent(rut)}`;
        const pagoUrl = `${base}/pago_promedios/calculo_dias?rut=${encodeURIComponent(rut)}`;
        const reclamosUrl = `${base}/reclamos/calculos_reclamos?rut=${encodeURIComponent(rut)}`;
        const ocMontosUrl = `${base}/orden_compra/montos?rut=${encodeURIComponent(rut)}`;
        const totalComprasUrl = `${base}/ficha/total_compras?rut=${encodeURIComponent(rut)}`;

        const [info, pago, recl, ocM, totalC] = await Promise.all([
          fetchJson(infoUrl, { token, rut }),
          fetchJson(pagoUrl, { token, rut }),
          fetchJson(reclamosUrl, { token, rut }),
          fetchJson(ocMontosUrl, { token, rut }),
          fetchJson(totalComprasUrl, { token, rut })
        ]);

        const infoPayload = info.json?.payload?.respuesta || null;
        const direccion = infoPayload?.direccion || null;

        const pagoData = pago.json?.payload?.data || null;
        const diasProm = Number.isFinite(pagoData?.dias) ? pagoData.dias : null;
        const sigfe = typeof pagoData?.sigfe === 'boolean' ? pagoData.sigfe : null;
        const pagoActualizadoEl = parseDDMMYYYYtoIso(pagoData?.fechaActualizacion);

        const reclPayload = recl.json?.payload || null;
        const reclamosTotal = Number.isFinite(reclPayload?.totalReclamos) ? reclPayload.totalReclamos : null;
        const reclamosUlt = Array.isArray(reclPayload?.data)
          ? reclPayload.data.map((d) => d?.fechaActualizacion).filter(Boolean).sort().slice(-1)[0] || null
          : null;

        const conductaPagoText =
          diasProm != null
            ? `${diasProm} días promedio${sigfe === true ? ' (SIGFE)' : sigfe === false ? ' (no SIGFE)' : ''}`
            : null;

        outRows.push({
          rut,
          nombre: infoPayload?.razonSocial || infoPayload?.nombreFantasia || null,
          codigo_entidad: infoPayload?.codigoEntidad != null ? String(infoPayload.codigoEntidad) : null,
          sector: infoPayload?.sector != null ? String(infoPayload.sector) : null,
          sitio_web: infoPayload?.sitioWeb != null ? String(infoPayload.sitioWeb) : null,
          telefono: infoPayload?.telefono != null ? String(infoPayload.telefono) : null,
          correo: infoPayload?.correo != null ? String(infoPayload.correo) : null,
          domicilio_legal: direccion?.domicilioLegal != null ? String(direccion.domicilioLegal) : null,
          region: direccion?.region != null ? String(direccion.region) : null,
          comuna: direccion?.comuna != null ? String(direccion.comuna) : null,

          conducta_pago: conductaPagoText,
          pago_promedio_dias: diasProm,
          pago_sigfe: sigfe,
          pago_actualizado_el: pagoActualizadoEl,

          reclamos_total: reclamosTotal,
          reclamos_ultima_fecha: reclamosUlt ? new Date(reclamosUlt).toISOString() : null,

          meta: {
            fuente: 'comprador_api_refresh',
            refreshed_at: nowIso,
            endpoints: {
              informacion_institucion: { status: info.status },
              pago_promedios: { status: pago.status },
              reclamos_calculos: { status: recl.status },
              oc_montos: { status: ocM.status },
              total_compras: { status: totalC.status }
            },
            comprador: safeJsonForMeta(info.json?.payload || null),
            pago_promedios: safeJsonForMeta(pago.json?.payload || null),
            reclamos: safeJsonForMeta(recl.json?.payload || null),
            oc_montos: safeJsonForMeta(ocM.json?.payload || null),
            total_compras: safeJsonForMeta(totalC.json?.payload || null)
          },
          updated_at: nowIso
        });
      })
    )
  );

  // Upsert en batches
  const batches = [];
  for (let i = 0; i < outRows.length; i += 200) batches.push(outRows.slice(i, i + 200));
  for (const b of batches) {
    const { error: upErr } = await supabase.from('instituciones').upsert(b, { onConflict: 'rut' });
    if (upErr) throw upErr;
  }

  log(`OK: refrescadas instituciones=${outRows.length}`);
}

main().catch((e) => {
  logErr(`Error: ${e?.message || String(e)}`);
  process.exitCode = 1;
});

