// FirmaVB Scraper - Extrae compras agiles de MercadoPublico
// Este script se inyecta en las paginas de compra-agil

(function() {
  'use strict';
  
  console.log('[FirmaVB Scraper] Iniciando...');
  
  // Helpers
  function extractCode(text) {
    if (!text) return null;
    // Patron: XXXXXX-XX-COTXX
    const match = text.match(/(\d+-\d+-COT\d+)/i);
    return match ? match[1] : null;
  }
  
  function parseAmount(text) {
    if (!text) return null;
    const cleaned = text.replace(/[$\s.]/g, '').replace(',', '.');
    const num = parseInt(cleaned);
    return isNaN(num) ? null : num;
  }
  
  function parseDate(text) {
    if (!text) return null;
    // Formato DD/MM/YYYY
    const match = text.match(/(\d{1,2})\/(\d{2})\/(\d{4})/);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return null;
  }
  
  // Scrape lista de compras agiles
  function scrapeCompraAgilList() {
    const licitaciones = [];
    
    // La pagina de MercadoPublico usa React y los datos estan en elementos genericos
    // Buscar todos los textos que contengan codigo COT
    const allElements = document.body.querySelectorAll('*');
    const codigoPattern = /^\d+-\d+-COT\d+$/;
    
    // Recolectar elementos con codigos
    const codigoElements = [];
    allElements.forEach(el => {
      const text = el.textContent?.trim();
      if (text && codigoPattern.test(text) && el.childNodes.length === 1) {
        codigoElements.push({ element: el, codigo: text });
      }
    });
    
    console.log('[FirmaVB Scraper] Codigos encontrados:', codigoElements.length);
    
    codigoElements.forEach(({ element, codigo }) => {
      try {
        // Subir en el DOM para encontrar la tarjeta contenedora
        let card = element;
        for (let i = 0; i < 20 && card; i++) {
          const headings = card.querySelectorAll('h1, h2, h3, h4, h5, h6');
          if (headings.length >= 4) break; // Tarjeta tiene titulo, 2 fechas, monto
          card = card.parentElement;
        }
        
        if (!card) return;
        
        // Extraer datos de la tarjeta
        const headings = Array.from(card.querySelectorAll('h1, h2, h3, h4, h5, h6'));
        
        let nombre = '';
        let fechaCierre = null;
        let fechaPublicacion = null;
        let presupuesto = null;
        
        headings.forEach(h => {
          const text = h.textContent?.trim();
          if (!text) return;
          
          // Es fecha (DD/MM/YYYY)
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(text)) {
            if (!fechaPublicacion) {
              fechaPublicacion = parseDate(text);
            } else if (!fechaCierre) {
              fechaCierre = parseDate(text);
            }
          }
          // Es monto ($ XXX.XXX)
          else if (/^\$\s*[\d.,]+$/.test(text)) {
            presupuesto = parseAmount(text);
          }
          // Es titulo (texto largo, no es fecha ni monto)
          else if (text.length > 15 && !nombre) {
            nombre = text.slice(0, 500);
          }
        });
        
        // Buscar organismo (texto en mayusculas)
        let organismo = '';
        const allTexts = card.querySelectorAll('*');
        allTexts.forEach(el => {
          const txt = el.textContent?.trim();
          if (txt && txt.length > 10 && txt === txt.toUpperCase() && 
              !codigoPattern.test(txt) && !txt.includes('/') && !txt.includes('$') &&
              !el.querySelector('*')) { // Solo nodos hoja
            if (!organismo || txt.length > organismo.length) {
              organismo = txt.slice(0, 200);
            }
          }
        });
        
        if (nombre) {
          licitaciones.push({
            codigo: codigo,
            nombre: nombre,
            institucion_nombre: organismo,
            presupuesto_estimado: presupuesto,
            fecha_publicacion: fechaPublicacion,
            fecha_cierre: fechaCierre,
            estado: 'publicada',
            tipo: 'compra_agil',
            link_oficial: `https://buscador.mercadopublico.cl/compra-agil/${codigo}`
          });
        }
      } catch (e) {
        console.warn('[FirmaVB Scraper] Error procesando:', codigo, e);
      }
    });
    
    console.log('[FirmaVB Scraper] Compras extraidas:', licitaciones.length);
    return { licitaciones };
  }
  
  // Exponer funcion globalmente
  window.FirmaVBScraper = {
    scrapeList: scrapeCompraAgilList
  };
  
  // Listener para mensajes del background
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'EXECUTE_SCRAPE') {
        console.log('[FirmaVB Scraper] Ejecutando scrape por mensaje...');
        const result = scrapeCompraAgilList();
        sendResponse(result);
        return true;
      }
    });
  }
  
  console.log('[FirmaVB Scraper] Listo');
})();
