# 🔍 Verificar y Limpiar Compras Ágiles

## 🎯 **Objetivo:**

1. ✅ Verificar que las compras ágiles estén almacenadas correctamente
2. ✅ Eliminar datos de prueba/inventados
3. ✅ Asegurar que cada compra ágil tenga productos asociados con cantidades

---

## 📊 **Paso 1: Verificar Estado Actual**

### **Ejecutar en Supabase SQL Editor:**

```sql
-- Ver estadísticas generales
SELECT * FROM estadisticas_compras_agiles();

-- Ver compras sospechosas o sin productos
SELECT * FROM revisar_datos_prueba_compras_agiles();
```

**Esto te mostrará:**
- Total de compras ágiles
- Cuántas tienen productos
- Cuántas no tienen productos
- Cuántas parecen ser de prueba
- Promedio de productos por compra

---

## 🧹 **Paso 2: Revisar Datos Sospechosos**

### **Ver compras que parecen de prueba:**

```sql
-- Ver todas las compras sospechosas
SELECT * FROM compras_agiles_sospechosas
ORDER BY created_at DESC;
```

**Criterios para identificar datos de prueba:**
- ✅ Códigos que no siguen formato estándar
- ✅ Nombres con palabras: "test", "prueba", "ejemplo", "dummy", "sample", "demo"
- ✅ Organismos genéricos o "Organismo no especificado"
- ✅ Sin productos asociados por más de 30 días

---

## 🗑️ **Paso 3: Eliminar Datos de Prueba (CUIDADO)**

### **⚠️ IMPORTANTE: Revisar manualmente antes de eliminar**

```sql
-- 1. PRIMERO: Ver qué se va a eliminar
SELECT 
  ca.id,
  ca.codigo,
  ca.nombre,
  ca.organismo,
  ca.created_at,
  COUNT(li.id) as num_items
FROM public.compras_agiles ca
LEFT JOIN public.licitacion_items li ON li.licitacion_codigo = ca.codigo
WHERE 
  -- Códigos que no parecen reales
  (ca.codigo !~ '^[0-9]+$' AND ca.codigo !~ '^[A-Z0-9-]+$')
  -- O nombres genéricos
  OR LOWER(ca.nombre) LIKE '%test%'
  OR LOWER(ca.nombre) LIKE '%prueba%'
  OR LOWER(ca.nombre) LIKE '%ejemplo%'
  OR LOWER(ca.nombre) LIKE '%dummy%'
  OR LOWER(ca.nombre) LIKE '%sample%'
  OR LOWER(ca.nombre) LIKE '%demo%'
  -- O organismos genéricos
  OR LOWER(ca.organismo) LIKE '%test%'
  OR LOWER(ca.organismo) LIKE '%prueba%'
  OR LOWER(ca.organismo) LIKE '%ejemplo%'
  OR ca.organismo = 'Organismo no especificado'
  -- O sin productos por más de 30 días
  OR (COUNT(li.id) = 0 AND ca.created_at < NOW() - INTERVAL '30 days')
GROUP BY ca.id, ca.codigo, ca.nombre, ca.organismo, ca.created_at
ORDER BY ca.created_at DESC;

-- 2. Si estás seguro, eliminar compras de prueba (CUIDADO)
-- Primero eliminar los items asociados
DELETE FROM public.licitacion_items
WHERE licitacion_codigo IN (
  SELECT codigo FROM public.compras_agiles
  WHERE 
    (codigo !~ '^[0-9]+$' AND codigo !~ '^[A-Z0-9-]+$')
    OR LOWER(nombre) LIKE '%test%'
    OR LOWER(nombre) LIKE '%prueba%'
    OR LOWER(nombre) LIKE '%ejemplo%'
    OR LOWER(nombre) LIKE '%dummy%'
    OR LOWER(nombre) LIKE '%sample%'
    OR LOWER(nombre) LIKE '%demo%'
    OR LOWER(organismo) LIKE '%test%'
    OR LOWER(organismo) LIKE '%prueba%'
    OR LOWER(organismo) LIKE '%ejemplo%'
    OR organismo = 'Organismo no especificado'
);

-- Luego eliminar las compras
DELETE FROM public.compras_agiles
WHERE 
  (codigo !~ '^[0-9]+$' AND codigo !~ '^[A-Z0-9-]+$')
  OR LOWER(nombre) LIKE '%test%'
  OR LOWER(nombre) LIKE '%prueba%'
  OR LOWER(nombre) LIKE '%ejemplo%'
  OR LOWER(nombre) LIKE '%dummy%'
  OR LOWER(nombre) LIKE '%sample%'
  OR LOWER(nombre) LIKE '%demo%'
  OR LOWER(organismo) LIKE '%test%'
  OR LOWER(organismo) LIKE '%prueba%'
  OR LOWER(organismo) LIKE '%ejemplo%'
  OR organismo = 'Organismo no especificado';
```

