import type { AutoBidItem } from '../types'

export function AutoBidItemsTable({
  items,
  editable,
  onEditItem,
  onAddItem,
}: {
  items: AutoBidItem[]
  editable: boolean
  onEditItem: (item: AutoBidItem) => void
  onAddItem: () => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="text-sm font-semibold text-slate-900">Items</div>
        {editable ? (
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            onClick={onAddItem}
          >
            + Agregar línea
          </button>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-2">Requerimiento</th>
              <th className="px-4 py-2">Tu oferta</th>
              <th className="px-4 py-2">Cantidad</th>
              <th className="px-4 py-2">Unidad</th>
              <th className="px-4 py-2">Precio Unit.</th>
              <th className="px-4 py-2">Subtotal</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((it) => {
              const subtotal = (it.cantidad ?? 0) * (it.precio_unitario ?? 0)
              return (
                <tr key={it.id} className="align-top">
                  <td className="max-w-[360px] px-4 py-2 text-slate-700">{it.requerimiento ?? '—'}</td>
                  <td className="max-w-[360px] px-4 py-2 text-slate-900">
                    <div className="font-medium">{it.nombre_oferta ?? '—'}</div>
                    {it.sku ? <div className="mt-0.5 text-[11px] text-slate-500">SKU: {it.sku}</div> : null}
                  </td>
                  <td className="px-4 py-2 text-slate-900">{it.cantidad ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-700">{it.unidad ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-900">
                    {it.precio_unitario != null ? it.precio_unitario.toLocaleString('es-CL') : '—'}
                  </td>
                  <td className="px-4 py-2 font-semibold text-slate-900">
                    {subtotal ? subtotal.toLocaleString('es-CL') : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {editable ? (
                      <button
                        type="button"
                        className="rounded-md border px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        onClick={() => onEditItem(it)}
                      >
                        Editar
                      </button>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

