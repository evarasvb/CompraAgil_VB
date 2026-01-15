import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { requireSupabase } from '../../../lib/supabase'
import { formatCLP } from '../../../lib/money'
import type { AutoBid, AutoBidItem, ConductaPago } from '../types'
import { AutoBidItemsTable } from '../components/AutoBidItemsTable'
import { EditItemModal } from '../components/EditItemModal'
import { TotalsSidebar } from '../components/TotalsSidebar'

export function AutoBidDetailPage() {
  const { id } = useParams()
  const [bid, setBid] = useState<AutoBid | null>(null)
  const [items, setItems] = useState<AutoBidItem[]>([])
  const [conducta, setConducta] = useState<ConductaPago | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [editable, setEditable] = useState(false)
  const [editingItem, setEditingItem] = useState<AutoBidItem | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setError(null)

      if (!id) return

      let supabase
      try {
        supabase = requireSupabase()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error de configuración Supabase')
        setBid(null)
        setItems([])
        setConducta(null)
        return
      }

      const { data: bidData, error: bidError } = await supabase.from('auto_bids').select('*').eq('id', id).single()
      if (cancelled) return
      if (bidError) {
        setError(bidError.message)
        setBid(null)
        setItems([])
        return
      }
      setBid(bidData as AutoBid)

      const { data: itemsData, error: itemsError } = await supabase
        .from('auto_bid_items')
        .select('*')
        .eq('auto_bid_id', id)
        .order('item_index', { ascending: true })

      if (cancelled) return
      if (itemsError) {
        setError(itemsError.message)
        setItems([])
      } else {
        setItems((itemsData as AutoBidItem[]) ?? [])
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    let cancelled = false

    async function loadConducta() {
      let supabase
      try {
        supabase = requireSupabase()
      } catch {
        return
      }
      if (!bid) return

      const rut = bid.rut_institucion?.trim()
      if (!rut) return

      const { data, error } = await supabase
        .from('conducta_pago')
        .select('*')
        .eq('rut_institucion', rut)
        .order('periodo', { ascending: false })
        .limit(1)

      if (cancelled) return
      if (error) return
      setConducta((data?.[0] as ConductaPago) ?? null)
    }

    loadConducta()
    return () => {
      cancelled = true
    }
  }, [bid])

  const header = useMemo(() => {
    if (!bid) return null
    const estadoLabel = bid.estado === 'pendiente' || bid.estado === 'borrador' ? 'Pendiente' : 'Abierta'
    return { estadoLabel }
  }, [bid])

  if (!bid) return <div className="text-sm text-slate-600">{error ? 'No se pudo cargar la oferta.' : 'Cargando…'}</div>

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Error: <span className="font-mono">{error}</span>.
        </div>
      ) : null}

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-slate-900">{bid.codigo_proceso}</div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                {header?.estadoLabel}
              </span>
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{bid.titulo ?? 'Sin título'}</div>
            <div className="mt-1 text-sm text-slate-600">
              {bid.organismo ?? '—'} · {bid.departamento ?? bid.unidad_compra ?? '—'}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="rounded-md border px-3 py-2 text-xs font-semibold hover:bg-slate-50">
              Exportar Items
            </button>
            <button
              className="rounded-md border px-3 py-2 text-xs font-semibold hover:bg-slate-50"
              onClick={() => setEditable((v) => !v)}
            >
              {editable ? 'Salir edición' : 'Editar'}
            </button>
            <button className="rounded-md border px-3 py-2 text-xs font-semibold hover:bg-slate-50">
              Previsualizar PDF
            </button>
            <button className="rounded-md border px-3 py-2 text-xs font-semibold hover:bg-slate-50">
              Guardar Borrador
            </button>
            <button className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700">
              Enviar Oferta
            </button>
            <button className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50">
              Anular
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-600">Fechas</div>
            <div className="mt-1 text-sm text-slate-900">
              Publicación:{' '}
              <span className="font-semibold">
                {bid.fecha_publicacion ? new Date(bid.fecha_publicacion).toLocaleString('es-CL') : '—'}
              </span>
              <br />
              Cierre:{' '}
              <span className="font-semibold">
                {bid.fecha_cierre ? new Date(bid.fecha_cierre).toLocaleString('es-CL') : '—'}
              </span>
            </div>
          </div>

          <div className="rounded-md bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-600">Presupuesto</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{formatCLP(bid.presupuesto_total ?? 0)}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              Convocatoria: {bid.convocatoria ? bid.convocatoria.replace('_', ' ') : '—'}
            </div>
          </div>

          <div className="rounded-md bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-600">Conducta de Pago</div>
            {conducta ? (
              <div className="mt-1 text-sm text-slate-900">
                <span className="font-semibold">{conducta.dias_promedio_pago ?? '—'}</span> días promedio ·{' '}
                <span className="font-semibold">{conducta.porcentaje_morosidad ?? '—'}%</span> morosidad
                <div className="mt-0.5 text-xs text-slate-500">Muestras: {conducta.muestras ?? '—'}</div>
              </div>
            ) : (
              <div className="mt-1 text-sm text-slate-500">Sin datos (pendiente de carga).</div>
            )}
          </div>
        </div>

        {bid.descripcion ? (
          <div className="mt-4 text-sm text-slate-700">
            <div className="text-xs font-semibold text-slate-600">Descripción</div>
            <div className="mt-1 whitespace-pre-wrap">{bid.descripcion}</div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <AutoBidItemsTable
            items={items}
            editable={editable}
            onAddItem={() => {
              const next: AutoBidItem = {
                id: `tmp-${Date.now()}`,
                auto_bid_id: bid.id,
                item_index: items.length ? Math.max(...items.map((x) => x.item_index)) + 1 : 1,
                requerimiento: 'Nuevo requerimiento',
                inventario_producto_id: null,
                match_confidence: null,
                match_method: null,
                nombre_oferta: null,
                sku: null,
                proveedor: null,
                cantidad: 1,
                unidad: 'Unid.',
                precio_unitario: 0,
                imagen_url: null,
                ficha_tecnica_url: null,
                notas: null,
              }
              setItems((prev) => [...prev, next])
              setEditingItem(next)
            }}
            onEditItem={(it) => setEditingItem(it)}
          />
        </div>

        <TotalsSidebar items={items} presupuestoTotal={bid.presupuesto_total} />
      </div>

      <EditItemModal
        key={editingItem?.id ?? 'closed'}
        open={Boolean(editingItem)}
        item={editingItem}
        onClose={() => setEditingItem(null)}
        onSave={(next) => {
          setItems((prev) => prev.map((x) => (x.id === next.id ? next : x)))
        }}
      />
    </div>
  )
}

