import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Faltan variables VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY. ' +
      'Crea un .env local (ver .env.example).',
  );
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: { persistSession: true },
});

export const clienteInventarioOnConflict =
  (import.meta.env.VITE_CLIENTE_INVENTARIO_ONCONFLICT as string | undefined) ?? 'sku';

