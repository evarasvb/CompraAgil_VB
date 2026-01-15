import { Link } from 'react-router-dom'
import { formatCLP } from '../../../lib/money'
import type { AutoBidDashboardRow } from '../types'
import { MatchProgressBar } from './MatchProgressBar'

function hoursUntil(dateIso: string | null | undefined) {
  if (!dateIso) return null
  const t = new Date(dateIso).getTime()
  if (!Number.isFinite(t)) return null
  return (t - Date.now()) / 36e5
}

export function AutoBidCard({ bid }: { bid: AutoBidDashboardRow }) {
  const hrs = hoursUntil(bid.fecha_cierre)
  const urgent = typeof hrs === 'number' && hrs > 0 && hrs < 24

  return (
    <Link
      to={`/auto-bids/${bid.id}`}
      className="block rounded-lg border bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500">{bid.codigo_proceso}</div>
          <div className="mt-1 line-clamp-2 text-sm font-semibold text-slate-900">
            {bid.titulo ?? 'Sin título'}
          </div>
          <div className="mt-1 text-xs text-slate-600">{bid.organismo ?? '—'}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-slate-500">Estado</div>
          <div className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
            {bid.estado}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <MatchProgressBar
          percent={bid.match_percent ?? 0}
          label={`${bid.items_emparejados}/${bid.total_items} items`}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-slate-500">Presupuesto</div>
          <div className="mt-0.5 font-semibold text-slate-900">
            {formatCLP(bid.presupuesto_total ?? 0)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Monto ofertado</div>
          <div className="mt-0.5 font-semibold text-slate-900">{formatCLP(bid.total ?? 0)}</div>
        </div>
        <div>
          <div className="text-slate-500">Cierre</div>
          <div className={`mt-0.5 font-semibold ${urgent ? 'text-red-600' : 'text-slate-900'}`}>
            {bid.fecha_cierre ? new Date(bid.fecha_cierre).toLocaleString('es-CL') : '—'}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Creación</div>
          <div className="mt-0.5 font-semibold text-slate-900">
            {bid.created_at ? new Date(bid.created_at).toLocaleString('es-CL') : '—'}
          </div>
        </div>
      </div>
    </Link>
  )
}

