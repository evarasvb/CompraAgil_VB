#!/usr/bin/env node
/**
 * Script para actualizar compras_agiles existentes y hacerlas visibles en el dashboard
 * Establece match_encontrado = false para compras que no tienen este campo
 */

const fs = require('fs');
const path = require('path');

// Cargar .env manualmente
function loadEnv() {
  const envPath = path.join(__dirname, 'mercadopublico-scraper', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ No se encontró .env en mercadopublico-scraper/.env');
    process.exit(1);
  }
  
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

const env = loadEnv();
const { createClient } = require('./mercadopublico-scraper/node_modules/@supabase/supabase-js');

const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Faltan SUPABASE_URL o SUPABASE_KEY en .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

async function actualizarCompras() {
  console.log('🔄 Actualizando compras ágiles existentes...\n');

  // Primero, ver cuántas compras hay
  const { count, error: errorCount } = await supabase
    .from('compras_agiles')
    .select('*', { count: 'exact', head: true });

  if (errorCount) {
    console.error('❌ Error al contar compras:', errorCount.message);
    process.exit(1);
  }

  console.log(`📊 Total de compras en BD: ${count || 0}\n`);

  // Actualizar compras donde match_encontrado es null, undefined, o true (para resetearlas)
  // Primero obtener todas las que necesitan actualización
  const { data: paraActualizar, error: fetchError } = await supabase
    .from('compras_agiles')
    .select('codigo, match_encontrado')
    .or('match_encontrado.is.null,match_encontrado.eq.true');
  
  if (fetchError) {
    console.error('❌ Error al buscar compras:', fetchError.message);
    process.exit(1);
  }
  
  console.log(`📋 Compras que necesitan actualización: ${paraActualizar?.length || 0}\n`);
  
  if (!paraActualizar || paraActualizar.length === 0) {
    console.log('✅ Todas las compras ya tienen match_encontrado = false\n');
  } else {
    // Actualizar en lotes de 100
    const lotes = [];
    for (let i = 0; i < paraActualizar.length; i += 100) {
      lotes.push(paraActualizar.slice(i, i + 100));
    }
    
    let totalActualizadas = 0;
    for (const lote of lotes) {
      const codigos = lote.map(c => c.codigo);
      const { data: actualizadas, error: updateError } = await supabase
        .from('compras_agiles')
        .update({ 
          match_encontrado: false,
          match_score: null
        })
        .in('codigo', codigos)
        .select('codigo');
      
      if (updateError) {
        console.error('❌ Error al actualizar lote:', updateError.message);
        continue;
      }
      
      totalActualizadas += actualizadas?.length || 0;
    }
    
    console.log(`✅ Actualizadas ${totalActualizadas} compras\n`);
  }

  // Verificar resultado
  const { data: sinMatch, error: verifyError } = await supabase
    .from('compras_agiles')
    .select('codigo, nombre, match_encontrado')
    .or('match_encontrado.eq.false,match_encontrado.is.null')
    .limit(10);

  if (verifyError) {
    console.error('⚠️  Error al verificar:', verifyError.message);
  } else {
    console.log('📋 Primeras compras sin match (deberían aparecer en dashboard):');
    sinMatch?.forEach((c, i) => {
      console.log(`   ${i + 1}. ${c.codigo} - ${(c.nombre || '').substring(0, 50)}...`);
    });
    console.log(`\n✅ Total de compras visibles en dashboard: ${sinMatch?.length || 0}+`);
  }

  console.log('\n🎉 ¡Actualización completada!');
  console.log('   Refresca el dashboard en firmavb.cl/licitaciones para ver las compras.');
}

actualizarCompras().catch(console.error);