---

## ✅ **Paso 4: Verificar Compras sin Productos**

### **Ver compras que no tienen productos asociados:**

```sql
-- Compras sin productos (más de 7 días)
SELECT 
  ca.id,
  ca.codigo,
  ca.nombre,
  ca.organismo,
  ca.created_at,
  ca.fecha_cierre,
  COUNT(li.id) as num_items
FROM public.compras_agiles ca
LEFT JOIN public.licitacion_items li ON li.licitacion_codigo = ca.codigo
GROUP BY ca.id, ca.codigo, ca.nombre, ca.organismo, ca.created_at, ca.fecha_cierre
HAVING COUNT(li.id) = 0
  AND ca.created_at < NOW() - INTERVAL '7 days'
ORDER BY ca.created_at DESC;
```

**Si hay compras sin productos:**
- Pueden estar en proceso de scraping
- Pueden ser compras que no tienen productos listados en MercadoPúblico
- Si tienen más de 7 días sin productos, probablemente no los tendrán

---

## 📋 **Paso 5: Verificar Compras con Productos Completos**

### **Ver compras que tienen productos con información completa:**

```sql
-- Compras con productos y sus detalles
SELECT 
  ca.codigo,
  ca.nombre,
  ca.organismo,
  ca.monto_estimado,
  ca.fecha_cierre,
  COUNT(li.id) as num_items,
  COUNT(CASE WHEN li.cantidad IS NOT NULL AND li.cantidad != '' THEN 1 END) as items_con_cantidad,
  COUNT(CASE WHEN li.nombre_producto IS NOT NULL AND li.nombre_producto != '' THEN 1 END) as items_con_nombre,
  COUNT(CASE WHEN li.unidad IS NOT NULL AND li.unidad != '' THEN 1 END) as items_con_unidad
FROM public.compras_agiles ca
INNER JOIN public.licitacion_items li ON li.licitacion_codigo = ca.codigo
GROUP BY ca.codigo, ca.nombre, ca.organismo, ca.monto_estimado, ca.fecha_cierre
HAVING COUNT(li.id) > 0
ORDER BY ca.fecha_cierre DESC
LIMIT 50;
```

**Esto te mostrará:**
- ✅ Compras que tienen productos
- ✅ Cuántos productos tienen cantidad
- ✅ Cuántos productos tienen nombre
- ✅ Cuántos productos tienen unidad de medida

---

## 🔧 **Paso 6: Asegurar que Todas las Compras Tengan Productos**

### **Si hay compras sin productos, puedes:**

1. **Re-ejecutar el scraper** para esas compras específicas
2. **Eliminar compras sin productos** si tienen más de 7 días
3. **Marcar compras sin productos** para revisión manual

```sql
-- Marcar compras sin productos para revisión
UPDATE public.compras_agiles
SET estado = 'sin_productos'
WHERE codigo IN (
  SELECT ca.codigo
  FROM public.compras_agiles ca
  LEFT JOIN public.licitacion_items li ON li.licitacion_codigo = ca.codigo
  GROUP BY ca.codigo
  HAVING COUNT(li.id) = 0
    AND ca.created_at < NOW() - INTERVAL '7 days'
);
```

---

## 📊 **Resumen de Verificación**

### **Checklist:**

- [ ] ✅ Ejecutar `estadisticas_compras_agiles()` para ver estado general
- [ ] ✅ Revisar `revisar_datos_prueba_compras_agiles()` para ver datos sospechosos
- [ ] ✅ Verificar compras sin productos
- [ ] ✅ Eliminar datos de prueba (después de revisar manualmente)
- [ ] ✅ Verificar que compras reales tengan productos con cantidades
- [ ] ✅ Re-ejecutar scraper si faltan productos

---

## 🚀 **Próximos Pasos**

1. **Ejecutar la migración SQL** para crear las funciones de verificación
2. **Revisar los datos** usando las funciones creadas
3. **Eliminar datos de prueba** después de verificar manualmente
4. **Re-ejecutar scraper** si faltan productos en compras reales

---

**Nota:** Las funciones creadas son de solo lectura (excepto las de DELETE que debes ejecutar manualmente). Revisa siempre antes de eliminar datos.
