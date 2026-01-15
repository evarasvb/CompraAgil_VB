import { useState } from 'react'
import toast from 'react-hot-toast'
import type { AutoBidItem } from '../types'
import { uploadProductImage, uploadTechnicalSheet, updateAutoBidItem } from '../../../lib/supabase'

export function EditItemModal({
  open,
  item,
  onClose,
  onSave,
  onPatch,
  onDelete,
  saving,
  deleting,
}: {
  open: boolean
  item: AutoBidItem | null
  onClose: () => void
  onSave: (next: AutoBidItem) => void
  onPatch?: (next: AutoBidItem) => void
  onDelete?: (item: AutoBidItem) => void
  saving?: boolean
  deleting?: boolean
}) {
  const [nombre, setNombre] = useState(() => item?.nombre_oferta ?? '')
  const [precio, setPrecio] = useState(() => (item?.precio_unitario != null ? String(item.precio_unitario) : ''))
  const [sku, setSku] = useState(() => item?.sku ?? '')
  const [proveedor, setProveedor] = useState(() => item?.proveedor ?? '')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadingPdf, setUploadingPdf] = useState(false)

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
                <input
                  className="mt-2 w-full text-xs"
                  type="file"
                  accept="image/*"
                  disabled={uploadingImage || uploadingPdf || Boolean(saving) || Boolean(deleting)}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setUploadingImage(true)
                    ;(async () => {
                      try {
                        const url = await uploadProductImage(file, item.id)
                        const updated = await updateAutoBidItem(item.id, { imagen_url: url })
                        onPatch?.(updated)
                        toast.success('Imagen subida')
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'No se pudo subir la imagen')
                      } finally {
                        setUploadingImage(false)
                        e.target.value = ''
                      }
                    })()
                  }}
                />
                {uploadingImage ? <div className="mt-2 text-[11px] text-slate-500">Subiendo…</div> : null}
                {item.imagen_url ? (
                  <a
                    className="mt-2 block text-[11px] font-semibold text-slate-700 underline"
                    href={item.imagen_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver imagen actual
                  </a>
                ) : null}
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs text-slate-600">Ficha técnica (PDF)</div>
              <div className="rounded-md border border-dashed p-4 text-xs text-slate-600">
                <div className="font-medium text-slate-900">Subir PDF</div>
                <input
                  className="mt-2 w-full text-xs"
                  type="file"
                  accept="application/pdf"
                  disabled={uploadingImage || uploadingPdf || Boolean(saving) || Boolean(deleting)}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setUploadingPdf(true)
                    ;(async () => {
                      try {
                        const url = await uploadTechnicalSheet(file, item.id)
                        const updated = await updateAutoBidItem(item.id, { ficha_tecnica_url: url })
                        onPatch?.(updated)
                        toast.success('PDF subido')
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'No se pudo subir el PDF')
                      } finally {
                        setUploadingPdf(false)
                        e.target.value = ''
                      }
                    })()
                  }}
                />
                {uploadingPdf ? <div className="mt-2 text-[11px] text-slate-500">Subiendo…</div> : null}
                {item.ficha_tecnica_url ? (
                  <a
                    className="mt-2 block text-[11px] font-semibold text-slate-700 underline"
                    href={item.ficha_tecnica_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver ficha técnica actual
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          {onDelete ? (
            <button
              className="mr-auto rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              disabled={Boolean(deleting) || Boolean(saving)}
              onClick={() => onDelete(item)}
            >
              {deleting ? 'Eliminando…' : 'Eliminar'}
            </button>
          ) : null}
          <button className="rounded-md border px-3 py-2 text-xs font-semibold" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            disabled={Boolean(saving) || Boolean(deleting)}
            onClick={() => {
              const n = precio.trim() ? Number(precio) : null
              onSave({
                ...item,
                nombre_oferta: nombre || null,
                sku: sku || null,
                proveedor: proveedor || null,
                precio_unitario: n != null && Number.isFinite(n) ? n : null,
              })
            }}
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

