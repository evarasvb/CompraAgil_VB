#!/usr/bin/env node

/**
 * Script de verificación de configuración para CompraAgil_VB
 * 
 * Verifica que todas las dependencias, variables de entorno y conexiones
 * estén correctamente configuradas antes de ejecutar el scraper.
 * 
 * Uso:
 *   node verify-setup.js
 */

require('dotenv').config();

const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function log(icon, color, message) {
  console.log(`${color}${icon}${RESET} ${message}`);
}

function success(message) {
  log('✅', GREEN, message);
}

function error(message) {
  log('❌', RED, message);
}

function warning(message) {
  log('⚠️ ', YELLOW, message);
}

function info(message) {
  log('🔹', BLUE, message);
}

function header(title) {
  console.log(`\n${BOLD}${BLUE}${'='.repeat(60)}${RESET}`);
  console.log(`${BOLD}${BLUE}  ${title}${RESET}`);
  console.log(`${BOLD}${BLUE}${'='.repeat(60)}${RESET}\n`);
}

function section(title) {
  console.log(`\n${BOLD}${title}${RESET}`);
}

let errorCount = 0;
let warningCount = 0;

async function testSupabaseConnection() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  if (!url || !key) {
    error('Variables SUPABASE_URL o SUPABASE_KEY no están definidas');
    errorCount++;
    return false;
  }

  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false }
    });

    info('Probando conexión a Supabase...');

    // Test 1: Verificar que las tablas existen
    const { data: licitaciones, error: errorLic } = await supabase
      .from('licitaciones')
      .select('codigo')
      .limit(1);

    if (errorLic) {
      if (errorLic.message.includes('relation') || errorLic.message.includes('does not exist')) {
        error('La tabla "licitaciones" no existe en Supabase');
        warning('Ejecuta el script SQL de SETUP_SUPABASE.md para crear las tablas');
        errorCount++;
        return false;
      }
      throw errorLic;
    }

    success('Tabla "licitaciones" existe y es accesible');

    // Test 2: Verificar tabla licitacion_items
    const { data: items, error: errorItems } = await supabase
      .from('licitacion_items')
      .select('id')
      .limit(1);

    if (errorItems) {
      if (errorItems.message.includes('relation') || errorItems.message.includes('does not exist')) {
        error('La tabla "licitacion_items" no existe en Supabase');
        errorCount++;
        return false;
      }
      throw errorItems;
    }

    success('Tabla "licitacion_items" existe y es accesible');

    // Test 3: Contar registros
    const { count: countLic } = await supabase
      .from('licitaciones')
      .select('*', { count: 'exact', head: true });

    const { count: countItems } = await supabase
      .from('licitacion_items')
      .select('*', { count: 'exact', head: true });

    info(`Registros actuales: ${countLic || 0} licitaciones, ${countItems || 0} items`);

    // Test 4: Intentar hacer un insert/delete de prueba
    const testData = {
      codigo: 'TEST-VERIFY-SETUP-' + Date.now(),
      titulo: 'Test de verificación',
      organismo: 'Test',
      presupuesto_estimado: 0,
      fecha_extraccion: new Date().toISOString()
    };

    const { error: insertError } = await supabase
      .from('licitaciones')
      .insert(testData);

    if (insertError) {
      error('No se puede insertar en la tabla "licitaciones"');
      error(`Error: ${insertError.message}`);
      errorCount++;
      return false;
    }

    // Limpiar el registro de prueba
    await supabase
      .from('licitaciones')
      .delete()
      .eq('codigo', testData.codigo);

    success('Permisos de escritura en Supabase funcionando correctamente');

    return true;
  } catch (err) {
    error(`Error al conectar con Supabase: ${err.message}`);
    if (err.message.includes('Invalid API key')) {
      warning('La SUPABASE_KEY parece ser inválida');
      warning('Verifica que estés usando la "service_role" key desde Supabase Dashboard');
    }
    errorCount++;
    return false;
  }
}

