// CompraAgil FirmaVB - Content Script V4
// Orquesta el scraping y sincroniza con Supabase
// Fix: API key actualizada

const SUPABASE_URL = 'https://juiskeeutbaipwbeeezw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1aXNrZWV1dGJhaXB3YmVlZXp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4OTg2ODQsImV4cCI6MjA4MzQ3NDY4NH0.RLiTsgTl5Xbh1NetQIOB3tBH1EQa9ehcHfWIa4MJWf4';

let syncedCodes = new Set();
let isProcessing = false;

console.log('[FirmaVB] Content script V4 cargado en:', window.location.href);

// Esperar a que el scraper este disponible
function waitForScraper() {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      if (window.FirmaVBScraper) {
        console.log('[FirmaVB] Scraper disponible');
        resolve(true);
      } else if (attempts >= 50) {
        console.warn('[FirmaVB] Timeout esperando scraper');
        resolve(false);
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

// Esperar a que la pagina cargue resultados
function waitForResults() {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const hasCOT = document.body.innerText.includes('COT');
      const hasResults = document.body.innerText.includes('resultados');
      if ((hasCOT && hasResults) || attempts >= 60) {
        console.log('[FirmaVB] Pagina con resultados detectada');
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

// Sincronizar compras con Supabase
async function syncToSupabase(licitaciones) {
  if (!licitaciones || licitaciones.length === 0) {
    console.log('[FirmaVB] No hay compras para sincronizar');
    return { success: true, count: 0 };
  }
  
  // Filtrar ya sincronizadas
  const nuevas = licitaciones.filter(l => !syncedCodes.has(l.codigo));
  if (nuevas.length === 0) {
    console.log('[FirmaVB] Todas las compras ya sincronizadas');
    return { success: true, count: 0 };
  }
  
  console.log('[FirmaVB] Sincronizando', nuevas.length, 'compras...');
  console.log('[FirmaVB] Ejemplo:', JSON.stringify(nuevas[0], null, 2));
  
  try {
    // Llamar a la funcion RPC de Supabase
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_compras_agiles_batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ 
        compras_data: nuevas.map(l => ({
          codigo: l.codigo,
          titulo: l.nombre,
          organismo: l.institucion_nombre || '',
          fecha_publicacion: l.fecha_publicacion ? l.fecha_publicacion + 'T00:00:00-03:00' : null,
          fecha_cierre: l.fecha_cierre ? l.fecha_cierre + 'T00:00:00-03:00' : null,
          presupuesto: l.presupuesto_estimado,
          estado: l.estado || 'publicada',
          url: l.link_oficial
        }))
      })
    });
    
    const responseText = await response.text();
    console.log('[FirmaVB] Respuesta:', response.status, responseText);
    
    if (response.ok) {
      nuevas.forEach(l => syncedCodes.add(l.codigo));
      console.log('[FirmaVB] Sincronizacion exitosa!');
      return { success: true, count: nuevas.length };
    } else {
      console.error('[FirmaVB] Error:', responseText);
      return { success: false, error: responseText };
    }
  } catch (e) {
    console.error('[FirmaVB] Error de red:', e);
    return { success: false, error: e.message };
  }
}

// Proceso principal
async function processPage() {
  if (isProcessing) return;
  isProcessing = true;
  
  try {
    console.log('[FirmaVB] Iniciando procesamiento...');
    
    // Esperar scraper
    const scraperReady = await waitForScraper();
    if (!scraperReady) {
      console.error('[FirmaVB] Scraper no disponible');
      return;
    }
    
    // Esperar resultados
    await waitForResults();
    
    // Ejecutar scraping
    console.log('[FirmaVB] Ejecutando scraper...');
    const result = window.FirmaVBScraper.scrapeList();
    console.log('[FirmaVB] Scraper devolvio:', result?.licitaciones?.length || 0, 'compras');
    
    // Sincronizar
    if (result && result.licitaciones && result.licitaciones.length > 0) {
      await syncToSupabase(result.licitaciones);
    } else {
      console.log('[FirmaVB] El scraper no encontro compras');
    }
  } catch (e) {
    console.error('[FirmaVB] Error en procesamiento:', e);
  } finally {
    isProcessing = false;
  }
}

// Listener para mensajes del popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'MANUAL_SYNC') {
    processPage().then(() => {
      sendResponse({ success: true });
    }).catch(e => {
      sendResponse({ success: false, error: e.message });
    });
    return true;
  }
});

// Ejecutar automaticamente
if (window.location.pathname.includes('/compra-agil')) {
  console.log('[FirmaVB] Pagina de Compra Agil detectada');
  // Esperar un poco para que React y scraper.js carguen
  setTimeout(processPage, 3000);
}
