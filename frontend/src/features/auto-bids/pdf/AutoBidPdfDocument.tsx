import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { AutoBid, AutoBidItem } from '../types'

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 10 },
  h1: { fontSize: 14, marginBottom: 8 },
  section: { marginBottom: 10 },
  row: { flexDirection: 'row' },
  th: { fontSize: 9, fontWeight: 700, padding: 4, borderBottom: '1px solid #ccc' },
  td: { padding: 4, borderBottom: '1px solid #eee' },
  colReq: { width: '50%' },
  colSku: { width: '15%' },
  colQty: { width: '10%' },
  colUnit: { width: '10%' },
  colPrice: { width: '15%', textAlign: 'right' },
})

export function AutoBidPdfDocument({
  bid,
  items,
}: {
  bid: AutoBid
  items: AutoBidItem[]
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Oferta Automática - {bid.codigo_proceso}</Text>

        <View style={styles.section}>
          <Text>Comprador: {bid.organismo ?? '—'}</Text>
          <Text>Unidad: {bid.unidad_compra ?? '—'}</Text>
          <Text>Presupuesto: {bid.presupuesto_total ?? 0}</Text>
          <Text>Cierre: {bid.fecha_cierre ? new Date(bid.fecha_cierre).toLocaleString('es-CL') : '—'}</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={[styles.th, styles.colReq]}>Producto</Text>
            <Text style={[styles.th, styles.colSku]}>SKU</Text>
            <Text style={[styles.th, styles.colQty]}>Cant.</Text>
            <Text style={[styles.th, styles.colUnit]}>Unidad</Text>
            <Text style={[styles.th, styles.colPrice]}>Precio Unit.</Text>
          </View>
          {items.map((it) => (
            <View key={it.id} style={styles.row}>
              <Text style={[styles.td, styles.colReq]}>{it.nombre_oferta ?? it.requerimiento ?? '—'}</Text>
              <Text style={[styles.td, styles.colSku]}>{it.sku ?? '—'}</Text>
              <Text style={[styles.td, styles.colQty]}>{String(it.cantidad ?? '')}</Text>
              <Text style={[styles.td, styles.colUnit]}>{it.unidad ?? '—'}</Text>
              <Text style={[styles.td, styles.colPrice]}>{String(it.precio_unitario ?? '')}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text>Proveedor: (pendiente)</Text>
          <Text>RUT / Dirección / Web: (pendiente)</Text>
          <Text>Contacto / Plazo entrega: (pendiente)</Text>
        </View>
      </Page>
    </Document>
  )
}

