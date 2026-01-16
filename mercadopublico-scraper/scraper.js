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

// Utilidades de Node.js
const path = require('path');
const fs = require('fs');
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

      // Extraer información de manera más robusta
      // Buscar patrones específicos en el texto completo
      
      // Estado: buscar "Publicada" seguido de texto descriptivo
      const estadoMatch = blob.match(/Publicada\s+([^\.]+?)(?:\.|$)/i);
      const estado = estadoMatch ? `Publicada ${estadoMatch[1].trim()}` : (lines.find((l) => /Publicada/i.test(l)) || '');

      // Presupuesto: buscar "$ X.XXX.XXX" o "Presupuesto estimado $ X"
      // Formato chileno: "6.500.000" o "$ 6.500.000"
      const presupuestoMatch = blob.match(/Presupuesto\s+estimado\s+\$\s*([\d\.]+)/i) || blob.match(/\$\s*([\d]{1,3}(?:\.[\d]{3}){1,})/);
      const presupuestoLine = presupuestoMatch ? `$ ${presupuestoMatch[1]}` : (lines.find((l) => /\$\s*[\d\.]+/.test(l)) || '');

      // Título: buscar texto después del código y antes de "Publicada el"
      const codigoIndex = blob.indexOf(codigo);
      const publicadaIndex = blob.indexOf('Publicada el');
      let titleCandidate = '';
      if (codigoIndex >= 0 && publicadaIndex > codigoIndex) {
        const titleSection = blob.substring(codigoIndex + codigo.length, publicadaIndex).trim();
        // Limpiar el título: quitar "Segundo llamado", números, etc.
        const titleLines = titleSection.split('\n').map(l => l.trim()).filter(Boolean);
        titleCandidate = titleLines.find((l) => {
          if (!l || l.length < 10) return false;
          if (/^\d+/.test(l)) return false; // No empieza con número
          if (/Segundo\s+llamado|Tercer\s+llamado/i.test(l)) return false;
          if (dateRe.test(l)) return false;
          if (/\$\s*\d/.test(l)) return false;
          return true;
        }) || titleLines[0] || '';
      }
      
      // Si no encontramos título, usar heurística de líneas
      if (!titleCandidate) {
        titleCandidate = lines.find((l) => {
          if (!l || l.length < 10) return false;
          if (l === codigo) return false;
          if (dateRe.test(l)) return false;
          if (/\$\s*\d/.test(l)) return false;
          if (/Publicada/i.test(l)) return false;
          if (/Publicada el|Finaliza el|Presupuesto|Organismo|Segundo llamado|Tercer llamado/i.test(l)) return false;
          if (/^[A-Z]{2,6}\d+$/.test(l)) return false; // Solo código
          return true;
        }) || '';
      }

      // Publicada/Finaliza: buscar patrones específicos
      const publicadaMatch = blob.match(/Publicada\s+el\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/i);
      const finalizaMatch = blob.match(/Finaliza\s+el\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/i);
      const publicada_el = publicadaMatch ? publicadaMatch[1] : (fechas[0] || '');
      const finaliza_el = finalizaMatch ? finalizaMatch[1] : (fechas[1] || '');

      // Organismo + departamento: buscar después de "Presupuesto estimado"
      let orgLine = '';
      const presupuestoMatchForOrg = blob.match(/Presupuesto\s+estimado\s+\$\s*[\d\.]+/i);
      if (presupuestoMatchForOrg) {
        const afterPresupuesto = blob.substring(presupuestoMatchForOrg.index + presupuestoMatchForOrg[0].length);
        // Buscar organismo que empiece con mayúscula después del presupuesto
        const orgMatch = afterPresupuesto.match(/\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]+?)(?:\s+-\s+([A-ZÁÉÍÓÚÑ][^\.]+?))?(?:\s+Recibiendo|\s*$)/);
        if (orgMatch) {
          const org = orgMatch[1].trim();
          const dept = orgMatch[2] ? orgMatch[2].trim() : '';
          orgLine = dept ? `${org} - ${dept}` : org;
        }
      }
      
      // Fallback: buscar línea con " - " y palabras clave de organismos
      if (!orgLine) {
        for (const l of lines) {
          if (l.includes(' - ') && l.length > 15) {
            const hasOrgKeyword = /MUNICIPALIDAD|MINISTERIO|SERVICIO|GOBIERNO|HOSPITAL|UNIVERSIDAD|SUBSECRETARIA|SERVICIO|ENERGIA/i.test(l);
            if (hasOrgKeyword && !/Publicada|Finaliza|Presupuesto|Revisar detalle/i.test(l)) {
              orgLine = l;
              break;
            }
          }
        }
      }
      
      // Último fallback: buscar cualquier línea con palabras clave de organismos
      if (!orgLine) {
        orgLine = lines.find((l) => {
          if (l.length < 10) return false;
          return /MUNICIPALIDAD|MINISTERIO|SERVICIO|GOBIERNO|HOSPITAL|UNIVERSIDAD|SUBSECRETARIA|ENERGIA/i.test(l) &&
                 !/Publicada|Finaliza|Presupuesto|Revisar detalle|Segundo llamado|Tercer llamado/i.test(l);
        }) || '';
      }

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
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_KEY?.trim();

  if (!url || !key) {
    if (allowNull) {
      console.warn('[Config] Modo dry-run: SUPABASE_URL o SUPABASE_KEY no configurados. No se escribirán datos.');
      return null;
    }
    const faltantes = [];
    if (!url) faltantes.push('SUPABASE_URL');
    if (!key) faltantes.push('SUPABASE_KEY');
    throw new Error(`Faltan variables de entorno requeridas: ${faltantes.join(', ')}. Configúralas en .env o como variables de entorno.`);
  }

  // Validación básica de formato
  if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
    throw new Error(`SUPABASE_URL tiene formato inválido. Debe ser: https://xxxxx.supabase.co`);
  }

  if (key.length < 20) {
    throw new Error(`SUPABASE_KEY parece inválida (muy corta). Verifica que sea la key correcta.`);
  }

  try {
    return createClient(url, key, {
      auth: { persistSession: false }
    });
  } catch (err) {
    throw new Error(`Error al crear cliente Supabase: ${err.message}`);
  }
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

  // Escribir logs reales en system_logs con retry y validación
  if (rows.length > 0 && supabase) {
    const logEntries = rows.map(lic => ({
      tipo: 'scraping',
      severidad: 'success',
      mensaje: `Licitación ${lic.codigo}: ${lic.titulo || 'Sin título'} – ${lic.organismo || 'Organismo no especificado'}`,
      licitacion_id: lic.codigo,
      detalles: {
        codigo: lic.codigo,
        organismo: lic.organismo,
        presupuesto: lic.presupuesto_estimado,
        estado: lic.estado,
        fecha_extraccion: new Date().toISOString(),
      }
    }));

    // Insertar logs en batches con retry automático
    const logBatches = chunkArray(logEntries, 50);
    let logsExitosos = 0;
    let logsFallidos = 0;

    for (const logBatch of logBatches) {
      const resultado = await withRetries(
        async () => {
          const { error: logError, data } = await supabase
            .from('system_logs')
            .insert(logBatch)
            .select();
          
          if (logError) {
            // Error de RLS o tabla no existe
            if (logError.code === 'PGRST301' || logError.message?.includes('permission denied')) {
              throw new Error(`Permisos insuficientes para escribir logs: ${logError.message}`);
            }
            if (logError.code === '42P01' || logError.message?.includes('does not exist')) {
              throw new Error('Tabla system_logs no existe en la base de datos');
            }
            throw logError;
          }
          
          return data?.length || logBatch.length;
        },
        {
          retries: 2, // 2 reintentos adicionales (total 3 intentos)
          onRetry: async (err, attempt) => {
            console.warn(`[Logs] Reintento ${attempt}/2: ${String(err?.message || err).slice(0, 100)}`);
            await sleepRandom(500, 1500);
          }
        }
      ).catch(err => {
        // Si falla después de todos los reintentos, registrar pero no fallar
        console.warn(`[Logs] No se pudieron escribir ${logBatch.length} logs después de reintentos: ${String(err?.message || err).slice(0, 150)}`);
        return null;
      });

      if (resultado) {
        logsExitosos += resultado;
      } else {
        logsFallidos += logBatch.length;
      }
    }

    // Resumen de escritura de logs
    if (logsExitosos > 0) {
      console.log(`[Logs] ✅ ${logsExitosos} logs escritos exitosamente en system_logs`);
    }
    if (logsFallidos > 0) {
      console.warn(`[Logs] ⚠️  ${logsFallidos} logs no pudieron escribirse (continuando sin fallar)`);
    }
  }
}

