import { useEffect, useMemo, useState } from 'react'
import { requireSupabase } from '../../../lib/supabase'
import { formatCLP } from '../../../lib/money'
import { AutoBidCard } from '../components/AutoBidCard'
import { AutoBidsFilters, type AutoBidsFiltersValue } from '../components/AutoBidsFilters'
import type { AutoBidDashboardRow } from '../types'

const defaultFilters: AutoBidsFiltersValue = {
  tipo: 'todos',
  convocatoria: 'todas',
  organismo: '',
  montoMin: '',
  montoMax: '',
  regionComuna: '',
  orden: 'cierre_asc',
}

export function AutoBidsDashboardPage() {
  const [filters, setFilters] = useState<AutoBidsFiltersValue>(defaultFilters)
  const [rows, setRows] = useState<AutoBidDashboardRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setError(null)

      let supabase
      try {
        supabase = requireSupabase()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error de configuración Supabase')
        setRows([])
        return
      }

      const { data, error } = await supabase
        .from('auto_bids_dashboard')
        .select('*')
        .limit(200)

      if (cancelled) return

      if (error) {
        setError(error.message)
        setRows([])
        return
      }

      setRows((data as AutoBidDashboardRow[]) ?? [])
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const list = rows ?? []

    const min = filters.montoMin ? Number(filters.montoMin) : null
    const max = filters.montoMax ? Number(filters.montoMax) : null

    const by = list.filter((r) => {
      if (filters.tipo !== 'todos' && r.tipo_proceso !== filters.tipo) return false
      if (filters.convocatoria !== 'todas' && (r.convocatoria ?? '') !== filters.convocatoria) return false
      if (filters.organismo.trim()) {
        const q = filters.organismo.trim().toLowerCase()
        if (!(r.organismo ?? '').toLowerCase().includes(q)) return false
      }
      if (min !== null && Number.isFinite(min) && (r.presupuesto_total ?? 0) < min) return false
      if (max !== null && Number.isFinite(max) && (r.presupuesto_total ?? 0) > max) return false
      return true
    })

    const sorted = [...by].sort((a, b) => {
      if (filters.orden === 'creacion_desc') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
      const ta = a.fecha_cierre ? new Date(a.fecha_cierre).getTime() : Number.POSITIVE_INFINITY
      const tb = b.fecha_cierre ? new Date(b.fecha_cierre).getTime() : Number.POSITIVE_INFINITY
      return ta - tb
    })

    return sorted
  }, [filters, rows])

  const metrics = useMemo(() => {
    const totalOfertas = filtered.length
    const presupuestoAcumulado = filtered.reduce((acc, r) => acc + (r.presupuesto_total ?? 0), 0)
    return { totalOfertas, presupuestoAcumulado }
  }, [filtered])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Ofertas Automáticas</h1>
          <div className="mt-1 text-sm text-slate-600">
            Total ofertas: <span className="font-semibold text-slate-900">{metrics.totalOfertas}</span> · Presupuesto:{' '}
            <span className="font-semibold text-slate-900">{formatCLP(metrics.presupuestoAcumulado)}</span>
          </div>
        </div>
      </div>

      <AutoBidsFilters value={filters} onChange={setFilters} />

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Error al cargar desde Supabase: <span className="font-mono">{error}</span>.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((r) => (
          <AutoBidCard key={r.id} bid={r} />
        ))}
      </div>
    </div>
  )
}

