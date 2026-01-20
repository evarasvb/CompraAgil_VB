// CompraAgil FirmaVB - Content Script
// Se ejecuta automaticamente en buscador.mercadopublico.cl/compra-agil

const SUPABASE_URL = 'https://juiskeeutbaipwbeeezw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1aXNrZWV1dGJhaXB3YmVlZXp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzU0MTk2NTYsImV4cCI6MjA1MDk5NTY1Nn0.EwCkMvbGWChwM95RZwlNr7tHvl2TxZCbKe3Flx17KFI';

let syncedCodes = new Set();
let isExtracting = false;

console.log('[FirmaVB] Extension activa');

// Funcion para parsear fecha chilena (DD/MM/YYYY)
function parseDate(dateStr) {
  if (!dateStr) return null;
  try {
    const match = dateStr.match(/(\d{1,2})\/(\d{2})\/(\d{4})/);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}T00:00:00-03:00`;
    }
  } catch (e) {}
  return null;
}

// Funcion para parsear monto chileno ($ 700.000)
function parseMonto(montoStr) {
  if (!montoStr) return null;
  try {
    const cleaned = montoStr.replace(/[$\s.]/g, '').replace(',', '.');
    const num = parseInt(cleaned);
    return isNaN(num) ? null : num;
  } catch (e) {
    return null;
  }
}

// Extraer compras del listado - Version mejorada
function extractComprasFromListado() {
  const compras = [];
  
  // Buscar todos los codigos de compra agil (patron: XXXXXX-XX-COTXX o similar)
  const allElements = document.querySelectorAll('*');
  const codigoPattern = /^\d+-\d+-COT\d+$/i;
  
  const codigoElements = [];
  allElements.forEach(el => {
    const text = el.innerText?.trim();
    if (text && codigoPattern.test(text) && el.children.length === 0) {
      codigoElements.push(el);
    }
  });
  
  console.log('[FirmaVB] Codigos encontrados:', codigoElements.length);
  
  codigoElements.forEach(codigoEl => {
    try {
      const codigo = codigoEl.innerText.trim();
      
      if (syncedCodes.has(codigo)) return;
      
      // Buscar el contenedor padre de la tarjeta (subiendo varios niveles)
      let card = codigoEl.parentElement;
      for (let i = 0; i < 10 && card; i++) {
        if (card.innerText && card.innerText.includes('Publicada el') && card.innerText.includes('Finaliza el')) {
          break;
        }
        card = card.parentElement;
      }
      
      if (!card) return;
      
      const cardText = card.innerText || '';
      
      // Extraer titulo (heading despues del codigo)
      let nombre = '';
      const headings = card.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const h of headings) {
        const hText = h.innerText?.trim();
        if (hText && !hText.match(/^\d/) && !hText.includes('$') && hText.length > 10) {
          nombre = hText;
          break;
        }
      }
      if (!nombre) nombre = codigo;
      
      // Extraer fechas
      let fechaPub = null;
      let fechaCierre = null;
      const fechaMatches = cardText.match(/(\d{2}\/\d{2}\/\d{4})/g);
      if (fechaMatches && fechaMatches.length >= 1) {
        fechaPub = parseDate(fechaMatches[0]);
        if (fechaMatches.length >= 2) {
          fechaCierre = parseDate(fechaMatches[1]);
        }
      }
      
      // Extraer monto
      let monto = null;
      const montoMatch = cardText.match(/\$\s*[\d.,]+/);
      if (montoMatch) {
        monto = parseMonto(montoMatch[0]);
      }
      
      // Extraer organismo (texto largo en mayusculas)
      let organismo = '';
      const lines = cardText.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 20 && trimmed === trimmed.toUpperCase() && !trimmed.includes('$')) {
          organismo = trimmed;
          break;
        }
      }
      
      // Extraer estado
      let estado = 'Publicada';
      if (cardText.includes('Recibiendo cotizaciones')) {
        estado = 'Recibiendo cotizaciones';
      } else if (cardText.includes('Cerrada')) {
        estado = 'Cerrada';
      } else if (cardText.includes('Adjudicada')) {
        estado = 'Adjudicada';
      }
      
      compras.push({
        codigo,
        nombre: nombre.substring(0, 500),
        descripcion: '',
        estado,
        fecha_publicacion: fechaPub || new Date().toISOString(),
        fecha_cierre: fechaCierre,
        monto_estimado: monto,
        nombre_organismo: organismo,
        region: null,
        url_ficha: `https://buscador.mercadopublico.cl/compra-agil/ficha?code=${codigo}`
      });
      
    } catch (e) {
      console.error('[FirmaVB] Error extrayendo:', e);
    }
  });
  
  return compras;
}

// Enviar a Supabase
async function syncToSupabase(compras) {
  if (!compras || compras.length === 0) return { success: true, count: 0 };
  
  console.log('[FirmaVB] Sincronizando', compras.length, 'compras a Supabase');
  
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_compras_agiles_batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ compras })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    console.log('[FirmaVB] Resultado sync:', result);
    
    // Marcar como sincronizados
    compras.forEach(c => syncedCodes.add(c.codigo));
    
    // Notificar al background
    chrome.runtime.sendMessage({ 
      type: 'SYNC_COMPLETE', 
      count: compras.length 
    });
    
    return result;
  } catch (error) {
    console.error('[FirmaVB] Error en sync:', error);
    chrome.runtime.sendMessage({ 
      type: 'SYNC_ERROR', 
      error: error.message 
    });
    throw error;
  }
}

// Ejecutar extraccion y sincronizacion
async function runExtraction() {
  if (isExtracting) return;
  isExtracting = true;
  
  try {
    const compras = extractComprasFromListado();
    console.log('[FirmaVB] Encontradas', compras.length, 'compras nuevas');
    
    if (compras.length > 0) {
      await syncToSupabase(compras);
    }
  } catch (e) {
    console.error('[FirmaVB] Error en extraccion:', e);
  } finally {
    isExtracting = false;
  }
}

// Esperar a que la pagina cargue completamente
function waitForResults() {
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 30;
    
    const check = () => {
      attempts++;
      // Buscar indicadores de que los resultados cargaron
      const hasResults = document.body.innerText.includes('resultados para tu búsqueda') ||
                         document.body.innerText.includes('COT');
      
      if (hasResults || attempts >= maxAttempts) {
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    
    check();
  });
}

// Iniciar cuando la pagina este lista
async function init() {
  console.log('[FirmaVB] Esperando carga de resultados...');
  await waitForResults();
  console.log('[FirmaVB] Pagina cargada, extrayendo...');
  await runExtraction();
}

// Escuchar mensajes del popup para sincronizacion manual
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'MANUAL_SYNC') {
    runExtraction().then(() => {
      sendResponse({ success: true });
    }).catch(e => {
      sendResponse({ success: false, error: e.message });
    });
    return true;
  }
});

// Ejecutar
if (window.location.pathname.includes('/compra-agil')) {
  // Esperar un poco para que React renderice
  setTimeout(init, 2000);
}

console.log('[FirmaVB] Content script cargado');
