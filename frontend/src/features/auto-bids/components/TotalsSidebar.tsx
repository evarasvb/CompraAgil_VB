import { formatCLP } from '../../../lib/money'
import type { AutoBidItem } from '../types'

const IVA_RATE = 0.19
// Aproximación (solo UI placeholder). Ideal: traer UTM vigente desde backend/config.
const UTM_CLP = 65000
const LIMITE_100_UTM = 100 * UTM_CLP

export function TotalsSidebar({
  items,
  presupuestoTotal,
}: {
  items: AutoBidItem[]
  presupuestoTotal: number | null | undefined
}) {
  const neto = items.reduce((acc, it) => acc + (it.cantidad ?? 0) * (it.precio_unitario ?? 0), 0)
  const iva = Math.round(neto * IVA_RATE)
  const total = neto + iva

  const excedePresupuesto =
    typeof presupuestoTotal === 'number' && Number.isFinite(presupuestoTotal) && total > presupuestoTotal
  const supera100Utm = total >= LIMITE_100_UTM

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
    </div>
  )
}

