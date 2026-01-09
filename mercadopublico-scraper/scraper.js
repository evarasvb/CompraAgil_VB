require('dotenv').config();

// Timestamp en todos los logs (útil para CI/GitHub Actions)
(() => {
  const ts = () => new Date().toISOString();
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  console.log = (...args) => origLog(`[${ts()}]`, ...args);
  console.warn = (...args) => origWarn(`[${ts()}]`, ...args);
  console.error = (...args) => origError(`[${ts()}]`, ...args);
})();

// Anti-bot: puppeteer-extra + stealth
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { createClient } = require('@supabase/supabase-js');

const config = require('./config');
const { parseDateCL, parseBudgetCLP, splitOrganismoDepartamento, sleepRandom, toIsoNow } = require('./utils');

function parseArgs(argv) {
  const args = {
    test: false,
    testSimple: false,
    headed: false,
    from: null,
    to: null,
    pages: null,
    out: null,
    incremental: null
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--test') args.test = true;
    else if (a === '--test-simple') args.testSimple = true;
    else if (a === '--headed') args.headed = true;
    else if (a === '--from') args.from = argv[++i] || null;
    else if (a === '--to') args.to = argv[++i] || null;
    else if (a === '--pages') args.pages = Number.parseInt(argv[++i] || '', 10);
    else if (a === '--out') args.out = argv[++i] || null;
    else if (a === '--incremental') args.incremental = true;
    else if (a === '--no-incremental') args.incremental = false;
  }
  return args;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function envBool(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return defaultValue;
}

function formatDateYYYYMMDD(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseLocalIsoToDate(isoLocal) {
  if (!isoLocal) return null;
  const d = new Date(isoLocal); // ISO sin zona => local time
  return Number.isFinite(d.getTime()) ? d : null;
}

function resolveIncrementalMode(args) {
  // Prioridad: flag CLI -> env -> default false
  if (args.incremental === true) return true;
  if (args.incremental === false) return false;
  return envBool('INCREMENTAL_MODE', false);
}

function withConcurrencyLimit(limit) {
  let active = 0;
  const queue = [];

  const next = () => {
    active -= 1;
    if (queue.length) queue.shift()();
  };

  return async function run(task) {
    if (active >= limit) {
      await new Promise((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      next();
    }
  };
}

function buildUrl(pageNumber, params) {
  const url = new URL(config.baseUrl);
  const sp = new URLSearchParams({
    date_from: params.date_from,
    date_to: params.date_to,
    order_by: params.order_by,
    page_number: String(pageNumber),
    region: params.region,
    status: params.status
  });
  url.search = sp.toString();
  return url.toString();
}

async function withRetries(fn, { retries, onRetry }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt < retries && onRetry) await onRetry(err, attempt);
    }
  }
  throw lastErr;
}

async function waitForResults(page) {
  // React: tolerante a cambios de DOM (texto o patrones)
  await page.waitForFunction(() => {
    const bodyText = (document.body && (document.body.innerText || document.body.textContent)) || '';
    const hasCodigo = /\d{6,7}-\d+-[A-Z]{2,6}\d+/.test(bodyText);
    const hasTotal = /Existen\s+[\d\.\,]+\s+resultados\s+para\s+tu\s+búsqueda/i.test(bodyText);

    const candidates = Array.from(document.querySelectorAll('button, a'));
    const hasDetalle = candidates.some((el) => (el.textContent || '').toLowerCase().includes('revisar detalle'));

    return hasDetalle || hasCodigo || hasTotal;
  }, { timeout: config.resultsTimeoutMs });
}

async function extractTotalResultados(page) {
  // Buscar el texto tipo: "Existen X resultados para tu búsqueda"
  const text = await page.evaluate(() => document.body?.innerText || '');
  const m = text.match(/Existen\s+([\d\.\,]+)\s+resultados\s+para\s+tu\s+búsqueda/i);
  if (!m) return null;
  const n = Number.parseInt(m[1].replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

async function extractComprasFromPage(page) {
  const rawItems = await page.evaluate(() => {
    const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const getLines = (el) =>
      normalize(el?.innerText || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

    const triggers = Array.from(document.querySelectorAll('button, a'))
      .filter((el) => normalize(el.textContent).toLowerCase().includes('revisar detalle'));

    const seen = new Set();
    const results = [];

    function findCardContainer(trigger) {
      // Subir niveles y elegir el primer ancestro que contenga un código de compra
      const codeRe = /\d{6,7}-\d+-[A-Z]{2,6}\d+/;
      let node = trigger;
      for (let i = 0; i < 10 && node; i++) {
        if (node instanceof HTMLElement) {
          const txt = node.innerText || '';
          if (codeRe.test(txt)) return node;
        }
        node = node.parentElement;
      }
      return trigger.parentElement || trigger;
    }

    function extractLink(trigger) {
      // Preferir href si es <a>
      if (trigger.tagName.toLowerCase() === 'a') {
        const href = trigger.getAttribute('href');
        return href ? href : null;
      }
      const a = trigger.closest('a');
      if (a) {
        const href = a.getAttribute('href');
        return href ? href : null;
      }
      // Fallback: onclick (si existe)
      const onclick = trigger.getAttribute('onclick');
      return onclick ? onclick : null;
    }

    for (const trigger of triggers) {
      const card = findCardContainer(trigger);
      const lines = getLines(card);
      const blob = normalize(card?.innerText || '');

      const codeRe = /\d{6,7}-\d+-[A-Z]{2,6}\d+/;
      const codigo = (blob.match(codeRe) || [null])[0];
      if (!codigo) continue;
      if (seen.has(codigo)) continue;
      seen.add(codigo);

      const dateRe = /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/g;
      const fechas = blob.match(dateRe) || [];

      // Estado (badge verde): suele contener "Publicada"
      const estado = lines.find((l) => /Publicada/i.test(l)) || '';

      // Título: heurística: primera línea "larga" que no sea código/fechas/presupuesto/labels
      const presupuestoLine = lines.find((l) => /\$\s*\d/.test(l)) || '';
      const titleCandidate = lines.find((l) => {
        if (!l) return false;
        if (l === codigo) return false;
        if (dateRe.test(l)) return false;
        if (/\$\s*\d/.test(l)) return false;
        if (/Publicada/i.test(l)) return false;
        if (/Publicada el|Finaliza el|Presupuesto|Organismo/i.test(l)) return false;
        return l.length >= 8;
      }) || '';

      // Publicada/Finaliza: si hay 2 fechas, asumir [0]=publicada, [1]=finaliza
      const publicada_el = fechas[0] || '';
      const finaliza_el = fechas[1] || '';

      // Organismo + departamento: línea con " - " (la más parecida)
      const orgLine =
        lines.find((l) => l.includes(' - ') && l.length > 15) ||
        lines.find((l) => /MUNICIPALIDAD|MINISTERIO|SERVICIO|GOBIERNO|HOSPITAL|UNIVERSIDAD/i.test(l)) ||
        '';

      const link_detalle = extractLink(trigger);

      results.push({
        codigo,
        titulo: titleCandidate,
        estado,
        publicada_el,
        finaliza_el,
        presupuesto_estimado: presupuestoLine,
        organismo_raw: orgLine,
        link_detalle,
        card_text: blob
      });
    }

    return results;
  });

  // Post-procesado en Node (parseo y normalización)
  return rawItems.map((it) => {
    const { organismo, departamento } = splitOrganismoDepartamento(it.organismo_raw);
    const estado = it.estado || '';
    const estado_detallado = estado
      ? estado.replace(/^Publicada\s*/i, '').trim()
      : '';

    // Normalizar href relativo (si el sitio entrega rutas relativas)
    let link = it.link_detalle || null;
    if (link && typeof link === 'string' && link.startsWith('/')) {
      link = new URL(link, config.baseUrl).toString();
    }

    return {
      codigo: it.codigo,
      titulo: it.titulo || '',
      estado: estado || '',
      publicada_el: parseDateCL(it.publicada_el),
      finaliza_el: parseDateCL(it.finaliza_el),
      presupuesto_estimado: parseBudgetCLP(it.presupuesto_estimado) ?? 0,
      organismo: organismo || '',
      departamento: departamento || '',
      link_detalle: link,
      estado_detallado
    };
  });
}

function getSupabaseClientOrNull({ allowNull }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  if (!url || !key) {
    if (allowNull) return null;
    throw new Error('Faltan variables de entorno SUPABASE_URL y/o SUPABASE_KEY.');
  }

  return createClient(url, key, {
    auth: { persistSession: false }
  });
}

async function debugDumpPage(page) {
  try {
    const title = await page.title();
    const url = page.url();
    const snippetText = await page.evaluate(() => {
      const t = (document.body && (document.body.innerText || document.body.textContent)) || '';
      return String(t).replace(/\s+/g, ' ').trim().slice(0, 800);
    });
    const snippetHtml = await page.evaluate(() => {
      const html = document.documentElement ? document.documentElement.outerHTML : '';
      return String(html).replace(/\s+/g, ' ').trim().slice(0, 1200);
    });
    console.log(`DEBUG title="${title}" url="${url}" text_snippet="${snippetText}" html_snippet="${snippetHtml}"`);
  } catch (e) {
    console.warn(`DEBUG dump falló: ${String(e?.message || e)}`);
  }
}

async function upsertLicitaciones(supabase, rows) {
  const table = 'licitaciones';
  const batches = chunkArray(rows, 200);

  for (const batch of batches) {
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: 'codigo' });
    if (error) throw error;
  }
}

async function upsertLicitacionItems(supabase, rows) {
  const table = 'licitacion_items';
  const batches = chunkArray(rows, 200);

  for (const batch of batches) {
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: 'licitacion_codigo,item_index' });
    if (error) throw error;
  }
}

