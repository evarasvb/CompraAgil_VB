#!/usr/bin/env node
/**
 * Script para aplicar migración de base de datos automáticamente
 * Uso: node apply_migration.js
 * 
 * Requiere variables de entorno:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_KEY con permisos de service_role)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Error: Faltan variables de entorno');
  console.error('   Requiere: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function applyMigration() {
  console.log('🚀 Aplicando migración de base de datos...\n');

  // Leer el archivo de migración
  const migrationPath = path.join(
    __dirname,
    'mercadopublico-scraper/agile-bidder/supabase/migrations/20260117000000_add_costo_neto_margen_comercial_inventory.sql'
  );

  if (!fs.existsSync(migrationPath)) {
    console.error(`❌ Error: No se encontró el archivo de migración en: ${migrationPath}`);
    process.exit(1);
  }

  const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

  console.log('📄 Contenido de la migración:');
  console.log('   - Agregar costo_neto a inventory');
  console.log('   - Agregar margen_comercial a inventory');
  console.log('   - Agregar regiones_config a user_settings');
  console.log('   - Crear función y trigger para margen automático\n');

  try {
    // Ejecutar la migración usando Supabase REST API
    // Nota: Supabase no tiene un endpoint directo para ejecutar SQL arbitrario
    // Necesitamos usar el cliente de Postgres directamente o el Dashboard
    
    console.log('⚠️  Nota: Supabase no permite ejecutar SQL arbitrario vía REST API por seguridad.');
    console.log('   Por favor, aplica la migración manualmente:\n');
    console.log('   1. Ve a Supabase Dashboard → SQL Editor');
    console.log('   2. Copia y pega el siguiente SQL:\n');
    console.log('─'.repeat(60));
    console.log(migrationSQL);
    console.log('─'.repeat(60));
    console.log('\n   3. Ejecuta la migración');
    console.log('\n   O usa el CLI de Supabase:');
    console.log('   cd mercadopublico-scraper/agile-bidder');
    console.log('   supabase db push\n');

    // Alternativa: Intentar verificar si los campos ya existen
    console.log('🔍 Verificando estado actual de la base de datos...\n');

    // Verificar si costo_neto existe
    const { data: inventoryColumns, error: inventoryError } = await supabase
      .from('inventory')
      .select('*')
      .limit(1);

    if (inventoryError) {
      console.error('❌ Error al verificar inventory:', inventoryError.message);
    } else {
      console.log('✅ Tabla inventory existe');
      
      // Intentar insertar un registro de prueba para ver qué campos faltan
      // (esto fallará si falta costo_neto y es NOT NULL)
      const testData = {
        sku: '__test_migration_check__',
        nombre_producto: 'Test',
        categoria: 'Test',
        costo_neto: 0,
        precio_unitario: 1000,
        unidad_medida: 'unidad',
      };

      const { error: insertError } = await supabase
        .from('inventory')
        .insert(testData);

      if (insertError) {
        if (insertError.message.includes('costo_neto')) {
          console.log('⚠️  Campo costo_neto NO existe aún. Necesitas aplicar la migración.');
        } else {
          console.log('ℹ️  Error de inserción (esperado):', insertError.message);
        }
      } else {
        // Limpiar el registro de prueba
        await supabase.from('inventory').delete().eq('sku', '__test_migration_check__');
        console.log('✅ Campo costo_neto existe');
      }
    }

    // Verificar user_settings
    const { data: settingsColumns, error: settingsError } = await supabase
      .from('user_settings')
      .select('*')
      .limit(1);

    if (settingsError) {
      console.error('❌ Error al verificar user_settings:', settingsError.message);
    } else {
      console.log('✅ Tabla user_settings existe');
    }

    console.log('\n📋 Resumen:');
    console.log('   Para aplicar la migración, usa una de estas opciones:');
    console.log('   1. Supabase Dashboard → SQL Editor (Recomendado)');
    console.log('   2. Supabase CLI: supabase db push');
    console.log('   3. psql directo a la base de datos\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

applyMigration();
