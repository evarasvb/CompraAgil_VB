# 🔧 Solución: Compras Ágiles No Se Muestran

## ❌ Problema Identificado

El scraper guardaba datos en la tabla `licitaciones`, pero el frontend buscaba en `compras_agiles`. **Desconexión de tablas**.

## ✅ Solución Aplicada

### 1. Modificado el Scraper (`scraper.js`)

Agregué la función `upsertComprasAgiles()` que:
- Mapea datos de `licitaciones` a `compras_agiles`
- Se ejecuta automáticamente después de guardar en `licitaciones`
- Sincroniza ambos lados para que el frontend vea los datos

**Cambios:**
- Nueva función `upsertComprasAgiles()` (línea ~374)
- Llamada automática después de `upsertLicitaciones()` (línea ~751)

### 2. Mapeo de Campos

```javascript
licitaciones → compras_agiles
- codigo → codigo
- titulo → nombre
- organismo → organismo
- presupuesto_estimado → monto
- finaliza_el → fecha_cierre
- estado_detallado → estado
- departamento → region
- link_detalle → link_oficial
```

## 📋 Próximos Pasos

### Paso 1: Ejecutar el Scraper

Para que aparezcan compras ágiles nuevas, necesitas ejecutar el scraper:

```bash
cd mercadopublico-scraper
node scraper.js --pages 5
```

O si está configurado en GitHub Actions, espera a que se ejecute automáticamente.

### Paso 2: Ejecutar el Matcher

Para que los productos tengan matches, ejecuta el matcher:

```bash
python run_matcher.py --mode=db --days=1
```

Esto:
- Lee productos de `producto_maestro`
- Lee items sin match de `licitacion_items`
- Calcula matches y actualiza `match_sku`, `costo_unitario`, `margen_estimado`, `confidence_score`

### Paso 3: Verificar en el Frontend

1. Abre la página de Compras Ágiles
2. Deberías ver las compras en la tabla
3. Click en una compra para ver los productos
4. Si hay matches, se mostrarán con scores y costos

## 🔍 Verificación

### En Supabase, verifica que existan datos:

```sql
-- Verificar compras ágiles
SELECT COUNT(*) FROM compras_agiles;

-- Verificar items
SELECT COUNT(*) FROM licitacion_items;

-- Verificar matches
SELECT COUNT(*) FROM licitacion_items WHERE match_sku IS NOT NULL;
```

### En el Frontend:

1. **Tabla de Compras**: Debe mostrar compras con código, nombre, organismo, monto
2. **Click en Compra**: Debe abrir el panel lateral con productos
3. **Productos**: Deben mostrar items solicitados con matches (si existen)

## 🐛 Si Aún No Funciona

### Verificar:
1. ✅ ¿El scraper se ejecutó? (revisa logs)
2. ✅ ¿Hay datos en `compras_agiles`? (consulta SQL)
3. ✅ ¿El frontend está conectado a la misma base de datos?
4. ✅ ¿Hay errores en la consola del navegador?

### Debug:

```bash
# Ver últimas compras guardadas
cd mercadopublico-scraper
node scraper.js --test --pages 1

# Verificar sincronización
# En Supabase SQL Editor:
SELECT 
  l.codigo,
  l.titulo,
  ca.nombre,
  ca.monto
FROM licitaciones l
LEFT JOIN compras_agiles ca ON l.codigo = ca.codigo
ORDER BY l.fecha_extraccion DESC
LIMIT 10;
```

## 📝 Notas

- El scraper ahora guarda en **ambas tablas** automáticamente
- Si falla la sincronización a `compras_agiles`, el scraper continúa (solo muestra warning)
- Los datos en `licitaciones` siempre se guardan primero
- El frontend lee de `compras_agiles` para mejor rendimiento
