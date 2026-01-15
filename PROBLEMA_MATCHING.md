# Problema Identificado: Matching contra Listado de Productos

## Problema Actual

1. **El scraper SÍ extrae el listado de productos solicitados** de cada compra ágil desde la página de detalle (`/ficha?code=...`)
   - Guarda cada producto en `licitacion_items` con: `nombre`, `descripcion`, `cantidad`, `unidad`

2. **El matcher_db_adapter SÍ procesa esos items** desde `licitacion_items` donde `match_sku IS NULL`

3. **PERO el frontend NO está usando ese listado**:
   - `MatchPanel.tsx` usa `useMatchInventario(compra?.nombre || null)` 
   - Solo hace match contra el NOMBRE de la compra, no contra cada producto del listado
   - No muestra el listado de productos solicitados por la institución

## Solución Requerida

### 1. Mejorar el Matching en el Backend (✅ Ya corregido)
- Combinar `nombre + descripcion` para mejor matching
- El matcher_db_adapter ahora usa: `TRIM(CONCAT(nombre, ' ', descripcion))`

### 2. Crear Hook para Obtener Items de Compra Ágil
Necesitamos un hook que:
- Obtenga los items de `licitacion_items` para una compra específica
- Muestre el listado de productos solicitados por la institución
- Use los matches ya calculados por `matcher_db_adapter`

### 3. Actualizar el Frontend
- Mostrar el listado de productos solicitados (nombre, descripción, cantidad, unidad)
- Mostrar el match encontrado para cada producto (SKU, precio, margen, confidence_score)
- Permitir generar propuesta basada en los matches de cada producto

## Comparación con Competencia (lici.cl)

Según la investigación:
- Lici carga el catálogo del proveedor
- Hace matching automático contra cada producto solicitado en compras ágiles
- Notifica en tiempo real cuando hay matches
- Permite generar cotizaciones rápidamente

Nosotros necesitamos:
- ✅ Ya tenemos el scraper extrayendo productos
- ✅ Ya tenemos el matcher procesando items
- ❌ Falta conectar el frontend con los resultados del matching
- ❌ Falta mostrar el listado de productos solicitados

## Próximos Pasos

1. Crear hook `useLicitacionItems(compraCodigo)` para obtener productos solicitados
2. Crear hook `useMatchesPorItem(itemId)` para obtener matches ya calculados
3. Actualizar `MatchPanel.tsx` para mostrar:
   - Listado de productos solicitados
   - Match encontrado para cada uno
   - Opción de generar propuesta completa