async function scrapeCompraDetallada(page, codigo) {
  const url = `https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(codigo)}`;
  await page.goto(url, { waitUntil: 'networkidle2' });

  // Esperar a que cargue el texto clave o al menos el body
  await page.waitForFunction(() => {
    const t = (document.body && (document.body.innerText || document.body.textContent)) || '';
    return /Listado de productos solicitados/i.test(t) || t.length > 200;
  }, { timeout: config.resultsTimeoutMs });

  const detalle = await page.evaluate(() => {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

    function textOf(el) {
      return norm(el?.innerText || el?.textContent || '');
    }

    function findHeading(textNeedle) {
      const needle = textNeedle.toLowerCase();
      const candidates = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,div,span,p,strong'));
      return candidates.find((el) => textOf(el).toLowerCase().includes(needle)) || null;
    }

    function findTableNear(anchorEl) {
      if (!anchorEl) return null;
      // buscar tabla en ancestros cercanos y siguientes
      let node = anchorEl;
      for (let i = 0; i < 6 && node; i++) {
        const table = node.querySelector && node.querySelector('table');
        if (table) return table;
        node = node.parentElement;
      }
      // fallback: primera tabla de la página
      return document.querySelector('table');
    }

    function extractProductos() {
      const heading = findHeading('Listado de productos solicitados');
      const table = findTableNear(heading);
      const productos = [];

      if (table) {
        const headerCells = Array.from(table.querySelectorAll('thead th')).map((th) => norm(th.innerText));
        const headerMap = new Map();
        headerCells.forEach((h, idx) => headerMap.set(h.toLowerCase(), idx));

        const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
        for (const tr of bodyRows) {
          const tds = Array.from(tr.querySelectorAll('td')).map((td) => norm(td.innerText));
          if (!tds.length) continue;

          const getByHeader = (reList) => {
            for (const [h, idx] of headerMap.entries()) {
              if (reList.some((re) => re.test(h))) return tds[idx] || '';
            }
            return '';
          };

          const id =
            getByHeader([/^id$/, /producto id/, /c[oó]digo/]) ||
            (tds[0] && /^\d+$/.test(tds[0]) ? tds[0] : '');

          const nombre =
            getByHeader([/nombre/, /producto/]) ||
            tds.find((t) => t && t.length >= 3) ||
            '';

          const descripcion =
            getByHeader([/descripci[oó]n/, /detalle/]) ||
            '';

          const cantidad =
            getByHeader([/cantidad/, /cant\./]) ||
            '';

          const unidad =
            getByHeader([/unidad/, /u\./]) ||
            '';

          // Evitar filas vacías/headers
          const joined = tds.join(' | ');
          if (!joined || joined.length < 5) continue;

          productos.push({ id, nombre, descripcion, cantidad, unidad });
        }
      }

      // Fallback si no hay tabla o viene vacía: buscar cards/listas cercanas al heading
      if (!productos.length) {
        const heading = findHeading('Listado de productos solicitados');
        const container = heading?.parentElement || document.body;
        const candidates = Array.from(container.querySelectorAll('li, div'))
          .map((el) => norm(el.innerText))
          .filter((t) => t.length >= 15)
          .slice(0, 200);

        for (const t of candidates.slice(0, 50)) {
          // Heurística muy simple
          productos.push({ id: '', nombre: t.slice(0, 200), descripcion: t.slice(0, 1000), cantidad: '', unidad: '' });
        }
      }

      // Dedupe por (id|nombre|descripcion)
      const seen = new Set();
      const out = [];
      for (const p of productos) {
        const key = `${p.id}|${p.nombre}|${p.descripcion}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(p);
      }
      return out;
    }

    function extractDocumentos() {
      const heading = findHeading('documentos adjuntos') || findHeading('adjuntos') || null;
      const container = heading?.parentElement || document.body;
      const links = Array.from(container.querySelectorAll('a'))
        .map((a) => ({
          nombre: norm(a.innerText),
          url: a.href ? String(a.href) : ''
        }))
        .filter((l) => l.url && /^https?:\/\//.test(l.url));

      const filtered = links.filter((l) => {
        const t = (l.nombre || '').toLowerCase();
        return (
          t.includes('doc') ||
          t.includes('pdf') ||
          /\.(pdf|doc|docx|xls|xlsx|zip|rar)(\?|$)/i.test(l.url)
        );
      });

      // Dedupe por url
      const seen = new Set();
      const out = [];
      for (const d of (filtered.length ? filtered : links)) {
        if (!d.url || seen.has(d.url)) continue;
        seen.add(d.url);
        out.push({ nombre: d.nombre || '', url: d.url });
      }
      return out.slice(0, 50);
    }

    return {
      productos: extractProductos(),
      documentos: extractDocumentos()
    };
  });

  return detalle;
}

async function fetchExistingCodigos(supabase, codigos) {
  const existing = new Set();
  const batches = chunkArray(codigos, 200);
  for (const batch of batches) {
    const { data, error } = await supabase
      .from('licitaciones')
      .select('codigo')
      .in('codigo', batch);
    if (error) throw error;
    for (const row of data || []) existing.add(row.codigo);
  }
  return existing;
}

async function main() {
  const args = parseArgs(process.argv);

  const incrementalMode = args.testSimple ? false : resolveIncrementalMode(args);
  const now = new Date();
  const incrementalSince = new Date(now.getTime() - 75 * 60 * 1000);

  const baseParams = {
    ...config.params,
    ...(args.from ? { date_from: args.from } : {}),
    ...(args.to ? { date_to: args.to } : {})
  };

  const params = incrementalMode
    ? {
        ...baseParams,
        // La URL acepta YYYY-MM-DD. Para “últimos 75 min” usamos el día correspondiente
        // y filtramos por hora vía `publicada_el` después de extraer.
        date_from: formatDateYYYYMMDD(incrementalSince),
        date_to: formatDateYYYYMMDD(now)
      }
    : baseParams;

  // --test-simple: NO Supabase, NO detalle (solo listado + conteo)
  const supabase = args.testSimple ? null : getSupabaseClientOrNull({ allowNull: args.test });
  const dryRun = args.testSimple ? true : !supabase;

  const isHeadless = args.headed ? false : config.headless;

  const browser = await puppeteer.launch({
    headless: isHeadless ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.setDefaultNavigationTimeout(config.navigationTimeoutMs);
  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  const allCompras = [];
  const startPage = 1;

  let totalResultados = null;

  const maxPagesArg = args.testSimple ? 1 : (args.test ? 1 : (Number.isFinite(args.pages) ? args.pages : null));
  let maxPages = maxPagesArg ?? config.maxPages;

  try {
    let currentPage = startPage;
    const runDetail = withConcurrencyLimit(3);

    while (true) {
      const url = buildUrl(currentPage, params);
      console.log(`Página ${currentPage}${maxPages ? `/${maxPages}` : ''}: ${url}`);

      await withRetries(
        async () => {
          await page.goto(url, { waitUntil: 'networkidle2' });
          console.log('Esperando resultados (waitForResults)...');
          await waitForResults(page);
          console.log('Resultados detectados (waitForResults OK).');
        },
        {
          retries: config.maxRetries,
          onRetry: async (err, attempt) => {
            console.warn(`Reintento navegación/espera (intento ${attempt}/${config.maxRetries}): ${String(err?.message || err)}`);
            await debugDumpPage(page);
            await sleepRandom(1500, 3000);
          }
        }
      );

      if (totalResultados == null) {
        totalResultados = await extractTotalResultados(page);
        if (totalResultados != null) {
          console.log(`Total resultados detectado: ${totalResultados}`);
          if (maxPages == null) maxPages = Math.ceil(totalResultados / 15);
        } else {
          console.warn('No pude detectar el total de resultados (seguiré sin calcular maxPages automáticamente).');
          if (maxPages == null && args.test) maxPages = 1;
        }
      }

      // Scroll (por si hay lazy-loading)
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleepRandom(500, 1200);

      const compras = await withRetries(
        async () => await extractComprasFromPage(page),
        {
          retries: config.maxRetries,
          onRetry: async (err, attempt) => {
            console.warn(`Reintento extracción (intento ${attempt}/${config.maxRetries}): ${String(err?.message || err)}`);
            await sleepRandom(1000, 2500);
          }
        }
      );

      console.log(`Extraídas ${compras.length} compras en la página ${currentPage}`);

      if (args.testSimple) {
        // Modo “empezar simple”: sin Supabase ni detalle
        const codigos = compras.map((c) => c.codigo).filter(Boolean);
        console.log(`[test-simple] Total compras encontradas en listado: ${compras.length}`);
        console.log(`[test-simple] Códigos (primeros 10): ${codigos.slice(0, 10).join(', ')}`);
        // guardar en memoria para el resumen final
        const existing = new Set(allCompras.map((c) => c.codigo));
        for (const c of compras) if (!existing.has(c.codigo)) allCompras.push(c);

        if (maxPages && currentPage >= maxPages) break;
        currentPage += 1;
        await sleepRandom(config.delayBetweenPagesMs.min, config.delayBetweenPagesMs.max);
        continue;
      }

      // Incremental: filtrar por timestamp (últimos 75 min)
      const comprasFiltradas = incrementalMode
        ? compras.filter((c) => {
            const d = parseLocalIsoToDate(c.publicada_el);
            return d && d.getTime() >= incrementalSince.getTime();
          })
        : compras;

      if (incrementalMode) {
        console.log(`Incremental ON: ${comprasFiltradas.length}/${compras.length} compras dentro de últimos 75 min`);
      }

      // Incremental: evitar reprocesar códigos ya existentes en Supabase
      let comprasNuevas = comprasFiltradas;
      if (incrementalMode && !dryRun && comprasFiltradas.length) {
        const codigos = comprasFiltradas.map((c) => c.codigo);
        const existentes = await withRetries(
          async () => await fetchExistingCodigos(supabase, codigos),
          {
            retries: config.maxRetries,
            onRetry: async (err, attempt) => {
              console.warn(`Reintento verificación existentes (intento ${attempt}/${config.maxRetries}): ${String(err?.message || err)}`);
              await sleepRandom(800, 1600);
            }
          }
        );
        comprasNuevas = comprasFiltradas.filter((c) => !existentes.has(c.codigo));
        console.log(`Incremental: nuevas=${comprasNuevas.length}, ya-existían=${comprasFiltradas.length - comprasNuevas.length}`);
      }

      const nowIso = toIsoNow();
      const licRows = comprasNuevas.map((c) => ({
        ...c,
        fecha_extraccion: nowIso
      }));

      if (dryRun) {
        console.log(`[dry-run] Enviaría ${licRows.length} filas a 'licitaciones' (upsert por codigo).`);
      } else {
        if (licRows.length) {
          await upsertLicitaciones(supabase, licRows);
          console.log(`Upsert OK: ${licRows.length} filas en 'licitaciones'.`);
        }
      }

      // Detalle completo (productos/documentos) en paralelo, con límite de 3 páginas concurrentes
      const detailTasks = comprasNuevas.map((compra) =>
        runDetail(async () => {
          const detailPage = await browser.newPage();
          await detailPage.setViewport({ width: 1440, height: 900 });
          detailPage.setDefaultNavigationTimeout(config.navigationTimeoutMs);
          await detailPage.setUserAgent(
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          );

          try {
            const detalle = await withRetries(
              async () => await scrapeCompraDetallada(detailPage, compra.codigo),
              {
                retries: config.maxRetries,
                onRetry: async (err, attempt) => {
                  console.warn(`Retry detalle (${compra.codigo}) intento ${attempt}/${config.maxRetries}: ${String(err?.message || err)}`);
                  await sleepRandom(1200, 2400);
                }
              }
            );

            const productos = Array.isArray(detalle.productos) ? detalle.productos : [];

            // Normalización y persistencia de items
            const sorted = productos.slice().sort((a, b) => {
              const ai = String(a.id || '');
              const bi = String(b.id || '');
              if (ai && bi && ai !== bi) return ai.localeCompare(bi);
              return String(a.nombre || '').localeCompare(String(b.nombre || ''));
            });

            const itemRows = (sorted.length ? sorted : [{ id: '', nombre: compra.titulo || '', descripcion: '', cantidad: '', unidad: '' }])
              .map((p, idx) => ({
                licitacion_codigo: compra.codigo,
                item_index: idx + 1,
                producto_id: p.id || null,
                nombre: p.nombre || '',
                descripcion: p.descripcion || '',
                cantidad: p.cantidad || null,
                unidad: p.unidad || ''
              }));

            if (dryRun) {
              console.log(`[dry-run] ${compra.codigo}: productos=${sorted.length} -> enviaría ${itemRows.length} a 'licitacion_items'.`);
            } else {
              await upsertLicitacionItems(supabase, itemRows);
            }

            // Documentos (opcional): intentamos guardar en tabla extra si existe
            const documentos = Array.isArray(detalle.documentos) ? detalle.documentos : [];
            if (!dryRun && documentos.length) {
              const docRows = documentos.map((d) => ({
                licitacion_codigo: compra.codigo,
                nombre: d.nombre || '',
                url: d.url || ''
              }));
              try {
                const { error } = await supabase
                  .from('licitacion_documentos')
                  .upsert(docRows, { onConflict: 'licitacion_codigo,url' });
                if (error) throw error;
              } catch (e) {
                console.warn(`Tabla 'licitacion_documentos' no disponible o falló inserción (${compra.codigo}): ${String(e?.message || e)}`);
              }
            }
          } finally {
            await detailPage.close();
          }
        })
      );

      await Promise.all(detailTasks);

      // Mantener en memoria un resumen (útil para logs/fin de corrida)
      const existing = new Set(allCompras.map((c) => c.codigo));
      for (const c of compras) if (!existing.has(c.codigo)) allCompras.push(c);

      if (maxPages && currentPage >= maxPages) break;
      if (!maxPages && args.test) break;

      currentPage += 1;
      await sleepRandom(config.delayBetweenPagesMs.min, config.delayBetweenPagesMs.max);
    }
  } catch (err) {
    console.error('Error durante el scraping:', err);
  } finally {
    await browser.close();
    console.log(
      `Finalizado. Compras únicas vistas (memoria): ${allCompras.length}. Total resultados detectado: ${totalResultados ?? 'N/A'}. Incremental=${incrementalMode ? 'ON' : 'OFF'}.`
    );
  }
}

main().catch((err) => {
  console.error('Fallo fatal:', err);
  process.exitCode = 1;
});

