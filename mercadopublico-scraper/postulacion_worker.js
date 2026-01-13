require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

function env(name, fallback = '') {
  const v = process.env[name];
  return v == null ? fallback : String(v);
}

function getSupabaseClient() {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_KEY') || env('SUPABASE_KEY');
  if (!url || !key) throw new Error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY/SUPABASE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const supabase = getSupabaseClient();

  const ticket = env('MP_API_TICKET').trim();
  const endpoint = env('MP_POSTULACION_ENDPOINT').trim(); // REQUIERE endpoint real (no se inventa aquí)

  if (!ticket || !endpoint) {
    console.warn(
      '[postulacion] Falta MP_API_TICKET o MP_POSTULACION_ENDPOINT. Se omite el worker (sin fallo).'
    );
    return;
  }

  // Lee ofertas aprobadas
  const { data, error } = await supabase
    .from('cliente_ofertas')
    .select('*')
    .eq('estado', 'aprobada')
    .limit(50);
  if (error) throw error;

  const ofertas = data || [];
  console.log(`[postulacion] ofertas aprobadas: ${ofertas.length}`);
  if (!ofertas.length) return;

  for (const oferta of ofertas) {
    try {
      // Payload: depende 100% del endpoint real de MercadoPúblico para postular/enviar oferta.
      // Se deja preparado para conectar cuando se confirme el endpoint y el contrato.
      const payload = {
        ticket,
        cliente_id: oferta.cliente_id,
        licitacion_codigo: oferta.licitacion_codigo,
        compra_agil_codigo: oferta.compra_agil_codigo,
        monto_oferta: oferta.monto_oferta,
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }

      if (!res.ok) {
        await supabase
          .from('cliente_ofertas')
          .update({ estado: 'fallida', respuesta_mp: json })
          .eq('id', oferta.id);
        console.warn(`[postulacion] fallida id=${oferta.id} HTTP ${res.status}`);
        continue;
      }

      await supabase
        .from('cliente_ofertas')
        .update({
          estado: 'enviada',
          oferta_id_mp: json?.oferta_id ?? json?.id ?? null,
          respuesta_mp: json,
        })
        .eq('id', oferta.id);

      console.log(`[postulacion] enviada id=${oferta.id}`);
    } catch (e) {
      await supabase
        .from('cliente_ofertas')
        .update({ estado: 'fallida', respuesta_mp: { error: String(e?.message || e) } })
        .eq('id', oferta.id);
      console.warn(`[postulacion] excepción id=${oferta.id}: ${String(e?.message || e)}`);
    }
  }
}

main().catch((err) => {
  console.error('[postulacion] fallo fatal:', err);
  process.exitCode = 1;
});

