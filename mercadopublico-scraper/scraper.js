require('dotenv').config();

const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');

const config = require('./config');
const { parseDateCL, parseBudgetCLP, splitOrganismoDepartamento, sleepRandom, toIsoNow } = require('./utils');

function parseArgs(argv) {
  const args = {
    test: false,
    headed: false,
    from: null,
    to: null,
    pages: null,
    out: null
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--test') args.test = true;
    else if (a === '--headed') args.headed = true;
    else if (a === '--from') args.from = argv[++i] || null;
    else if (a === '--to') args.to = argv[++i] || null;
    else if (a === '--pages') args.pages = Number.parseInt(argv[++i] || '', 10);
    else if (a === '--out') args.out = argv[++i] || null;
  }
  return args;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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
    const snippet = await page.evaluate(() => {
      const t = (document.body && (document.body.innerText || document.body.textContent)) || '';
      return String(t).replace(/\s+/g, ' ').trim().slice(0, 800);
    });
    console.log(`DEBUG title="${title}" url="${url}" snippet="${snippet}"`);
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

async function extractItemsFromDetalle(browser, compra, { timeoutMs }) {
  if (!compra?.link_detalle || typeof compra.link_detalle !== 'string') {
    // Sin link: igualmente insertar un item mínimo (cumple con “por cada compra”)
    return [
      {
        licitacion_codigo: compra.codigo,
        item_index: 1,
        descripcion: compra.titulo || '',
        raw: ''
      }
    ];
  }
  const url = compra.link_detalle.startsWith('http')
    ? compra.link_detalle
    : new URL(compra.link_detalle, config.baseUrl).toString();

  const detailPage = await browser.newPage();
  detailPage.setDefaultNavigationTimeout(timeoutMs);

  try {
    await detailPage.goto(url, { waitUntil: 'networkidle2' });
    // Espera genérica: el detalle suele renderizar con React también
    await detailPage.waitForTimeout(1000);

    const items = await detailPage.evaluate(() => {
      const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
      const results = [];

      // 1) Tablas tradicionales
      const tables = Array.from(document.querySelectorAll('table'));
      for (const table of tables) {
        const rows = Array.from(table.querySelectorAll('tr'));
        for (const tr of rows) {
          const cells = Array.from(tr.querySelectorAll('th,td')).map((c) => norm(c.innerText));
          const joined = cells.filter(Boolean).join(' | ');
          if (!joined) continue;
          // Filtrar headers típicos
          if (/descripci[oó]n|cantidad|unidad|precio|total/i.test(joined) && cells.length <= 2) continue;
          // Heurística: descartar filas muy cortas
          if (joined.length < 10) continue;
          results.push({ raw: joined });
        }
      }

      // 2) Fallback: listas
      const lis = Array.from(document.querySelectorAll('li'))
        .map((li) => norm(li.innerText))
        .filter((t) => t.length >= 10);
      for (const t of lis.slice(0, 100)) {
        results.push({ raw: t });
      }

      // Dedupe por raw
      const seen = new Set();
      const deduped = [];
      for (const r of results) {
        if (!r.raw || seen.has(r.raw)) continue;
        seen.add(r.raw);
        deduped.push(r);
      }
      return deduped.slice(0, 200); // límite de seguridad
    });

    return items.map((it, idx) => ({
      licitacion_codigo: compra.codigo,
      item_index: idx + 1,
      descripcion: (it.raw || '').slice(0, 1000),
      raw: it.raw || ''
    }));
  } catch (err) {
    console.warn(`No pude extraer items del detalle (${compra.codigo}): ${String(err?.message || err)}`);
    // Fallback: insertar un item mínimo con el título
    return [
      {
        licitacion_codigo: compra.codigo,
        item_index: 1,
        descripcion: compra.titulo || '',
        raw: ''
      }
    ];
  } finally {
    await detailPage.close();
  }
}

async function main() {
  const args = parseArgs(process.argv);

  const params = {
    ...config.params,
    ...(args.from ? { date_from: args.from } : {}),
    ...(args.to ? { date_to: args.to } : {})
  };

  // En --test permitimos correr sin credenciales y solo loguear (dry-run).
  const supabase = getSupabaseClientOrNull({ allowNull: args.test });
  const dryRun = !supabase;

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

  const maxPagesArg = args.test ? 1 : (Number.isFinite(args.pages) ? args.pages : null);
  let maxPages = maxPagesArg ?? config.maxPages;

  try {
    let currentPage = startPage;

    while (true) {
      const url = buildUrl(currentPage, params);
      console.log(`[${new Date().toISOString()}] Página ${currentPage}${maxPages ? `/${maxPages}` : ''}: ${url}`);

      await withRetries(
        async () => {
          await page.goto(url, { waitUntil: 'networkidle2' });
          await waitForResults(page);
        },
        {
          retries: config.maxRetries,
          onRetry: async (err, attempt) => {
            console.warn(`Reintento navegación/espera (intento ${attempt}/${config.maxRetries}): ${String(err?.message || err)}`);
            if (args.test) await debugDumpPage(page);
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

      const nowIso = toIsoNow();
      const licRows = compras.map((c) => ({
        ...c,
        fecha_extraccion: nowIso
      }));

      if (dryRun) {
        console.log(`[dry-run] Enviaría ${licRows.length} filas a 'licitaciones' (upsert por codigo).`);
      } else {
        await upsertLicitaciones(supabase, licRows);
        console.log(`Upsert OK: ${licRows.length} filas en 'licitaciones'.`);
      }

      // Items por cada compra (desde el detalle si existe link)
      for (const compra of compras) {
        const items = await extractItemsFromDetalle(browser, compra, { timeoutMs: config.navigationTimeoutMs });
        if (!items.length) continue;

        if (dryRun) {
          console.log(`[dry-run] Enviaría ${items.length} items a 'licitacion_items' para ${compra.codigo}.`);
        } else {
          try {
            await upsertLicitacionItems(supabase, items);
          } catch (err) {
            console.warn(`Falló upsert en 'licitacion_items' para ${compra.codigo}: ${String(err?.message || err)}`);
          }
        }

        // Anti-rate-limit entre detalles
        await sleepRandom(400, 1200);
      }

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
    console.log(`Finalizado. Compras únicas vistas (memoria): ${allCompras.length}. Total resultados detectado: ${totalResultados ?? 'N/A'}.`);
  }
}

main().catch((err) => {
  console.error('Fallo fatal:', err);
  process.exitCode = 1;
});

