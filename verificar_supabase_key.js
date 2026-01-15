#!/usr/bin/env node
/**
 * Script para verificar si SUPABASE_KEY es service_role o anon
 * 
 * Uso: node verificar_supabase_key.js [key]
 */

const fs = require('fs');
const path = require('path');

function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // Decodificar base64 (puede necesitar padding)
    let payload = parts[1];
    while (payload.length % 4) {
      payload += '=';
    }
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
    return decoded;
  } catch (e) {
    return null;
  }
}

function loadEnv() {
  const envPath = path.join(__dirname, 'mercadopublico-scraper', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    content.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        env[match[1].trim()] = match[2].trim();
      }
    });
    return env;
  }
  return {};
}

function checkKey(key) {
  if (!key) {
    console.log('❌ No se proporcionó SUPABASE_KEY');
    return false;
  }

  const decoded = decodeJWT(key);
  if (!decoded) {
    console.log('❌ Key inválida (no es un JWT válido)');
    return false;
  }

  const role = decoded.role;
  const isServiceRole = role === 'service_role';
  const isAnon = role === 'anon';

  console.log('\n📋 Análisis de SUPABASE_KEY:');
  console.log(`   Role: ${role}`);
  console.log(`   Issuer: ${decoded.iss || 'N/A'}`);
  console.log(`   Ref: ${decoded.ref || 'N/A'}`);
  
  if (isServiceRole) {
    console.log('\n✅ CORRECTO: Es una service_role_key');
    console.log('   Esta key puede bypass RLS y escribir en todas las tablas.');
    return true;
  } else if (isAnon) {
    console.log('\n⚠️  ADVERTENCIA: Es una anon key');
    console.log('   Esta key está sujeta a RLS y puede ser bloqueada.');
    console.log('   Para el scraper, necesitas la service_role_key.');
    console.log('\n   📝 Cómo obtenerla:');
    console.log('   1. Ve a tu proyecto en Supabase Dashboard');
    console.log('   2. Settings → API');
    console.log('   3. Copia la "service_role" key (secreta)');
    console.log('   4. Actualiza SUPABASE_KEY en mercadopublico-scraper/.env');
    return false;
  } else {
    console.log(`\n❓ Role desconocido: ${role}`);
    return false;
  }
}

// Main
const keyArg = process.argv[2];
const env = loadEnv();
const key = keyArg || env.SUPABASE_KEY;

if (!key) {
  console.log('❌ No se encontró SUPABASE_KEY');
  console.log('\nUso:');
  console.log('  node verificar_supabase_key.js [key]');
  console.log('O asegúrate de tener SUPABASE_KEY en mercadopublico-scraper/.env');
  process.exit(1);
}

const isValid = checkKey(key);
process.exit(isValid ? 0 : 1);
