require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

function env(name, fallback = '') {
  const v = process.env[name];
  return v == null ? fallback : String(v);
}

function envInt(name, fallback) {
  const raw = env(name, '').trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function getSupabaseClient() {
  const url = env('SUPABASE_URL');
  // Preferir service key si existe, sino SUPABASE_KEY
  const key = env('SUPABASE_SERVICE_KEY') || env('SUPABASE_KEY');
  if (!url || !key) throw new Error('Faltan SUPABASE_URL y/o SUPABASE_SERVICE_KEY/SUPABASE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeKeywords(s) {
  const norm = normalize(s);
  if (!norm) return [];
  // separa por coma/espacios
  const parts = norm.split(/[\s,]+/g).map((x) => x.trim()).filter(Boolean);
  // filtra tokens muy cortos
  return Array.from(new Set(parts.filter((t) => t.length >= 3)));
}

function computeMatchScore({ text, keywords }) {
  const t = normalize(text);
  if (!t || !keywords.length) return { score: 0, hits: [] };
  const hits = [];
  for (const kw of keywords) {
    if (t.includes(kw)) hits.push(kw);
  }
  // Score simple: cantidad de keywords únicas encontradas
  const score = hits.length;
  return { score, hits };
}

function parseArgs(argv) {
  const args = {
    minScore: 2,
    maxLicitaciones: 500,
    includeItems: true
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--min-score') args.minScore = Number.parseInt(argv[++i] || '2', 10);
    else if (a === '--max-licitaciones') args.maxLicitaciones = Number.parseInt(argv[++i] || '500', 10);
    else if (a === '--no-items') args.includeItems = false;
  }
  return args;
}

async function fetchClienteInventario(supabase) {
  const { data, error } = await supabase
    .from('cliente_inventario')
    .select('cliente_id,sku,nombre,keywords,activo')
    .eq('activo', true);
  if (error) throw error;
  return data || [];
}

async function fetchLicitaciones(supabase, max) {
  const { data, error } = await supabase
    .from('licitaciones')
    .select('codigo,titulo,organismo,departamento,estado,link_detalle')
    .order('created_at', { ascending: false })
    .limit(max);
  if (error) throw error;
  return data || [];
}

async function fetchItemsForLicitaciones(supabase, codigos) {
  if (!codigos.length) return new Map();
  const batches = [];
  for (let i = 0; i < codigos.length; i += 200) batches.push(codigos.slice(i, i + 200));
  const out = new Map();
  for (const batch of batches) {
    const { data, error } = await supabase
      .from('licitacion_items')
      .select('licitacion_codigo,nombre,descripcion,cantidad,unidad')
      .in('licitacion_codigo', batch);
    if (error) throw error;
    for (const row of data || []) {
      const key = row.licitacion_codigo;
      const arr = out.get(key) || [];
      arr.push(row);
      out.set(key, arr);
    }
  }
  return out;
}

async function upsertOfertas(supabase, rows) {
  if (!rows.length) return;
  // Se apoya en índices únicos parciales en DB; onConflict solo aplica a constraints explícitas.
  // Usamos upsert por (cliente_id, licitacion_codigo) cuando licitacion_codigo no es null.
  const { error } = await supabase
    .from('cliente_ofertas')
    .upsert(rows, { onConflict: 'cliente_id,licitacion_codigo' });
  if (error) throw error;
}

async function main() {
  const args = parseArgs(process.argv);
  const supabase = getSupabaseClient();

  console.log(`[match] minScore=${args.minScore} maxLicitaciones=${args.maxLicitaciones} includeItems=${args.includeItems ? 'YES' : 'NO'}`);

  const inventario = await fetchClienteInventario(supabase);
  const clientes = Array.from(new Set(inventario.map((x) => x.cliente_id)));
  console.log(`[match] inventario: ${inventario.length} productos, clientes: ${clientes.length}`);

  const licitaciones = await fetchLicitaciones(supabase, args.maxLicitaciones);
  console.log(`[match] licitaciones cargadas: ${licitaciones.length}`);

  const itemsByLic = args.includeItems
    ? await fetchItemsForLicitaciones(supabase, licitaciones.map((l) => l.codigo))
    : new Map();

  // keywords por cliente
  const kwByCliente = new Map();
  for (const row of inventario) {
    const base = kwByCliente.get(row.cliente_id) || new Set();
    const kws = [
      ...tokenizeKeywords(row.keywords || ''),
      ...tokenizeKeywords(row.nombre || ''),
      ...tokenizeKeywords(row.sku || '')
    ];
    for (const k of kws) base.add(k);
    kwByCliente.set(row.cliente_id, base);
  }

  let totalSugeridas = 0;

  for (const clienteId of clientes) {
    const kwSet = kwByCliente.get(clienteId) || new Set();
    const keywords = Array.from(kwSet);
    if (!keywords.length) continue;

    const toUpsert = [];

    for (const l of licitaciones) {
      const items = itemsByLic.get(l.codigo) || [];
      const text = [
        l.titulo || '',
        l.organismo || '',
        l.departamento || '',
        ...items.flatMap((it) => [it.nombre || '', it.descripcion || ''])
      ].join(' ');

      const { score, hits } = computeMatchScore({ text, keywords });
      if (score < args.minScore) continue;

      toUpsert.push({
        cliente_id: clienteId,
        licitacion_codigo: l.codigo,
        estado: 'sugerida',
        match_score: score,
        respuesta_mp: hits.length ? { keywords: hits.slice(0, 50) } : null
      });
    }

    if (toUpsert.length) {
      await upsertOfertas(supabase, toUpsert);
      totalSugeridas += toUpsert.length;
      console.log(`[match] cliente=${clienteId}: sugeridas=${toUpsert.length}`);
    }
  }

  console.log(`[match] total sugeridas upsert: ${totalSugeridas}`);
}

main().catch((err) => {
  console.error('[match] fallo fatal:', err);
  process.exitCode = 1;
});

