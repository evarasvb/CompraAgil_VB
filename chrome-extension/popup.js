const DEFAULT_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  clienteId: ''
};

function $(id) {
  return document.getElementById(id);
}

function setStatus(id, text) {
  const el = $(id);
  if (!el) return;
  el.textContent = text || '';
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadConfig() {
  const cfg = await chrome.storage.sync.get(DEFAULT_CONFIG);
  $('supabaseUrl').value = cfg.supabaseUrl || '';
  $('supabaseAnonKey').value = cfg.supabaseAnonKey || '';
  $('clienteId').value = cfg.clienteId || '';
  setStatus('configStatus', 'Configuración cargada.');
  return cfg;
}

async function saveConfig() {
  const cfg = {
    supabaseUrl: String($('supabaseUrl').value || '').trim(),
    supabaseAnonKey: String($('supabaseAnonKey').value || '').trim(),
    clienteId: String($('clienteId').value || '').trim()
  };
  await chrome.storage.sync.set(cfg);
  setStatus('configStatus', 'Guardado.');
  return cfg;
}

function renderOffers(offers, codigo, url) {
  const root = $('offers');
  root.innerHTML = '';

  if (!offers || !offers.length) {
    root.innerHTML = '<div class="muted">No hay ofertas aprobadas para este código.</div>';
    return;
  }

  for (const o of offers) {
    const div = document.createElement('div');
    div.className = 'offer';

    const title = document.createElement('div');
    title.className = 'offerTitle';
    title.textContent = `Oferta ${o.id}`;

    const meta = document.createElement('div');
    meta.className = 'offerMeta';
    meta.textContent = `estado=${o.estado} | match_score=${o.match_score ?? '-'} | lic=${o.licitacion_codigo ?? '-'} | ca=${o.compra_agil_codigo ?? '-'}`;

    const actions = document.createElement('div');
    actions.className = 'offerActions';

    const btnEnviar = document.createElement('button');
    btnEnviar.className = 'primary';
    btnEnviar.textContent = 'Marcar enviada';
    btnEnviar.addEventListener('click', async () => {
      setStatus('syncStatus', 'Actualizando en Supabase...');
      const r = await chrome.runtime.sendMessage({
        type: 'UPDATE_OFFER',
        offerId: o.id,
        patch: {
          estado: 'enviada',
          oferta_id_mp: null,
          respuesta_mp: {
            source: 'chrome-extension',
            action: 'mark_enviada',
            codigo_detectado: codigo,
            url,
            ts: new Date().toISOString()
          }
        }
      });
      if (r?.ok) {
        setStatus('syncStatus', 'Oferta marcada como enviada.');
        await syncOffers();
      } else {
        setStatus('syncStatus', `Error: ${r?.error || 'desconocido'}`);
      }
    });

    const btnFallo = document.createElement('button');
    btnFallo.className = 'danger';
    btnFallo.textContent = 'Marcar fallida';
    btnFallo.addEventListener('click', async () => {
      setStatus('syncStatus', 'Actualizando en Supabase...');
      const r = await chrome.runtime.sendMessage({
        type: 'UPDATE_OFFER',
        offerId: o.id,
        patch: {
          estado: 'fallida',
          respuesta_mp: {
            source: 'chrome-extension',
            action: 'mark_fallida',
            codigo_detectado: codigo,
            url,
            ts: new Date().toISOString()
          }
        }
      });
      if (r?.ok) {
        setStatus('syncStatus', 'Oferta marcada como fallida.');
        await syncOffers();
      } else {
        setStatus('syncStatus', `Error: ${r?.error || 'desconocido'}`);
      }
    });

    const btnPayload = document.createElement('button');
    btnPayload.className = 'secondary';
    btnPayload.textContent = 'Ver payload';
    btnPayload.addEventListener('click', async () => {
      alert(safeJson(o.payload_postulacion || o.respuesta_mp || {}));
    });

    actions.appendChild(btnEnviar);
    actions.appendChild(btnFallo);
    actions.appendChild(btnPayload);

    div.appendChild(title);
    div.appendChild(meta);
    div.appendChild(actions);
    root.appendChild(div);
  }
}

async function getCodigoFromContent(tabId) {
  const resp = await chrome.tabs.sendMessage(tabId, { type: 'GET_CODIGO' });
  return resp?.codigo || null;
}

async function syncOffers() {
  setStatus('syncStatus', 'Sincronizando...');
  const cfg = await chrome.storage.sync.get(DEFAULT_CONFIG);
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !cfg.clienteId) {
    setStatus('syncStatus', 'Falta configurar Supabase URL / anon key / cliente_id.');
    return;
  }

  const tab = await getActiveTab();
  const url = tab?.url || '';
  $('urlActual').textContent = url || '—';

  let codigo = null;
  try {
    codigo = tab?.id ? await getCodigoFromContent(tab.id) : null;
  } catch {
    codigo = null;
  }
  $('codigoDetectado').textContent = codigo || '—';

  if (!codigo) {
    setStatus('syncStatus', 'No se detectó código en la página.');
    renderOffers([], codigo, url);
    return;
  }

  const r = await chrome.runtime.sendMessage({ type: 'FETCH_OFFERS', codigo });
  if (!r?.ok) {
    setStatus('syncStatus', `Error: ${r?.error || 'desconocido'}`);
    renderOffers([], codigo, url);
    return;
  }

  setStatus('syncStatus', `Ofertas aprobadas: ${r.data.length}`);
  renderOffers(r.data, codigo, url);
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();

  $('saveConfig').addEventListener('click', async () => {
    await saveConfig();
  });
  $('loadConfig').addEventListener('click', async () => {
    await loadConfig();
  });
  $('sync').addEventListener('click', async () => {
    await syncOffers();
  });

  // Auto-llenar contexto inicial
  await syncOffers();
});

