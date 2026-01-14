// Manifest V3 service worker
// Integra la extensión con pending_sync_server (GET /api/pending-sync, POST /api/pending-sync/complete)
//
// Nota MV3:
// - NO uses setInterval para polling: el service worker “duerme” y se mata.
// - chrome.alarms es el mecanismo recomendado. PeriodInMinutes mínimo ~1 minuto.

const DEFAULT_PENDING_SYNC_URL = 'https://tu-servidor.com';

async function getConfig() {
  const stored = await chrome.storage.local.get(['PENDING_SYNC_URL', 'PENDING_SYNC_API_KEY']);
  return {
    PENDING_SYNC_URL: stored.PENDING_SYNC_URL || DEFAULT_PENDING_SYNC_URL,
    PENDING_SYNC_API_KEY: stored.PENDING_SYNC_API_KEY || ''
  };
}

function buildHeaders(apiKey) {
  const h = { 'content-type': 'application/json' };
  if (apiKey) h['x-api-key'] = apiKey;
  return h;
}

async function fetchJson(url, { method = 'GET', headers, body } = {}) {
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}

let isRunning = false;

async function withTab(url, fn) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    // esperar carga básica
    await new Promise((resolve) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // safety timeout
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 45000);
    });
    return await fn(tab.id);
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {}
  }
}

async function runContentScraper(tabId, task) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: async (taskArg) => {
      // Cargamos el scraper desde el mismo archivo content script (injected)
      // En MV3, no podemos "import" directamente aquí; usamos dinámica de runtime.
      // Este bloque se reemplaza al inyectar scraper.js abajo.
      return { ok: false, error: 'scraper_not_injected', task: taskArg };
    },
    args: [task]
  });
  return result;
}

async function injectAndScrape(tabId, task) {
  // Inyectar scraper.js en la página
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['scraper.js']
  });

  // Ejecutar función global expuesta por scraper.js
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'ISOLATED',
    func: async (taskArg) => {
      if (typeof window.__FIRMAVB_SCRAPE_TASK__ !== 'function') {
        return { ok: false, error: 'missing_scrape_function' };
      }
      try {
        const payload = await window.__FIRMAVB_SCRAPE_TASK__(taskArg);
        return { ok: true, payload };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    },
    args: [task]
  });

  return result;
}

async function processPendingSyncTasks() {
  if (isRunning) return;
  isRunning = true;
  const { PENDING_SYNC_URL, PENDING_SYNC_API_KEY } = await getConfig();
  if (!PENDING_SYNC_URL) {
    isRunning = false;
    return;
  }

  const headers = buildHeaders(PENDING_SYNC_API_KEY);
  const listUrl = new URL('/api/pending-sync', PENDING_SYNC_URL);
  listUrl.searchParams.set('limit', '5');

  try {
    const data = await fetchJson(listUrl.toString(), { headers });
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) return;

    for (const task of items) {
      const taskUrl = task.url;
      if (!taskUrl) continue;

      try {
        const scrapeResult = await withTab(taskUrl, async (tabId) => {
          return await injectAndScrape(tabId, task);
        });

        if (!scrapeResult?.ok) {
          const errMsg = scrapeResult?.error || 'scrape_failed';
          await fetchJson(new URL('/api/pending-sync/complete', PENDING_SYNC_URL).toString(), {
            method: 'POST',
            headers,
            body: { id: task.id, status: 'failed', last_error: errMsg }
          });
          continue;
        }

        await fetchJson(new URL('/api/pending-sync/complete', PENDING_SYNC_URL).toString(), {
          method: 'POST',
          headers,
          body: { id: task.id, payload: scrapeResult.payload }
        });
      } catch (e) {
        // Best-effort: marcar failed si se puede
        try {
          await fetchJson(new URL('/api/pending-sync/complete', PENDING_SYNC_URL).toString(), {
            method: 'POST',
            headers,
            body: { id: task.id, status: 'failed', last_error: String(e?.message || e) }
          });
        } catch (_) {}
      }
    }
  } finally {
    isRunning = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // MV3: periodInMinutes mínimo ~1; 30s no es soportado por alarms.
  chrome.alarms.create('pending-sync-check', { periodInMinutes: 1 });
  processPendingSyncTasks();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pending-sync-check') {
    processPendingSyncTasks();
  }
});

// Permite disparar manualmente desde DevTools/Popup si lo agregan
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'RUN_PENDING_SYNC_NOW') {
    processPendingSyncTasks()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
});

