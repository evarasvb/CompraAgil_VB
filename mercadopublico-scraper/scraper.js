const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const config = require('./config');
const { parseDateCL, parseBudgetCLP, splitOrganismoDepartamento, sleepRandom, toIsoNow } = require('./utils');

function parseArgs(argv) {
  const args = {
    test: false,
    headed: false,
    from: null,
    to: null,
    pages: null,
    out: null,
    resume: true
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--test') args.test = true;
    else if (a === '--headed') args.headed = true;
    else if (a === '--no-resume') args.resume = false;
    else if (a === '--from') args.from = argv[++i] || null;
    else if (a === '--to') args.to = argv[++i] || null;
    else if (a === '--pages') args.pages = Number.parseInt(argv[++i] || '', 10);
    else if (a === '--out') args.out = argv[++i] || null;
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeWriteJson(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
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
  // React: esperar a que existan elementos con texto "Revisar detalle"
  await page.waitForFunction(() => {
    const candidates = Array.from(document.querySelectorAll('button, a'));
    return candidates.some((el) => (el.textContent || '').toLowerCase().includes('revisar detalle'));
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

function loadProgress(progressPath) {
  try {
    if (!fs.existsSync(progressPath)) return null;
    const raw = fs.readFileSync(progressPath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv);

  const params = {
    ...config.params,
    ...(args.from ? { date_from: args.from } : {}),
    ...(args.to ? { date_to: args.to } : {})
  };

  const outputPath = args.out || config.outputPath;
  ensureDir(path.resolve(__dirname, config.outputDir));

  const isHeadless = args.headed ? false : config.headless;

  const browser = await puppeteer.launch({
    headless: isHeadless,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.setDefaultNavigationTimeout(config.navigationTimeoutMs);

  const progress = args.resume ? loadProgress(path.resolve(__dirname, config.progressPath)) : null;
  const allCompras = progress?.compras || [];
  const startPage = progress?.currentPage ? Number(progress.currentPage) : 1;

  let totalResultados = progress?.totalResultados || null;

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

      // Merge por código (evitar duplicados al resumir)
      const existing = new Set(allCompras.map((c) => c.codigo));
      for (const c of compras) {
        if (!existing.has(c.codigo)) allCompras.push(c);
      }

      if (currentPage % config.saveEveryPages === 0 || (maxPages && currentPage === maxPages)) {
        safeWriteJson(path.resolve(__dirname, config.progressPath), {
          fecha_extraccion: toIsoNow(),
          totalResultados,
          currentPage,
          compras: allCompras
        });
        console.log(`Progreso guardado: ${allCompras.length} compras (hasta página ${currentPage})`);
      }

      if (maxPages && currentPage >= maxPages) break;
      if (!maxPages && args.test) break;

      currentPage += 1;
      await sleepRandom(config.delayBetweenPagesMs.min, config.delayBetweenPagesMs.max);
    }
  } catch (err) {
    console.error('Error durante el scraping:', err);
  } finally {
    await browser.close();

    const resultado = {
      fecha_extraccion: toIsoNow(),
      total_compras: allCompras.length,
      total_resultados: totalResultados,
      params,
      compras: allCompras
    };

    safeWriteJson(path.resolve(__dirname, outputPath), resultado);
    console.log(`Resultado guardado en: ${outputPath} (${allCompras.length} compras)`);
  }
}

main().catch((err) => {
  console.error('Fallo fatal:', err);
  process.exitCode = 1;
});

