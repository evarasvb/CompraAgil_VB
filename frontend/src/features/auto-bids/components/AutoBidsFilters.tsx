export type AutoBidsFiltersValue = {
  tipo: 'todos' | 'compra_agil' | 'licitacion'
  convocatoria: 'todas' | 'primer_llamado' | 'segundo_llamado'
  organismo: string
  montoMin: string
  montoMax: string
  regionComuna: string
  orden: 'cierre_asc' | 'creacion_desc'
}

export function AutoBidsFilters({
  value,
  onChange,
}: {
  value: AutoBidsFiltersValue
  onChange: (next: AutoBidsFiltersValue) => void
}) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-6">
        <label className="block text-xs">
          <div className="mb-1 text-slate-600">Tipo</div>
          <select
            className="w-full rounded-md border px-2 py-1.5"
            value={value.tipo}
            onChange={(e) => onChange({ ...value, tipo: e.target.value as AutoBidsFiltersValue['tipo'] })}
          >
            <option value="todos">Todos</option>
            <option value="compra_agil">Compra Ágil</option>
            <option value="licitacion">Licitación</option>
          </select>
        </label>

        <label className="block text-xs">
          <div className="mb-1 text-slate-600">Convocatoria</div>
          <select
            className="w-full rounded-md border px-2 py-1.5"
            value={value.convocatoria}
            onChange={(e) =>
              onChange({ ...value, convocatoria: e.target.value as AutoBidsFiltersValue['convocatoria'] })
            }
          >
            <option value="todas">Todas</option>
            <option value="primer_llamado">1er llamado</option>
            <option value="segundo_llamado">2do llamado</option>
          </select>
        </label>

        <label className="block text-xs md:col-span-2">
          <div className="mb-1 text-slate-600">Organismo</div>
          <input
            className="w-full rounded-md border px-2 py-1.5"
            placeholder="Buscar institución…"
            value={value.organismo}
            onChange={(e) => onChange({ ...value, organismo: e.target.value })}
          />
        </label>

        <label className="block text-xs">
          <div className="mb-1 text-slate-600">Monto min</div>
          <input
            className="w-full rounded-md border px-2 py-1.5"
            inputMode="numeric"
            placeholder="0"
            value={value.montoMin}
            onChange={(e) => onChange({ ...value, montoMin: e.target.value })}
          />
        </label>

        <label className="block text-xs">
          <div className="mb-1 text-slate-600">Monto max</div>
          <input
            className="w-full rounded-md border px-2 py-1.5"
            inputMode="numeric"
            placeholder="∞"
            value={value.montoMax}
            onChange={(e) => onChange({ ...value, montoMax: e.target.value })}
          />
        </label>

        <label className="block text-xs md:col-span-3">
          <div className="mb-1 text-slate-600">Región / Comuna</div>
          <input
            className="w-full rounded-md border px-2 py-1.5"
            placeholder="Ej: Metropolitana / Santiago"
            value={value.regionComuna}
            onChange={(e) => onChange({ ...value, regionComuna: e.target.value })}
          />
        </label>

        <label className="block text-xs md:col-span-3">
          <div className="mb-1 text-slate-600">Ordenamiento</div>
          <select
            className="w-full rounded-md border px-2 py-1.5"
            value={value.orden}
            onChange={(e) => onChange({ ...value, orden: e.target.value as AutoBidsFiltersValue['orden'] })}
          >
            <option value="cierre_asc">Próximos a cerrar</option>
            <option value="creacion_desc">Más recientes</option>
          </select>
        </label>
      </div>
    </div>
  )
}

