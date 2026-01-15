import { useState } from 'react'
import { formatCLP } from '../../../lib/money'
import toast from 'react-hot-toast'
import { recalculateAutoBidTotals, updateAutoBidStatus } from '../../../lib/supabase'
import type { AutoBid, AutoBidItem } from '../types'

const IVA_RATE = 0.19
const LIMITE_100_UTM = 6_954_200 // 100 UTM (CLP) - según requerimiento

export function TotalsSidebar({
  bid,
  items,
  presupuestoTotal,
  onBidChange,
}: {
  bid: AutoBid
  items: AutoBidItem[]
  presupuestoTotal: number | null | undefined
  onBidChange?: (next: AutoBid) => void
}) {
  const neto = items.reduce((acc, it) => acc + (it.cantidad ?? 0) * (it.precio_unitario ?? 0), 0)
  const iva = Math.round(neto * IVA_RATE)
  const total = neto + iva

  const excedePresupuesto =
    typeof presupuestoTotal === 'number' && Number.isFinite(presupuestoTotal) && total > presupuestoTotal
  const supera100Utm = bid.tipo_proceso === 'compra_agil' && total >= LIMITE_100_UTM

  const tieneErrores = Boolean(excedePresupuesto || supera100Utm)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const puedeGuardarBorrador = bid.estado === 'pendiente' || bid.estado === 'borrador'
  const puedeEnviar = (bid.estado === 'pendiente' || bid.estado === 'borrador') && !tieneErrores
  const puedeAnular = bid.estado !== 'anulada'

  return (
    <div className="sticky top-4 space-y-3">
      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Valor total</div>
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-600">Total neto</span>
            <span className="font-semibold text-slate-900">{formatCLP(neto)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-600">IVA (19%)</span>
            <span className="font-semibold text-slate-900">{formatCLP(iva)}</span>
          </div>
          <div className="h-px bg-slate-200" />
          <div className="flex items-center justify-between">
            <span className="text-slate-900">Total</span>
            <span className="text-base font-bold text-slate-900">{formatCLP(total)}</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Alertas</div>
        <ul className="mt-2 space-y-1 text-sm">
          <li className={supera100Utm ? 'text-amber-700' : 'text-slate-500'}>
            {supera100Utm ? 'Supera límite 100 UTM' : 'No supera 100 UTM'}
          </li>
          <li className={excedePresupuesto ? 'text-red-700' : 'text-slate-500'}>
            {excedePresupuesto ? 'Excede presupuesto' : 'Dentro de presupuesto'}
          </li>
        </ul>
        <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
          Recordatorio: enviar 10 min antes del cierre.
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-slate-900">Acciones</div>
        <div className="mt-3 space-y-2">
          <button
            className="w-full rounded-md border px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
            disabled={updatingStatus || !puedeGuardarBorrador}
            onClick={() => {
              setUpdatingStatus(true)
              ;(async () => {
                try {
                  // Recalcula para mantener consistencia DB/UI
                  const updatedTotals = await recalculateAutoBidTotals(bid.id)
                  onBidChange?.(updatedTotals)
                  const updated = await updateAutoBidStatus(bid.id, 'borrador')
                  onBidChange?.(updated)
                  toast.success('Guardado como borrador')
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'No se pudo guardar borrador')
                } finally {
                  setUpdatingStatus(false)
                }
              })()
            }}
          >
            Guardar Borrador
          </button>

          <button
            className="w-full rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            disabled={updatingStatus || !puedeEnviar || bid.estado === 'enviada'}
            onClick={() => {
              if (tieneErrores) {
                toast.error('Corrige las alertas antes de enviar.')
                return
              }
              setUpdatingStatus(true)
              ;(async () => {
                try {
                  const updatedTotals = await recalculateAutoBidTotals(bid.id)
                  onBidChange?.(updatedTotals)
                  const updated = await updateAutoBidStatus(bid.id, 'enviada')
                  onBidChange?.(updated)
                  toast.success('Oferta marcada como enviada')
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'No se pudo enviar la oferta')
                } finally {
                  setUpdatingStatus(false)
                }
              })()
            }}
          >
            Enviar Oferta
          </button>

          <button
            className="w-full rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            disabled={updatingStatus || !puedeAnular}
            onClick={() => {
              const ok = window.confirm('¿Anular esta oferta?')
              if (!ok) return
              setUpdatingStatus(true)
              ;(async () => {
                try {
                  const updated = await updateAutoBidStatus(bid.id, 'anulada')
                  onBidChange?.(updated)
                  toast.success('Oferta anulada')
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'No se pudo anular')
                } finally {
                  setUpdatingStatus(false)
                }
              })()
            }}
          >
            Anular
          </button>
        </div>
      </div>
    </div>
  )
}

