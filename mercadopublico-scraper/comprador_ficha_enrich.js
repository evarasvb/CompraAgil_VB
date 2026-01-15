// Enriquecimiento de instituciones (compradores) desde ficha pública:
// - URL web: https://comprador.mercadopublico.cl/ficha/<RUT> (SPA)
// - Datos reales vienen de APIs llamadas por el frontend.
// Este script obtiene token público y consulta endpoints JSON para:
// - información institución
// - conducta de pago (días promedio)
// - reclamos (conteo y desglose)
// - montos OC (desglose)
// - total compras (monto total, período)
//
// Requiere: SUPABASE_URL + (SUPABASE_SERVICE_KEY o SUPABASE_KEY)
// Uso: node comprador_ficha_enrich.js --input <api-client-output.json>

require('dotenv').config({ quiet: true });

const fs = require('fs');
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
  const args = { input: null, maxInstituciones: 30 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') args.input = argv[++i] || null;
    else if (a === '--max-instituciones') args.maxInstituciones = Number.parseInt(argv[++i] || '30', 10);
  }
  return args;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function isMissingTableError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (msg.includes('does not exist') && msg.includes('relation')) return true;
  if (msg.includes('schema cache') && (msg.includes('not found') || msg.includes('does not exist'))) return true;
  if (msg.includes('could not find the') && msg.includes('table')) return true;
  return false;
}

function normalizeRut(rut) {
  if (!rut) return null;
  const s = String(rut).trim();
  if (!s) return null;
  return s.replace(/\s+/g, '').replace(/\./g, '');
}

function extractRutsFromApiClientJson(j) {
  const fichas = j?.fichas && typeof j.fichas === 'object' ? j.fichas : {};
  const out = new Set();
  for (const k of Object.keys(fichas)) {
    const inst = fichas?.[k]?.informacion_institucion;
    const rut = normalizeRut(inst?.rut_organismo_comprador);
    if (rut) out.add(rut);
  }
  return Array.from(out);
}

async function getPublicAccessToken() {
  const url = 'https://servicios-prd.mercadopublico.cl/v1/auth/publico';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json'
    }
  });
  const j = await res.json().catch(() => null);
  const token = j?.payload?.access_token || null;
  if (!token) throw new Error(`No pude obtener access_token desde ${url} (status=${res.status})`);
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
    return { status: res.status, json: j, text };
  } finally {
    clearTimeout(t);
  }
}

function parseDDMMYYYYtoIso(ddmmyyyy) {
  // "10-01-2026" -> "2026-01-10T00:00:00.000Z"
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

async function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    logErr('Uso: node comprador_ficha_enrich.js --input <path.json> [--max-instituciones N]');
    process.exitCode = 2;
    return;
  }

  const raw = fs.readFileSync(args.input, 'utf8');
  const j = JSON.parse(raw);
  const rutsAll = extractRutsFromApiClientJson(j);
  if (!rutsAll.length) {
    log('No hay RUTs de instituciones en el JSON; nada que enriquecer.');
    return;
  }

  const ruts = rutsAll.slice(0, Number.isFinite(args.maxInstituciones) ? Math.max(1, args.maxInstituciones) : 30);
  log(`Instituciones a enriquecer: ${ruts.length}/${rutsAll.length}`);

  const supabase = getSupabaseClientOrThrow();
  try {
    const probe = await supabase.from('instituciones').select('rut').limit(1);
    if (probe.error) throw probe.error;
  } catch (e) {
    if (isMissingTableError(e)) {
      logErr("Warning: tabla 'instituciones' no existe; se omite enriquecimiento comprador_ficha.");
      return;
    }
    throw e;
  }

  const token = await getPublicAccessToken();
  const nowIso = new Date().toISOString();
  const base = 'https://comprador-api-pro.mercadopublico.cl/comprador';

  const rows = [];
  for (const rut of ruts) {
    // Endpoints principales (best-effort; algunos pueden dar 500)
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
    const dias = Number.isFinite(pagoData?.dias) ? pagoData.dias : null;
    const sigfe = typeof pagoData?.sigfe === 'boolean' ? pagoData.sigfe : null;
    const pagoActualizadoEl = parseDDMMYYYYtoIso(pagoData?.fechaActualizacion);

    const reclPayload = recl.json?.payload || null;
    const reclamosTotal = Number.isFinite(reclPayload?.totalReclamos) ? reclPayload.totalReclamos : null;
    const reclamosUlt = Array.isArray(reclPayload?.data)
      ? reclPayload.data.map((d) => d?.fechaActualizacion).filter(Boolean).sort().slice(-1)[0] || null
      : null;

    const ocPayload = ocM.json?.payload || null;
    const totalComprasPayload = totalC.json?.payload || null;

    const conductaPagoText =
      dias != null ? `${dias} días promedio${sigfe === true ? ' (SIGFE)' : sigfe === false ? ' (no SIGFE)' : ''}` : null;

    rows.push({
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
      pago_promedio_dias: dias,
      pago_sigfe: sigfe,
      pago_actualizado_el: pagoActualizadoEl,

      reclamos_total: reclamosTotal,
      reclamos_ultima_fecha: reclamosUlt ? new Date(reclamosUlt).toISOString() : null,

      // Guardar en meta datos útiles (limitado para no inflar filas)
      meta: {
        fuente: 'comprador_api',
        fetched_at: nowIso,
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
      last_seen_at: nowIso,
      updated_at: nowIso
    });
  }

  for (const batch of chunkArray(rows, 200)) {
    const { error } = await supabase.from('instituciones').upsert(batch, { onConflict: 'rut' });
    if (error) throw error;
  }

  log(`Upsert OK: instituciones enriquecidas=${rows.length}`);
}

main().catch((e) => {
  logErr(`Error: ${e?.message || String(e)}`);
  process.exitCode = 1;
});

