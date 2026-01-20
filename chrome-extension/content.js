// CompraAgil FirmaVB - Content Script V2
// Se ejecuta en buscador.mercadopublico.cl/compra-agil

const SUPABASE_URL = 'https://juiskeeutbaipwbeeezw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1aXNrZWV1dGJhaXB3YmVlZXp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjQ2OTkxNzAsImV4cCI6MjA0MDI3NTE3MH0.m6IZaWo91s9aOMpIX1rJ7l5D1k01CJQ0u0K7dF3p2XY';

let syncedCodes = new Set();
let isExtracting = false;

console.log('[FirmaVB] Extension activa en:', window.location.href);

// Parsear fecha DD/MM/YYYY a ISO
function parseDate(dateStr) {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{1,2})\/(\d{2})\/(\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}T00:00:00-03:00`;
  }
  return null;
}

// Parsear monto $ 700.000 a numero
function parseMonto(str) {
  if (!str) return null;
  const cleaned = str.replace(/[$\s.]/g, '').replace(',', '.');
  const num = parseInt(cleaned);
  return isNaN(num) ? null : num;
}

// Extraer compras del DOM - Version simplificada
function extractCompras() {
  const compras = [];
  const codigoRegex = /^\d+-\d+-COT\d+$/;
  
  // Buscar todos los elementos de texto que coincidan con patron COT
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  const codigoNodes = [];
  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (codigoRegex.test(text)) {
      codigoNodes.push({ node: node, codigo: text });
    }
  }
  
  console.log('[FirmaVB] Codigos COT encontrados:', codigoNodes.length);
  
  codigoNodes.forEach(({ node, codigo }) => {
    try {
      // Subir en el DOM hasta encontrar el contenedor de la tarjeta
      let card = node.parentElement;
      for (let i = 0; i < 15 && card; i++) {
        // La tarjeta tiene multiples headings (titulo, fechas, monto)
        const headings = card.querySelectorAll('h1, h2, h3, h4, h5, h6');
        if (headings.length >= 4) break;
        card = card.parentElement;
      }
      
      if (!card) {
        console.log('[FirmaVB] No se encontro tarjeta para:', codigo);
        return;
      }
      
      // Extraer headings
      const headings = Array.from(card.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      
      let titulo = '';
      let fechas = [];
      let presupuesto = null;
      
      headings.forEach(h => {
        const text = h.textContent.trim();
        // Es fecha si tiene formato DD/MM/YYYY
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
          fechas.push(text);
        }
        // Es monto si empieza con $
        else if (/^\$\s/.test(text)) {
          presupuesto = parseMonto(text);
        }
        // Es titulo si no es fecha, monto, ni muy corto
        else if (text.length > 10 && !text.includes('Filtrar')) {
          if (!titulo) titulo = text;
        }
      });
      
      // Buscar organismo (texto en mayusculas)
      let organismo = '';
      const allText = card.innerText;
      const orgMatch = allText.match(/([A-Z]{3,}[A-Z\s]+(?:DE|DEL|Y|LA|EL|REGION|MUNICIPAL|SALUD|SERVICIO)[A-Z\s]+)/g);
      if (orgMatch && orgMatch.length > 0) {
        organismo = orgMatch[0].trim();
      }
      
      if (titulo) {
        compras.push({
          codigo: codigo,
          titulo: titulo,
          organismo: organismo,
          fecha_publicacion: parseDate(fechas[0]),
          fecha_cierre: parseDate(fechas[1]),
          presupuesto: presupuesto,
          estado: 'publicada',
          url: `https://buscador.mercadopublico.cl/compra-agil/${codigo}`
        });
      }
    } catch (e) {
      console.error('[FirmaVB] Error extrayendo:', codigo, e);
    }
  });
  
  return compras;
}

// Sincronizar con Supabase
async function syncToSupabase(compras) {
  if (compras.length === 0) {
    console.log('[FirmaVB] No hay compras para sincronizar');
    return { success: true, count: 0 };
  }
  
  const nuevas = compras.filter(c => !syncedCodes.has(c.codigo));
  if (nuevas.length === 0) {
    console.log('[FirmaVB] Todas ya sincronizadas');
    return { success: true, count: 0 };
  }
  
  console.log('[FirmaVB] Sincronizando', nuevas.length, 'compras...');
  console.log('[FirmaVB] Primera:', JSON.stringify(nuevas[0], null, 2));
  
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
    
    const responseText = await response.text();
    console.log('[FirmaVB] Respuesta Supabase:', response.status, responseText);
    
    if (response.ok) {
      nuevas.forEach(c => syncedCodes.add(c.codigo));
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

// Ejecutar extraccion
async function runExtraction() {
  if (isExtracting) return;
  isExtracting = true;
  
  try {
    console.log('[FirmaVB] Iniciando extraccion...');
    const compras = extractCompras();
    console.log('[FirmaVB] Compras extraidas:', compras.length);
    
    if (compras.length > 0) {
      return await syncToSupabase(compras);
    }
    return { success: true, count: 0 };
  } finally {
    isExtracting = false;
  }
}

// Esperar carga de pagina
function waitForResults() {
  return new Promise(resolve => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const hasResults = document.body.innerText.includes('COT');
      if (hasResults || attempts >= 30) {
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

// Inicializar
async function init() {
  console.log('[FirmaVB] Esperando resultados...');
  await waitForResults();
  console.log('[FirmaVB] Pagina lista, extrayendo...');
  await runExtraction();
}

// Escuchar mensajes del popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'MANUAL_SYNC') {
    runExtraction().then(result => {
      sendResponse(result);
    }).catch(e => {
      sendResponse({ success: false, error: e.message });
    });
    return true;
  }
});

// Ejecutar si estamos en compra-agil
if (window.location.pathname.includes('/compra-agil')) {
  console.log('[FirmaVB] Pagina de Compra Agil detectada');
  setTimeout(init, 3000); // Esperar 3 segundos para React
}
