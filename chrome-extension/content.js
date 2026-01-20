// CompraAgil FirmaVB - Content Script
// Se ejecuta automaticamente en buscador.mercadopublico.cl/compra-agil

const SUPABASE_URL = 'https://juiskeeutbaipwbeeezw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1aXNrZWV1dGJhaXB3YmVlZXp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4OTg2ODQsImV4cCI6MjA4MzQ3NDY4NH0.RLiTsgTl5Xbh1NetQIOB3tBH1EQa9ehcHfWIa4MJWf4';

let syncedCodes = new Set();
let isExtracting = false;

// Funcion para parsear fecha chilena
function parseDate(dateStr) {
  try {
    const match = dateStr.match(/(\d{1,2})[\/\-](\d{2})[\/\-](\d{4})/);
    if (match) {
      const [, day, month, year] = match;
      const timeMatch = dateStr.match(/(\d{1,2}):(\d{2})/);
      const hour = timeMatch ? timeMatch[1].padStart(2,'0') : '00';
      const minute = timeMatch ? timeMatch[2] : '00';
      return `${year}-${month}-${day.padStart(2,'0')}T${hour}:${minute}:00-03:00`;
    }
  } catch (e) {}
  return null;
}

// Extraer compras del listado
function extractComprasFromListado() {
  const compras = [];
  const links = document.querySelectorAll('a[href*="/ficha?code="]');
  
  links.forEach(link => {
    try {
      const href = link.getAttribute('href') || '';
      const codeMatch = href.match(/code=([A-Z0-9\-]+)/i);
      if (!codeMatch) return;
      
      const codigo = codeMatch[1];
      if (syncedCodes.has(codigo)) return;
      
      // Buscar contenedor padre
      let container = link;
      for (let i = 0; i < 5; i++) {
        if (container.parentElement) container = container.parentElement;
      }
      
      const text = container.innerText || '';
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      let nombre = '';
      let estado = 'Publicada';
      let fechaPub = null;
      let fechaCierre = null;
      let monto = null;
      let organismo = '';
      
      lines.forEach(line => {
        if (line.match(/publicada|recibiendo|cerrada|adjudicada/i)) {
          estado = line.split(' ')[0];
        }
        if (line.match(/\d{2}\/\d{2}\/\d{4}/)) {
          if (!fechaPub) fechaPub = parseDate(line);
          else if (!fechaCierre) fechaCierre = parseDate(line);
        }
        if (line.match(/\$\s*[\d.,]+/)) {
          const m = line.match(/\$\s*([\d.,]+)/);
          if (m) monto = parseInt(m[1].replace(/\./g, '').replace(',', ''));
        }
        if (line.match(/COT\d+$/i) && !nombre) nombre = line;
      });
      
      // Buscar titulo
      const titleEl = container.querySelector('h3, h4, [class*="title"]');
      if (!nombre && titleEl) nombre = titleEl.innerText;
      if (!nombre) nombre = codigo;
      
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
        url_ficha: `https://buscador.mercadopublico.cl/ficha?code=${codigo}`
      });
    } catch (e) {
      console.error('[FirmaVB] Error extrayendo:', e);
    }
  });
  
  return compras;
}

// Extraer detalle de ficha individual
function extractFichaDetalle() {
  const urlParams = new URLSearchParams(window.location.search);
  const codigo = urlParams.get('code');
  if (!codigo || syncedCodes.has(codigo)) return null;
  
  try {
    const nombre = document.querySelector('h1, h2, [class*="title"]')?.innerText || codigo;
    const descripcionEl = document.querySelector('[class*="descripcion"], [class*="description"]');
    const descripcion = descripcionEl?.innerText || '';
    
    // Buscar campos especificos
    const getText = (label) => {
      const el = [...document.querySelectorAll('*')].find(e => 
        e.innerText?.toLowerCase().includes(label.toLowerCase())
      );
      return el?.nextElementSibling?.innerText || el?.parentElement?.innerText?.replace(label, '').trim() || '';
    };
    
    const estado = document.querySelector('[class*="estado"], [class*="badge"]')?.innerText || 'Publicada';
    const organismo = getText('organismo') || getText('institucion');
    const presupuesto = getText('presupuesto');
    let monto = null;
    if (presupuesto) {
      const m = presupuesto.match(/\$\s*([\d.,]+)/);
      if (m) monto = parseInt(m[1].replace(/\./g, '').replace(',', ''));
    }
    
    return {
      codigo,
      nombre: nombre.substring(0, 500),
      descripcion: descripcion.substring(0, 2000),
      estado,
      fecha_publicacion: new Date().toISOString(),
      fecha_cierre: null,
      monto_estimado: monto,
      nombre_organismo: organismo,
      region: null,
      url_ficha: window.location.href
    };
  } catch (e) {
    console.error('[FirmaVB] Error en ficha:', e);
    return null;
  }
}

// Enviar a Supabase
async function syncToSupabase(compras) {
  if (!compras || compras.length === 0) return { success: true, count: 0 };
  
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_compras_agiles_batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ p_compras: compras })
    });
    
    const result = await response.json();
    compras.forEach(c => syncedCodes.add(c.codigo));
    
    chrome.runtime.sendMessage({
      type: 'SYNC_COMPLETE',
      count: compras.length,
      success: result.success !== false
    }).catch(() => {});
    
    return result;
  } catch (error) {
    console.error('[FirmaVB] Error sync:', error);
    return { success: false, error: error.message };
  }
}

// Mostrar indicador
function showIndicator(count, success) {
  const old = document.getElementById('firmavb-indicator');
  if (old) old.remove();
  
  const div = document.createElement('div');
  div.id = 'firmavb-indicator';
  div.style.cssText = `
    position: fixed; bottom: 20px; right: 20px;
    background: ${success ? '#10b981' : '#ef4444'};
    color: white; padding: 12px 20px; border-radius: 8px;
    font-family: system-ui; font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 999999;
  `;
  div.textContent = success ? `FirmaVB: ${count} compras sincronizadas` : 'Error sincronizando';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

// Principal
async function main() {
  if (isExtracting) return;
  isExtracting = true;
  
  try {
    await new Promise(r => setTimeout(r, 2000));
    
    let compras = [];
    
    if (window.location.pathname.includes('/ficha')) {
      const ficha = extractFichaDetalle();
      if (ficha) compras = [ficha];
    } else {
      compras = extractComprasFromListado();
    }
    
    console.log(`[FirmaVB] Encontradas ${compras.length} compras`);
    
    if (compras.length > 0) {
      const result = await syncToSupabase(compras);
      showIndicator(compras.length, result.success !== false);
    }
  } finally {
    isExtracting = false;
  }
}

// Observar cambios
const observer = new MutationObserver(() => {
  clearTimeout(window.firmavbTimer);
  window.firmavbTimer = setTimeout(main, 2000);
});

console.log('[FirmaVB] Extension activa');
main();
observer.observe(document.body, { childList: true, subtree: true });

// Mensajes
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === 'MANUAL_SYNC') {
    syncedCodes.clear();
    main().then(() => respond({ success: true }));
    return true;
  }
  if (msg.type === 'GET_STATUS') {
    respond({ synced: syncedCodes.size });
  }
});
