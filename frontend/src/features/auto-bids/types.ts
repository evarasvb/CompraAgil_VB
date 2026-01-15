export type AutoBidStatus = 'abierta' | 'pendiente' | 'borrador' | 'enviada' | 'anulada'

export type AutoBid = {
  id: string
  tipo_proceso: 'compra_agil' | 'licitacion'
  codigo_proceso: string
  titulo: string | null
  organismo: string | null
  rut_institucion: string | null
  departamento: string | null
  unidad_compra: string | null
  descripcion: string | null
  convocatoria: 'primer_llamado' | 'segundo_llamado' | null
  fecha_publicacion: string | null
  fecha_cierre: string | null
  presupuesto_total: number | null
  moneda: string | null
  estado: AutoBidStatus
  total_neto: number | null
  iva: number | null
  total: number | null
  created_at: string
  updated_at: string
}

export type AutoBidDashboardRow = AutoBid & {
  total_items: number
  items_emparejados: number
  match_percent: number
}

export type AutoBidItem = {
  id: string
  auto_bid_id: string
  item_index: number
  requerimiento: string | null
  inventario_producto_id: string | null
  match_confidence: number | null
  match_method: string | null
  nombre_oferta: string | null
  sku: string | null
  proveedor: string | null
  cantidad: number | null
  unidad: string | null
  precio_unitario: number | null
  imagen_url: string | null
  ficha_tecnica_url: string | null
  notas: string | null
}

export type ConductaPago = {
  id: string
  rut_institucion: string | null
  institucion: string | null
  unidad_compra: string | null
  periodo: string
  dias_promedio_pago: number | null
  porcentaje_morosidad: number | null
  muestras: number | null
}

