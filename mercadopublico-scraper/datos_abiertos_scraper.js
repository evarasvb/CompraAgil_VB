/**
 * Scraper de Compras Ágiles usando API de Datos Abiertos de ChileCompra
 * 
 * Esta fuente es más confiable que el scraping del buscador porque:
 * 1. No tiene protección CloudFront/WAF
 * 2. Proporciona archivos CSV/ZIP completos
 * 3. Es la fuente oficial de ChileCompra
 * 
 * URL: https://transparenciachc.blob.core.windows.net/trnspchc/COT_{año}-{mes}.zip
 */

require('dotenv').config();

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createReadStream, createWriteStream, existsSync, mkdirSync, unlinkSync } = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { matchLicitacion } = require('./matcher_firmavb');
const { toIsoNow } = require('./utils');

// Usar unzipper si está disponible, sino fallback
let unzipper;
try {
  unzipper = require('unzipper');
} catch (e) {
  console.warn('unzipper no disponible, intentando con yauzl...');
  try {
    unzipper = null;
  } catch (e2) {
    console.warn('Ninguna librería de ZIP disponible');
  }
}

// CSV parser simple
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ';' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(content) {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  
  const headers = parseCSVLine(lines[0]).map(h => h.replace(/"/g, '').trim().toLowerCase());
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ? values[idx].replace(/"/g, '').trim() : null;
    });
    rows.push(row);
  }
  return rows;
}

function env(name, fallback = '') {
  const v = process.env[name];
  return v == null ? fallback : String(v);
}

function getSupabaseClient() {
  const url = env('SUPABASE_URL').trim();
  const key = env('SUPABASE_SERVICE_KEY').trim() || env('SUPABASE_KEY').trim();
  if (!url || !key) throw new Error('Faltan SUPABASE_URL y/o SUPABASE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function buildZipUrl(year, month) {
  const mm = String(month).padStart(2, '0');
  return `https://transparenciachc.blob.core.windows.net/trnspchc/COT_${year}-${mm}.zip`;
}

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;
    
    console.log(`Descargando: ${url}`);
    
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Seguir redirección
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        return;
      }
      
      const totalBytes = parseInt(response.headers['content-length'], 10);
      let downloadedBytes = 0;
      
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (totalBytes) {
          const pct = Math.round((downloadedBytes / totalBytes) * 100);
          process.stdout.write(`\rDescargando: ${pct}%`);
        }
      });
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log('\nDescarga completada');
        resolve(destPath);
      });
    }).on('error', (err) => {
      if (existsSync(destPath)) unlinkSync(destPath);
      reject(err);
    });
  });
}

async function extractZip(zipPath, destDir) {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  
  if (unzipper) {
    return new Promise((resolve, reject) => {
      createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: destDir }))
        .on('close', () => resolve(destDir))
        .on('error', reject);
    });
  }
  
  // Fallback: usar comando unzip del sistema
  const { execSync } = require('child_process');
  try {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'inherit' });
    return destDir;
  } catch (e) {
    throw new Error('No se pudo extraer el ZIP. Instala unzipper: npm install unzipper');
  }
}

function mapRowToLicitacion(row) {
  // Mapear campos del CSV a nuestra estructura
  const codigo = row['codigo'] || row['codigocotizacion'] || row['codigo_cotizacion'] || '';
  if (!codigo) return null;
  
  const titulo = row['nombre'] || row['nombrecotizacion'] || row['descripcion'] || '';
  const organismo = row['organismo'] || row['nombreorganismo'] || row['comprador'] || '';
  const estado = row['estado'] || row['estadocotizacion'] || '';
  
  // Parsear fechas
  const parseDate = (val) => {
    if (!val) return null;
    const d = new Date(val);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  };
  
  const publicada_el = parseDate(row['fechapublicacion'] || row['fecha_publicacion'] || row['fechacreacion']);
  const finaliza_el = parseDate(row['fechacierre'] || row['fecha_cierre'] || row['fechafin']);
  
  // Parsear presupuesto
  const parseAmount = (val) => {
    if (!val) return null;
    const clean = String(val).replace(/[$\.]/g, '').replace(/,/g, '.').trim();
    const num = parseFloat(clean);
    return Number.isFinite(num) ? num : null;
  };
  
  const presupuesto_estimado = parseAmount(row['montoestimado'] || row['presupuesto'] || row['monto']);
  
  // Matching FirmaVB
  const matchResult = matchLicitacion({
    titulo: titulo || '',
    descripcion: row['descripcion'] || '',
    items: []
  });
  
  return {
    codigo,
    titulo: titulo || null,
    organismo: organismo || null,
    estado: estado || null,
    publicada_el,
    finaliza_el,
    presupuesto_estimado,
    departamento: row['departamento'] || row['unidad'] || null,
    link_detalle: `https://www.mercadopublico.cl/CompraAgil/Modules/CompraAgil/DetailsAcquisition.aspx?IDcompra=${encodeURIComponent(codigo)}`,
    categoria: matchResult?.categoria ?? null,
    categoria_match: matchResult?.categoria_match ?? null,
    match_score: matchResult?.match_score ?? 0,
    palabras_encontradas: Array.isArray(matchResult?.palabras_encontradas) && matchResult.palabras_encontradas.length
      ? JSON.stringify(matchResult.palabras_encontradas)
      : null,
    match_encontrado: Boolean(matchResult?.categoria),
    fecha_extraccion: toIsoNow(),
    fuente: 'datos_abiertos'
  };
}

