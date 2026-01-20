// CompraAgil FirmaVB - Content Script
// Se ejecuta automaticamente en buscador.mercadopublico.cl/compra-agil

const SUPABASE_URL = 'https://juiskeeutbaipwbeeezw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1aXNrZWV1dGJhaXB3YmVlZXp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjQ2OTkxNzAsImV4cCI6MjA0MDI3NTE3MH0.m6IZaWo91s9aOMpIX1rJ7l5D1k01CJQ0u0K7dF3p2XY';

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

// Extraer compras usando la estructura real del DOM
function extractCompras() {
  const compras = [];
  
  // Buscar todos los elementos de texto en la pagina
  const allElements = document.querySelectorAll('*');
  const textNodes = [];
  
  allElements.forEach(el => {
    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === Node.TEXT_NODE) {
      const text = el.textContent.trim();
      if (text) {
        textNodes.push({ element: el, text: text });
      }
    }
  });
  
  // Buscar codigos COT (patron: XXXXXX-XX-COTXX o similar)
  const codigoPattern = /^\d+-\d+-COT\d+$/;
  const codigoElements = textNodes.filter(n => codigoPattern.test(n.text));
  
  console.log('[FirmaVB] Codigos encontrados:', codigoElements.length);
  
  codigoElements.forEach(codigoNode => {
    try {
      const codigo = codigoNode.text;
      const codigoEl = codigoNode.element;
      
      // Buscar el contenedor padre (tarjeta de compra)
      let container = codigoEl.parentElement;
      for (let i = 0; i < 10 && container; i++) {
        if (container.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
          break;
        }
        container = container.parentElement;
      }
      
      if (!container) container = codigoEl.parentElement?.parentElement?.parentElement;
      
      // Buscar titulo (heading cerca del codigo)
      let titulo = '';
      const headings = container?.querySelectorAll('h1, h2, h3, h4, h5, h6') || [];
      for (const h of headings) {
        const hText = h.textContent.trim();
        // El titulo no es una fecha ni un monto
        if (hText && !hText.match(/^\d{2}\/\d{2}\/\d{4}$/) && !hText.match(/^\$\s/)) {
          titulo = hText;
          break;
        }
      }
      
      // Buscar fechas (formato DD/MM/YYYY en headings)
      const fechaHeadings = [];
      headings.forEach(h => {
        const hText = h.textContent.trim();
        if (hText.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
          fechaHeadings.push(hText);
        }
      });
      
      const fechaPublicacion = fechaHeadings[0] || '';
      const fechaCierre = fechaHeadings[1] || '';
      
      // Buscar presupuesto ($ XXX.XXX en headings)
      let presupuesto = null;
      headings.forEach(h => {
        const hText = h.textContent.trim();
        if (hText.match(/^\$\s/)) {
          presupuesto = parseMonto(hText);
        }
      });
      
      // Buscar organismo (texto largo con mayusculas)
      let organismo = '';
      const allTexts = container?.querySelectorAll('*') || [];
      for (const el of allTexts) {
        if (el.childNodes.length === 1 && el.childNodes[0].nodeType === Node.TEXT_NODE) {
          const txt = el.textContent.trim();
          // Organismo: texto largo, mayusculas, no es codigo ni fecha
          if (txt.length > 15 && txt === txt.toUpperCase() && 
              !codigoPattern.test(txt) && !txt.includes('/') && !txt.includes('$')) {
            organismo = txt;
            break;
          }
        }
      }
      
      // Solo agregar si tenemos codigo y titulo
      if (codigo && titulo) {
        compras.push({
          codigo: codigo,
          titulo: titulo,
          organismo: organismo,
          fecha_publicacion: parseDate(fechaPublicacion),
          fecha_cierre: parseDate(fechaCierre),
          presupuesto: presupuesto,
          estado: 'publicada',
          url: `https://buscador.mercadopublico.cl/compra-agil/${codigo}`
        });
      }
    } catch (e) {
      console.error('[FirmaVB] Error procesando compra:', e);
    }
  });
  
  return compras;
}

// Sincronizar con Supabase
async function syncToSupabase(compras) {
  if (compras.length === 0) {
    console.log('[FirmaVB] No hay compras nuevas para sincronizar');
    return { success: true, count: 0 };
  }
  
  // Filtrar las que ya fueron sincronizadas
  const nuevas = compras.filter(c => !syncedCodes.has(c.codigo));
  
  if (nuevas.length === 0) {
    console.log('[FirmaVB] Todas las compras ya fueron sincronizadas');
    return { success: true, count: 0 };
  }
  
  console.log('[FirmaVB] Sincronizando', nuevas.length, 'compras nuevas...');
  
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_compras_agiles_batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ compras_data: nuevas })
    });
    
    if (response.ok) {
      nuevas.forEach(c => syncedCodes.add(c.codigo));
      console.log('[FirmaVB] Sincronizacion exitosa:', nuevas.length, 'compras');
      return { success: true, count: nuevas.length };
    } else {
      const error = await response.text();
      console.error('[FirmaVB] Error en sincronizacion:', error);
      return { success: false, error: error };
    }
  } catch (e) {
    console.error('[FirmaVB] Error de red:', e);
    return { success: false, error: e.message };
  }
}

// Ejecutar extraccion
async function runExtraction() {
  if (isExtracting) return;
  isExtracting = true;
  
  try {
    const compras = extractCompras();
    console.log('[FirmaVB] Encontradas', compras.length, 'compras');
    
    if (compras.length > 0) {
      console.log('[FirmaVB] Primera compra:', compras[0]);
      const result = await syncToSupabase(compras);
      return result;
    }
    return { success: true, count: 0 };
  } finally {
    isExtracting = false;
  }
}

// Esperar a que la pagina cargue resultados
function waitForResults() {
  return new Promise((resolve) => {
    const maxAttempts = 20;
    let attempts = 0;
    
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
