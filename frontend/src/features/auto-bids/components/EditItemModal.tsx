import { useEffect, useMemo, useState } from 'react'
import type { AutoBidItem } from '../types'

export function EditItemModal({
  open,
  item,
  onClose,
  onSave,
}: {
  open: boolean
  item: AutoBidItem | null
  onClose: () => void
  onSave: (next: AutoBidItem) => void
}) {
  const [nombre, setNombre] = useState('')
  const [precio, setPrecio] = useState('')
  const [sku, setSku] = useState('')
  const [proveedor, setProveedor] = useState('')

  useEffect(() => {
    if (!item) return
    setNombre(item.nombre_oferta ?? '')
    setPrecio(item.precio_unitario != null ? String(item.precio_unitario) : '')
    setSku(item.sku ?? '')
    setProveedor(item.proveedor ?? '')
  }, [item])

  const canSave = useMemo(() => Boolean(item), [item])

  if (!open || !item) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold text-slate-900">Editar item</div>
          <button className="rounded-md border px-2 py-1 text-xs font-semibold" onClick={onClose}>
            Cerrar
          </button>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs text-slate-600">Nombre</div>
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>

            <div>
              <div className="mb-1 text-xs text-slate-600">Precio</div>
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                inputMode="decimal"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 text-xs text-slate-600">SKU</div>
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                />
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-600">Proveedor</div>
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={proveedor}
                  onChange={(e) => setProveedor(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs text-slate-600">Imagen del producto</div>
              <div className="rounded-md border border-dashed p-4 text-xs text-slate-600">
                <div className="font-medium text-slate-900">Arrastra y suelta</div>
                <div className="mt-1">o selecciona un archivo</div>
                <input className="mt-2 w-full text-xs" type="file" accept="image/*" />
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs text-slate-600">Ficha técnica (PDF)</div>
              <div className="rounded-md border border-dashed p-4 text-xs text-slate-600">
                <div className="font-medium text-slate-900">Subir PDF</div>
                <input className="mt-2 w-full text-xs" type="file" accept="application/pdf" />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <button className="rounded-md border px-3 py-2 text-xs font-semibold" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            disabled={!canSave}
            onClick={() => {
              const n = precio.trim() ? Number(precio) : null
              onSave({
                ...item,
                nombre_oferta: nombre || null,
                sku: sku || null,
                proveedor: proveedor || null,
                precio_unitario: n != null && Number.isFinite(n) ? n : null,
              })
              onClose()
            }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

