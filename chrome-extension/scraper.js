// Content script injected via chrome.scripting.executeScript({files:['scraper.js']})
// Debe exponer window.__FIRMAVB_SCRAPE_TASK__(task) y retornar payload compatible con pending_sync_server.

function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function detectCompraAgilCodigo(text) {
  const m = String(text || '').match(/\d{6,7}-\d+-[A-Z]{2,6}\d+/);
  return m ? m[0] : null;
}

function extractCompraAgilList() {
  // Heurística: similar a scraper.js del backend (sin depender de clases exactas)
  const headings = Array.from(document.querySelectorAll('[role="heading"]'));
  const results = [];
  const seen = new Set();

  const codeRe = /\d{6,7}-\d+-[A-Z]{2,6}\d+/;
  const dateRe = /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/g;

  function findCardContainer(nodeStart) {
    let node = nodeStart;
    for (let i = 0; i < 10 && node; i++) {
      if (node instanceof HTMLElement) {
        const txt = node.innerText || '';
        if (codeRe.test(txt)) return node;
      }
      node = node.parentElement;
    }
    return nodeStart?.parentElement || nodeStart;
  }

  function extractLinkFromCard(card) {
    const ctas = Array.from(card.querySelectorAll('button, a')).filter((el) => /revisar detalle/i.test(el.textContent || ''));
    const el = ctas[0] || null;
    const a = el && el.closest ? el.closest('a') : null;
    const href = a ? a.getAttribute('href') : null;
    if (href) return href.startsWith('/') ? new URL(href, location.origin).toString() : href;
    const any = card.querySelector('a[href]');
    if (any) {
      const h = any.getAttribute('href') || '';
      return h.startsWith('/') ? new URL(h, location.origin).toString() : h;
    }
    return null;
  }

  for (const h of headings) {
    const card = findCardContainer(h);
    if (!card) continue;
    const blob = norm(card.innerText || '');
    const codigo = (blob.match(codeRe) || [null])[0];
    if (!codigo || seen.has(codigo)) continue;
    seen.add(codigo);

    const titulo = norm(h.textContent || '');
    const fechas = blob.match(dateRe) || [];
    const publicada_el = fechas[0] || '';
    const finaliza_el = fechas[1] || '';
    const presupuestoLine = (blob.match(/\$\s*[\d\.\,]+/) || [''])[0];
    const link_detalle = extractLinkFromCard(card);

    results.push({
      codigo,
      titulo,
      publicada_el,
      finaliza_el,
      organismo: null,
      presupuesto_estimado: presupuestoLine || null,
      link_detalle: link_detalle || null
    });
  }

  return { licitaciones: results, items: [] };
}

function extractCompraAgilDetail(task) {
  // Página ficha: extraer código y tabla/listado de productos si existe.
  const bodyText = document.body?.innerText || '';
  const codigo = task?.identifier || detectCompraAgilCodigo(bodyText) || null;
  if (!codigo) throw new Error('No pude detectar codigo de compra ágil');

  // Productos: buscar tabla
  const items = [];
  const table = document.querySelector('table');
  if (table) {
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    let idx = 1;
    for (const tr of rows) {
      const tds = Array.from(tr.querySelectorAll('td')).map((td) => norm(td.innerText));
      if (!tds.length) continue;
      const joined = tds.join(' | ');
      if (joined.length < 5) continue;
      items.push({
        licitacion_codigo: codigo,
        item_index: idx++,
        producto_id: tds[0] || null,
        nombre: tds[1] || tds[0] || '',
        descripcion: tds.slice(2).join(' ').slice(0, 2000),
        cantidad: null,
        unidad: ''
      });
    }
  }

  // Licitación “header” mínimo para upsert (se completa en server si faltan columnas)
  const titulo = norm(document.querySelector('h1,[role="heading"]')?.textContent || '') || null;
  const licitaciones = [
    {
      codigo,
      titulo,
      publicada_el: null,
      finaliza_el: null,
      organismo: null,
      presupuesto_estimado: null,
      link_detalle: location.href
    }
  ];

  return { licitaciones, items };
}

window.__FIRMAVB_SCRAPE_TASK__ = async function (task) {
  const kind = String(task?.kind || '').trim();
  if (kind === 'compra_agil_list') return extractCompraAgilList();
  if (kind === 'compra_agil_detail') return extractCompraAgilDetail(task);
  // Otros kinds: por ahora no implementados en este template.
  throw new Error(`Kind no soportado por scraper.js: ${kind}`);
};

