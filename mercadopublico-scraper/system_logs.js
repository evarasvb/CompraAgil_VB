require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

function env(name, fallback = '') {
  const v = process.env[name];
  return v == null ? fallback : String(v);
}

function safeString(v, maxLen) {
  const s = v == null ? '' : String(v);
  return maxLen ? s.slice(0, maxLen) : s;
}

function safeJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  // permitir strings/nums/bools
  return { value: v };
}

let cachedClient = null;
function getSupabaseClientOrNull() {
  if (cachedClient) return cachedClient;
  const url = env('SUPABASE_URL').trim();
  // Preferir service key si existe (scrapers), sino anon key (extensión/cliente)
  const key = env('SUPABASE_SERVICE_KEY').trim() || env('SUPABASE_KEY').trim();
  if (!url || !key) return null;
  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

/**
 * Inserta un evento en `system_logs`.
 * IMPORTANT: nunca debe romper el flujo principal (best-effort).
 */
async function logSystemEvent(level, component, message, meta) {
  try {
    const supabase = getSupabaseClientOrNull();
    if (!supabase) return;

    const row = {
      level: safeString(level || 'INFO', 32),
      component: safeString(component || 'UNKNOWN', 64),
      message: safeString(message || '', 2000),
      metadata: safeJson(meta)
    };

    // No fallar por campos obligatorios vacíos
    if (!row.message) return;

    const { error } = await supabase.from('system_logs').insert(row);
    if (error) {
      // Best-effort: nunca throw
      console.warn(`[system_logs] warning: no pude insertar log: ${error.message}`);
    }
  } catch (e) {
    // Best-effort: nunca throw
    console.warn(`[system_logs] warning: excepción al loggear: ${String(e?.message || e)}`);
  }
}

module.exports = { logSystemEvent };