function testMercadoPublicoAccess() {
  return new Promise((resolve) => {
    info('Verificando acceso a MercadoPúblico...');

    const options = {
      hostname: 'buscador.mercadopublico.cl',
      port: 443,
      path: '/compra-agil',
      method: 'HEAD',
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 200 || res.statusCode === 301 || res.statusCode === 302) {
        success('MercadoPúblico es accesible');
        resolve(true);
      } else {
        warning(`MercadoPúblico respondió con código ${res.statusCode}`);
        warningCount++;
        resolve(false);
      }
    });

    req.on('error', (err) => {
      error(`No se puede acceder a MercadoPúblico: ${err.message}`);
      warningCount++;
      resolve(false);
    });

    req.on('timeout', () => {
      warning('Timeout al conectar con MercadoPúblico (puede ser problema de red)');
      warningCount++;
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function verifyDependencies() {
  section('📦 Verificando dependencias de Node.js');

  try {
    const puppeteer = require('puppeteer');
    success('puppeteer instalado');
  } catch (err) {
    error('puppeteer no está instalado');
    warning('Ejecuta: npm install');
    errorCount++;
  }

  try {
    const supabase = require('@supabase/supabase-js');
    success('@supabase/supabase-js instalado');
  } catch (err) {
    error('@supabase/supabase-js no está instalado');
    warning('Ejecuta: npm install');
    errorCount++;
  }

  try {
    const dotenv = require('dotenv');
    success('dotenv instalado');
  } catch (err) {
    error('dotenv no está instalado');
    warning('Ejecuta: npm install');
    errorCount++;
  }
}

function verifyEnvironmentVariables() {
  section('🔑 Verificando variables de entorno');

  const required = ['SUPABASE_URL', 'SUPABASE_KEY'];
  const optional = ['MAX_PAGES', 'INCREMENTAL_MODE'];

  for (const varName of required) {
    if (process.env[varName]) {
      const value = process.env[varName];
      if (varName === 'SUPABASE_KEY') {
        const masked = value.substring(0, 10) + '...' + value.substring(value.length - 10);
        success(`${varName} = ${masked}`);
      } else {
        success(`${varName} = ${value}`);
      }
    } else {
      error(`${varName} no está definida`);
      errorCount++;
    }
  }

  for (const varName of optional) {
    if (process.env[varName]) {
      info(`${varName} = ${process.env[varName]} (opcional)`);
    } else {
      info(`${varName} no está definida (usará valor por defecto)`);
    }
  }
}

function verifyConfiguration() {
  section('⚙️  Verificando archivos de configuración');

  const fs = require('fs');
  const path = require('path');

  const files = [
    { name: '.env', required: true },
    { name: 'config.js', required: true },
    { name: 'utils.js', required: true },
    { name: 'scraper.js', required: true },
    { name: 'package.json', required: true }
  ];

  for (const file of files) {
    const filePath = path.join(__dirname, file.name);
    if (fs.existsSync(filePath)) {
      success(`${file.name} existe`);
    } else {
      if (file.required) {
        error(`${file.name} no existe`);
        errorCount++;
      } else {
        warning(`${file.name} no existe (opcional)`);
        warningCount++;
      }
    }
  }
}

function printSummary() {
  console.log(`\n${BOLD}${BLUE}${'='.repeat(60)}${RESET}`);
  console.log(`${BOLD}${BLUE}  RESUMEN DE VERIFICACIÓN${RESET}`);
  console.log(`${BOLD}${BLUE}${'='.repeat(60)}${RESET}\n`);

  if (errorCount === 0 && warningCount === 0) {
    success('✨ Todo está configurado correctamente!');
    success('Puedes ejecutar el scraper con: node scraper.js --test');
    console.log();
    return true;
  } else if (errorCount === 0) {
    warning(`Se encontraron ${warningCount} advertencia(s), pero el sistema debería funcionar`);
    info('Puedes ejecutar el scraper con: node scraper.js --test');
    console.log();
    return true;
  } else {
    error(`Se encontraron ${errorCount} error(es) crítico(s)`);
    if (warningCount > 0) {
      warning(`También hay ${warningCount} advertencia(s)`);
    }
    error('Corrige los errores antes de ejecutar el scraper');
    console.log();
    return false;
  }
}

async function main() {
  header('VERIFICACIÓN DE CONFIGURACIÓN - CompraAgil_VB');

  info('Verificando configuración del sistema...');
  console.log();

  // 1. Verificar dependencias
  await verifyDependencies();

  // 2. Verificar archivos de configuración
  verifyConfiguration();

  // 3. Verificar variables de entorno
  verifyEnvironmentVariables();

  // 4. Verificar conexión a Supabase
  section('🔌 Verificando conexión a Supabase');
  await testSupabaseConnection();

  // 5. Verificar acceso a MercadoPúblico
  section('🌐 Verificando acceso a MercadoPúblico');
  await testMercadoPublicoAccess();

  // 6. Resumen
  const success = printSummary();

  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error('\n');
  error(`Error inesperado: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