async function main() {
  const supabase = getSupabaseClient();
  
  // Determinar qué meses procesar
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  
  // Por defecto, procesar el mes anterior (los datos se publican mensualmente)
  const targetYear = env('DATOS_ABIERTOS_YEAR', String(currentMonth === 1 ? currentYear - 1 : currentYear));
  const targetMonth = env('DATOS_ABIERTOS_MONTH', String(currentMonth === 1 ? 12 : currentMonth - 1));
  
  console.log(`[datos-abiertos] Procesando: ${targetYear}-${targetMonth}`);
  
  const tempDir = path.join(__dirname, '.temp_datos_abiertos');
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
  
  const zipUrl = buildZipUrl(targetYear, targetMonth);
  const zipPath = path.join(tempDir, `COT_${targetYear}-${targetMonth}.zip`);
  
  try {
    // 1. Descargar ZIP
    await downloadFile(zipUrl, zipPath);
    
    // 2. Extraer
    const extractDir = path.join(tempDir, `COT_${targetYear}-${targetMonth}`);
    await extractZip(zipPath, extractDir);
    
    // 3. Buscar y procesar archivos CSV
    const files = fs.readdirSync(extractDir);
    const csvFiles = files.filter(f => f.toLowerCase().endsWith('.csv'));
    
    if (!csvFiles.length) {
      throw new Error('No se encontraron archivos CSV en el ZIP');
    }
    
    console.log(`Archivos CSV encontrados: ${csvFiles.join(', ')}`);
    
    let totalRows = 0;
    let insertedRows = 0;
    
    for (const csvFile of csvFiles) {
      const csvPath = path.join(extractDir, csvFile);
      const content = fs.readFileSync(csvPath, 'utf-8');
      const rows = parseCSV(content);
      
      console.log(`Procesando ${csvFile}: ${rows.length} filas`);
      totalRows += rows.length;
      
      // Mapear y filtrar
      const licitaciones = rows
        .map(mapRowToLicitacion)
        .filter(r => r && r.codigo);
      
      // Insertar en batches
      const batchSize = 200;
      for (let i = 0; i < licitaciones.length; i += batchSize) {
        const batch = licitaciones.slice(i, i + batchSize);
        const { error } = await supabase
          .from('licitaciones')
          .upsert(batch, { onConflict: 'codigo' });
        
        if (error) {
          console.warn(`Error en batch: ${error.message}`);
        } else {
          insertedRows += batch.length;
        }
      }
    }
    
    console.log(`[datos-abiertos] Completado: ${insertedRows}/${totalRows} filas insertadas`);
    
    // Limpiar archivos temporales
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('No se pudo limpiar directorio temporal');
    }
    
  } catch (err) {
    console.error('[datos-abiertos] Error:', err.message);
    
    // Si el archivo no existe (mes futuro o aún no publicado), no es error crítico
    if (err.message.includes('404') || err.message.includes('Not Found')) {
      console.log('[datos-abiertos] El archivo aún no está disponible para este período');
      process.exitCode = 0;
    } else {
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error('[datos-abiertos] Fallo:', e);
  process.exitCode = 1;
});
