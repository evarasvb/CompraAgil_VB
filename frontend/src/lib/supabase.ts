import { createClient } from '@supabase/supabase-js'
import type { AutoBid, AutoBidItem, AutoBidStatus } from '../features/auto-bids/types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Falta configurar VITE_SUPABASE_URL y/o VITE_SUPABASE_ANON_KEY')
  }
  return supabase
}

const IVA_RATE = 0.19

function toFixed2(value: number) {
  return Math.round(value * 100) / 100
}

async function getNextAutoBidItemIndex(autoBidId: string): Promise<number> {
  const supabase = requireSupabase()

  const { data, error } = await supabase
    .from('auto_bid_items')
    .select('item_index')
    .eq('auto_bid_id', autoBidId)
    .order('item_index', { ascending: false })
    .limit(1)

  if (error) throw new Error(error.message)
  const max = data?.[0]?.item_index
  return typeof max === 'number' && Number.isFinite(max) ? max + 1 : 1
}

export async function updateAutoBidItem(itemId: string, data: Partial<AutoBidItem>): Promise<AutoBidItem> {
  const supabase = requireSupabase()

  const { data: updated, error } = await supabase
    .from('auto_bid_items')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return updated as AutoBidItem
}

export async function createAutoBidItem(autoBidId: string, data: Partial<AutoBidItem>): Promise<AutoBidItem> {
  const supabase = requireSupabase()

  const item_index =
    typeof data.item_index === 'number' && Number.isFinite(data.item_index)
      ? data.item_index
      : await getNextAutoBidItemIndex(autoBidId)

  const payload: Partial<AutoBidItem> & { auto_bid_id: string; item_index: number } = {
    ...data,
    auto_bid_id: autoBidId,
    item_index,
  }

  // No permitir setear `id` desde el cliente
  delete (payload as Partial<AutoBidItem> & { id?: string }).id

  const { data: created, error } = await supabase.from('auto_bid_items').insert(payload).select('*').single()
  if (error) throw new Error(error.message)
  return created as AutoBidItem
}

export async function deleteAutoBidItem(itemId: string): Promise<void> {
  const supabase = requireSupabase()

  const { error } = await supabase.from('auto_bid_items').delete().eq('id', itemId)
  if (error) throw new Error(error.message)
}

export async function recalculateAutoBidTotals(autoBidId: string): Promise<AutoBid> {
  const supabase = requireSupabase()

  const { data: items, error: itemsError } = await supabase
    .from('auto_bid_items')
    .select('cantidad, precio_unitario')
    .eq('auto_bid_id', autoBidId)

  if (itemsError) throw new Error(itemsError.message)

  const neto = (items ?? []).reduce((acc, it) => acc + Number(it.cantidad ?? 0) * Number(it.precio_unitario ?? 0), 0)
  const iva = toFixed2(neto * IVA_RATE)
  const total = toFixed2(neto + iva)

  const { data: updated, error } = await supabase
    .from('auto_bids')
    .update({
      total_neto: toFixed2(neto),
      iva,
      total,
      updated_at: new Date().toISOString(),
    })
    .eq('id', autoBidId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return updated as AutoBid
}

export async function updateAutoBidStatus(autoBidId: string, estado: AutoBidStatus): Promise<AutoBid> {
  const supabase = requireSupabase()

  const { data: updated, error } = await supabase
    .from('auto_bids')
    .update({ estado, updated_at: new Date().toISOString() })
    .eq('id', autoBidId)
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return updated as AutoBid
}