// Constantes para clasificación
// UTM Enero 2026: $69.751 CLP (Banco Central de Chile)
// Actualizar mensualmente según: https://si3.bcentral.cl/bdemovil/BDE/Series/MOV_SC_PR12
const UTM_2026 = 69751;
const UMBRAL_LICITACION_UTM = 100;
const UMBRAL_LICITACION_CLP = UMBRAL_LICITACION_UTM * UTM_2026; // $6.975.100 CLP

function esCompraAgil(monto) {
  // REGLA: Compra Ágil si monto <= 100 UTM, Licitación si > 100 UTM
  if (!monto || monto === 0) return true; // Sin monto = compra ágil por defecto
  return monto <= UMBRAL_LICITACION_CLP;
}

async function upsertComprasAgiles(supabase, licitacionesRows) {
  // Mapear datos de licitaciones a compras_agiles
  // IMPORTANTE: Solo guardar en compras_agiles si el monto <= 100 UTM
  const comprasAgilesRows = licitacionesRows
    .filter((lic) => {
      // Solo procesar si es realmente una compra ágil (<= 100 UTM)
      return esCompraAgil(lic.presupuesto_estimado);
    })
    .map((lic) => {
      const montoUTM = lic.presupuesto_estimado ? (lic.presupuesto_estimado / UTM_2026).toFixed(2) : null;
      const clasificacion = lic.presupuesto_estimado 
        ? (lic.presupuesto_estimado <= UMBRAL_LICITACION_CLP ? 'L1' : 
           lic.presupuesto_estimado <= (1000 * UTM_2026) ? 'LE' :
           lic.presupuesto_estimado <= (5000 * UTM_2026) ? 'LP' : 'LR')
        : 'L1';
      
      // Extraer información adicional de datos_json si existe
      const datosAdicionales = lic.datos_json || {};
      
      const row = {
        codigo: lic.codigo,
        nombre: lic.titulo || `Compra Ágil ${lic.codigo}`,
        nombre_organismo: lic.organismo || datosAdicionales.organismo_nombre || 'Organismo no especificado',
        monto_estimado: lic.presupuesto_estimado || null,
        fecha_cierre: lic.finaliza_el || null,
        estado: lic.estado_detallado || lic.estado || 'activa',
        region: datosAdicionales.region || lic.departamento || datosAdicionales.comuna || null,
        descripcion: datosAdicionales.descripcion_completa || lic.titulo || null,
        // IMPORTANTE: Establecer match_encontrado en false para que aparezcan como "nuevas"
        match_encontrado: false,
        match_score: null,
        datos_json: {
          estado_original: lic.estado,
          estado_detallado: lic.estado_detallado,
          publicada_el: lic.publicada_el,
          finaliza_el: lic.finaliza_el,
          departamento: lic.departamento,
          fecha_extraccion: lic.fecha_extraccion,
          link_detalle: lic.link_detalle || null,
          monto_utm: montoUTM,
          categoria: clasificacion,
          tipo_proceso: 'compra_agil', // Clasificado como compra ágil (<= 100 UTM)
          // Incluir TODA la información adicional extraída
          ...datosAdicionales,
          // Información de contacto
          organismo_rut: datosAdicionales.organismo_rut || null,
          organismo_direccion: datosAdicionales.organismo_direccion || null,
          contacto_email: datosAdicionales.contacto_email || null,
          contacto_telefono: datosAdicionales.contacto_telefono || null,
          responsable: datosAdicionales.responsable || null,
          // Información de entrega y pago
          condiciones_pago: datosAdicionales.condiciones_pago || null,
          plazo_entrega: datosAdicionales.plazo_entrega || null,
          forma_pago: datosAdicionales.forma_pago || null,
          lugar_entrega: datosAdicionales.lugar_entrega || null,
          // Información adicional
          unidad_compra: datosAdicionales.unidad_compra || null,
          comuna: datosAdicionales.comuna || null,
          moneda: datosAdicionales.moneda || 'CLP',
          tipo_proceso_detalle: datosAdicionales.tipo_proceso || null,
          modalidad: datosAdicionales.modalidad || null
        }
      };
      
      // Solo agregar link_oficial si existe (evitar error de schema cache)
      if (lic.link_detalle) {
        row.link_oficial = lic.link_detalle;
      }
      
      return row;
    });

  const batches = chunkArray(comprasAgilesRows, 200);
  for (const batch of batches) {
    const { error } = await supabase
      .from('compras_agiles')
      .upsert(batch, { onConflict: 'codigo' });
    if (error) {
      console.warn(`Error al sincronizar a compras_agiles: ${error.message}`);
      // No lanzamos error para no interrumpir el proceso principal
    }
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

    // Extraer TODA la información adicional de la ficha
    function extractInformacionAdicional() {
      const bodyText = norm(document.body.innerText || document.body.textContent || '');
      const info = {};

      // Región: buscar "Región" o "Comuna" o nombres de regiones chilenas
      const regiones = ['Arica y Parinacota', 'Tarapacá', 'Antofagasta', 'Atacama', 'Coquimbo', 
                       'Valparaíso', 'Metropolitana', 'O\'Higgins', 'Maule', 'Ñuble', 
                       'Biobío', 'Araucanía', 'Los Ríos', 'Los Lagos', 'Aysén', 'Magallanes'];
      for (const reg of regiones) {
        if (bodyText.includes(reg)) {
          info.region = reg;
          break;
        }
      }
      if (!info.region) {
        const regionMatch = bodyText.match(/Regi[oó]n[:\s]+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ\s]+)/i);
        if (regionMatch) info.region = norm(regionMatch[1]);
      }

      // Comuna
      const comunaMatch = bodyText.match(/Comuna[:\s]+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ\s]+)/i);
      if (comunaMatch) info.comuna = norm(comunaMatch[1]);

      // Descripción completa: buscar sección de descripción
      const descHeading = findHeading('descripción') || findHeading('objeto') || findHeading('detalle');
      if (descHeading) {
        let descNode = descHeading.nextElementSibling || descHeading.parentElement;
        let descText = '';
        for (let i = 0; i < 5 && descNode; i++) {
          const text = textOf(descNode);
          if (text.length > 50) {
            descText = text;
            break;
          }
          descNode = descNode.nextElementSibling || descNode.parentElement;
        }
        if (descText) info.descripcion_completa = descText.substring(0, 5000);
      }

      // Información del organismo (RUT, dirección, contacto)
      const rutMatch = bodyText.match(/RUT[:\s]+([\d\.]+-[\dkK])/i);
      if (rutMatch) info.organismo_rut = rutMatch[1];

      const direccionMatch = bodyText.match(/Direcci[oó]n[:\s]+([A-ZÁÉÍÓÚÑ0-9\s,\.-]+)/i);
      if (direccionMatch) info.organismo_direccion = norm(direccionMatch[1].substring(0, 200));

      // Contacto: email y teléfono
      const emailMatch = bodyText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailMatch) info.contacto_email = emailMatch[1];

      const telefonoMatch = bodyText.match(/(\+?56\s?)?[\s]?([2-9]\d{8})/);
      if (telefonoMatch) info.contacto_telefono = telefonoMatch[0].trim();

      // Condiciones de pago
      const pagoMatch = bodyText.match(/Pago[:\s]+([^\.]+)/i) || bodyText.match(/Condiciones de pago[:\s]+([^\.]+)/i);
      if (pagoMatch) info.condiciones_pago = norm(pagoMatch[1].substring(0, 500));

      // Plazo de entrega
      const entregaMatch = bodyText.match(/Plazo de entrega[:\s]+([^\.]+)/i) || bodyText.match(/Entrega[:\s]+([^\.]+)/i);
      if (entregaMatch) info.plazo_entrega = norm(entregaMatch[1].substring(0, 200));

      // Forma de pago
      const formaPagoMatch = bodyText.match(/Forma de pago[:\s]+([^\.]+)/i);
      if (formaPagoMatch) info.forma_pago = norm(formaPagoMatch[1].substring(0, 200));

      // Lugar de entrega
      const lugarEntregaMatch = bodyText.match(/Lugar de entrega[:\s]+([^\.]+)/i);
      if (lugarEntregaMatch) info.lugar_entrega = norm(lugarEntregaMatch[1].substring(0, 500));

      // Unidad de compra
      const unidadCompraMatch = bodyText.match(/Unidad de compra[:\s]+([^\.]+)/i);
      if (unidadCompraMatch) info.unidad_compra = norm(unidadCompraMatch[1].substring(0, 200));

      // Responsable de la compra
      const responsableMatch = bodyText.match(/Responsable[:\s]+([^\.]+)/i) || bodyText.match(/Contacto[:\s]+([^\.]+)/i);
      if (responsableMatch) info.responsable = norm(responsableMatch[1].substring(0, 200));

      // Moneda
      const monedaMatch = bodyText.match(/Moneda[:\s]+([A-Z]{3})/i);
      if (monedaMatch) info.moneda = monedaMatch[1];

      // Tipo de proceso
      const tipoMatch = bodyText.match(/Tipo[:\s]+([^\.]+)/i);
      if (tipoMatch) info.tipo_proceso = norm(tipoMatch[1].substring(0, 100));

      // Modalidad
      const modalidadMatch = bodyText.match(/Modalidad[:\s]+([^\.]+)/i);
      if (modalidadMatch) info.modalidad = norm(modalidadMatch[1].substring(0, 100));

      return info;
    }

    return {
      productos: extractProductos(),
      documentos: extractDocumentos(),
      informacion_adicional: extractInformacionAdicional()
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

  // Configurar directorio de datos de usuario en el workspace para evitar problemas de permisos en macOS
  const userDataDir = path.join(process.cwd(), '.puppeteer-user-data');
  
  // Intentar usar Chrome del sistema en macOS si está disponible
  let executablePath = null;
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ];
  
  for (const chromePath of chromePaths) {
    if (fs.existsSync(chromePath)) {
      executablePath = chromePath;
      console.log(`Usando Chrome del sistema: ${executablePath}`);
      break;
    }
  }
  
  const launchOptions = {
    headless: isHeadless ? 'new' : false,
    userDataDir: userDataDir,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-crashpad',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--disable-renderer-backgrounding',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-pings',
      '--password-store=basic',
      '--use-mock-keychain',
      '--crash-dumps-dir=' + path.join(process.cwd(), '.puppeteer-crash-dumps')
    ],
    ignoreDefaultArgs: ['--disable-extensions'],
    timeout: 60000
  };
  
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }
  
  const browser = await puppeteer.launch(launchOptions);

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
        nombre: c.titulo || `Compra Ágil ${c.codigo}`, // Asegurar que nombre no sea null
        fecha_extraccion: nowIso,
        // Incluir datos_json para almacenar información adicional que se extraerá después
        datos_json: c.datos_json || {}
      }));

      if (dryRun) {
        console.log(`[dry-run] Enviaría ${licRows.length} filas a 'licitaciones' (upsert por codigo).`);
        if (licRows.length > 0) {
          console.log(`[dry-run] Ejemplo de compra extraída:`, JSON.stringify(licRows[0], null, 2));
        }
      } else {
        if (licRows.length) {
          try {
            await upsertLicitaciones(supabase, licRows);
            console.log(`Upsert OK: ${licRows.length} filas en 'licitaciones'.`);
            
            // Sincronizar SOLO compras ágiles (<= 100 UTM) a compras_agiles para el frontend
            // REGLA: Licitaciones (> 100 UTM) NO van a compras_agiles
            try {
              const comprasAgiles = licRows.filter(lic => esCompraAgil(lic.presupuesto_estimado));
              if (comprasAgiles.length > 0) {
                await upsertComprasAgiles(supabase, comprasAgiles);
                console.log(`Sincronización OK: ${comprasAgiles.length} compras ágiles (<= 100 UTM) en 'compras_agiles'.`);
                const licitaciones = licRows.length - comprasAgiles.length;
                if (licitaciones > 0) {
                  console.log(`ℹ️  ${licitaciones} licitaciones (> 100 UTM) NO se guardaron en compras_agiles (correcto según regla de negocio).`);
                }
              } else {
                console.log(`ℹ️  Todas las ${licRows.length} son licitaciones (> 100 UTM), no se guardan en compras_agiles.`);
              }
            } catch (syncErr) {
              console.warn(`Advertencia: No se pudo sincronizar a compras_agiles (continuando): ${String(syncErr?.message || syncErr)}`);
            }
          } catch (supabaseErr) {
            console.warn(`Error al guardar en Supabase (continuando): ${String(supabaseErr?.message || supabaseErr)}`);
            if (args.test) {
              console.log(`[test] Ejemplo de compra extraída:`, JSON.stringify(licRows[0], null, 2));
            }
          }
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
            const infoAdicional = detalle.informacion_adicional || {};

            // Actualizar licitación con información adicional extraída de la ficha
            if (Object.keys(infoAdicional).length > 0 && !dryRun && supabase) {
              try {
                const updateData = {
                  datos_json: {
                    ...(compra.datos_json || {}),
                    ...infoAdicional,
                    fecha_actualizacion_detalle: nowIso,
                    productos_extraidos: productos.length,
                    documentos_extraidos: (detalle.documentos || []).length
                  }
                };
                
                // Agregar campos específicos si existen en la tabla licitaciones
                if (infoAdicional.region) updateData.region = infoAdicional.region;
                if (infoAdicional.descripcion_completa) {
                  updateData.descripcion = infoAdicional.descripcion_completa;
                  updateData.estado_detallado = infoAdicional.descripcion_completa.substring(0, 500);
                }
                
                await supabase
                  .from('licitaciones')
                  .update(updateData)
                  .eq('codigo', compra.codigo);
                  
                // También actualizar compras_agiles si es una compra ágil
                if (esCompraAgil(compra.presupuesto_estimado)) {
                  const compraAgilUpdate = {
                    datos_json: {
                      ...updateData.datos_json,
                      fecha_actualizacion_detalle: nowIso
                    }
                  };
                  if (infoAdicional.region) compraAgilUpdate.region = infoAdicional.region;
                  if (infoAdicional.descripcion_completa) compraAgilUpdate.descripcion = infoAdicional.descripcion_completa;
                  
                  await supabase
                    .from('compras_agiles')
                    .update(compraAgilUpdate)
                    .eq('codigo', compra.codigo);
                }
              } catch (updateErr) {
                console.warn(`No se pudo actualizar información adicional para ${compra.codigo}: ${updateErr.message}`);
              }
            }

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
              try {
                await upsertLicitacionItems(supabase, itemRows);
              } catch (supabaseErr) {
                console.warn(`Error al guardar items en Supabase (${compra.codigo}): ${String(supabaseErr?.message || supabaseErr)}`);
              }
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
      // Agregar TODAS las compras extraídas, no solo las nuevas
      const existing = new Set(allCompras.map((c) => c.codigo));
      for (const c of compras) {
        if (!existing.has(c.codigo)) {
          allCompras.push(c);
          existing.add(c.codigo);
        }
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
    console.log(
      `Finalizado. Compras únicas vistas (memoria): ${allCompras.length}. Total resultados detectado: ${totalResultados ?? 'N/A'}. Incremental=${incrementalMode ? 'ON' : 'OFF'}.`
    );
  }
}

// Ejecución principal con manejo robusto de errores
main()
  .then(() => {
    console.log('\n✅ Scraper completado exitosamente');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ FALLO FATAL DEL SCRAPER:');
    console.error('─'.repeat(60));
    console.error(`Error: ${err.message || String(err)}`);
    if (err.stack) {
      console.error('\nStack trace:');
      console.error(err.stack.split('\n').slice(0, 5).join('\n')); // Solo primeras 5 líneas
    }
    console.error('─'.repeat(60));
    console.error('\n💡 Posibles causas:');
    console.error('  - MercadoPúblico cambió su estructura HTML');
    console.error('  - Problemas de red o timeout');
    console.error('  - Credenciales de Supabase inválidas');
    console.error('  - Tablas de base de datos no existen');
    console.error('\n🔧 Acciones sugeridas:');
    console.error('  - Verifica tu conexión a internet');
    console.error('  - Revisa las variables de entorno (.env)');
    console.error('  - Ejecuta con --test para modo diagnóstico');
    console.error('  - Ejecuta con --headed para ver qué pasa visualmente');
    process.exitCode = 1;
    process.exit(1);
  });

