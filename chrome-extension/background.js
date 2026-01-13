const DEFAULT_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  clienteId: ''
};

async function getConfig() {
  const cfg = await chrome.storage.sync.get(DEFAULT_CONFIG);
  return {
    supabaseUrl: String(cfg.supabaseUrl || '').trim(),
    supabaseAnonKey: String(cfg.supabaseAnonKey || '').trim(),
    clienteId: String(cfg.clienteId || '').trim()
  };
}

function supabaseRestBase(url) {
  return url.replace(/\/+$/, '') + '/rest/v1';
}

async function supabaseRequest({ supabaseUrl, supabaseAnonKey, path, method = 'GET', body = null, prefer = null }) {
  const url = supabaseRestBase(supabaseUrl) + path;
  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
    'content-type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = typeof data === 'object' && data && data.message ? data.message : text;
    throw new Error(`Supabase HTTP ${res.status}: ${String(msg).slice(0, 500)}`);
  }
  return data;
}

async function fetchOffers({ codigo }) {
  const cfg = await getConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !cfg.clienteId) {
    throw new Error('Falta configuración (Supabase URL/anon key/cliente_id).');
  }

  // Query PostgREST:
  // /cliente_ofertas?select=...&cliente_id=eq...&estado=eq.aprobada&or=(licitacion_codigo.eq.X,compra_agil_codigo.eq.X)
  const select =
    'id,cliente_id,estado,licitacion_codigo,compra_agil_codigo,match_score,monto_oferta,oferta_id_mp,respuesta_mp,payload_postulacion,updated_at';
  const q = new URLSearchParams();
  q.set('select', select);
  q.set('cliente_id', `eq.${cfg.clienteId}`);
  q.set('estado', 'eq.aprobada');
  q.set('or', `(licitacion_codigo.eq.${codigo},compra_agil_codigo.eq.${codigo})`);
  q.set('order', 'updated_at.desc');

  const path = `/cliente_ofertas?${q.toString()}`;
  return await supabaseRequest({ supabaseUrl: cfg.supabaseUrl, supabaseAnonKey: cfg.supabaseAnonKey, path });
}

async function updateOffer({ offerId, patch }) {
  const cfg = await getConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    throw new Error('Falta configuración (Supabase URL/anon key).');
  }
  const q = new URLSearchParams();
  q.set('id', `eq.${offerId}`);
  const path = `/cliente_ofertas?${q.toString()}`;
  const data = await supabaseRequest({
    supabaseUrl: cfg.supabaseUrl,
    supabaseAnonKey: cfg.supabaseAnonKey,
    path,
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation'
  });
  return data;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'FETCH_OFFERS') {
        const data = await fetchOffers({ codigo: msg.codigo });
        sendResponse({ ok: true, data });
        return;
      }
      if (msg?.type === 'UPDATE_OFFER') {
        const data = await updateOffer({ offerId: msg.offerId, patch: msg.patch });
        sendResponse({ ok: true, data });
        return;
      }
      sendResponse({ ok: false, error: 'Mensaje no soportado' });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});

