# 🚀 Aplicar Migraciones SQL Automáticamente

## ✅ **Script SQL Completo Creado**

He creado el archivo `APLICAR_MIGRACIONES.sql` que contiene **ambas migraciones** listas para ejecutar.

---

## 📋 **Opción 1: Aplicar desde Supabase Dashboard (Recomendado)**

### **Paso 1: Abrir Supabase Dashboard**
1. Ve a: https://app.supabase.com
2. Selecciona tu proyecto: `euzqadopjvdszcdjegmo`

### **Paso 2: Abrir SQL Editor**
1. En el menú lateral, click en **"SQL Editor"**
2. Click en **"New query"**

### **Paso 3: Copiar y Ejecutar**
1. Abre el archivo: `mercadopublico-scraper/agile-bidder/APLICAR_MIGRACIONES.sql`
2. Copia **todo el contenido**
3. Pégalo en el SQL Editor de Supabase
4. Click en **"Run"** o presiona `Ctrl+Enter` (o `Cmd+Enter` en Mac)

### **Paso 4: Verificar**
Deberías ver mensajes de éxito como:
- ✅ "Success. No rows returned"
- ✅ "CREATE VIEW"
- ✅ "CREATE FUNCTION"
- ✅ "CREATE TABLE"

---

## 📋 **Opción 2: Aplicar con Supabase CLI (Si está instalado)**

```bash
cd mercadopublico-scraper/agile-bidder

# Si tienes Supabase CLI configurado
supabase db push

# O aplicar migración específica
supabase migration up
```

---

## ✅ **Qué se Aplica:**

### **Migración 1: Limpiar datos de prueba**
- ✅ Vista `compras_agiles_sospechosas`
- ✅ Vista `compras_agiles_sin_productos`
- ✅ Función `revisar_datos_prueba_compras_agiles()`
- ✅ Función `estadisticas_compras_agiles()`

### **Migración 2: Órdenes de compra**
- ✅ Tabla `ordenes_compra`
- ✅ Tabla `orden_compra_items`
- ✅ Índices para búsquedas rápidas
- ✅ Políticas RLS
- ✅ Trigger para `updated_at`

---

## 🔍 **Verificar que se Aplicó Correctamente:**

### **En Supabase SQL Editor, ejecuta:**

```sql
-- Verificar que las tablas existen
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('ordenes_compra', 'orden_compra_items');

-- Verificar que las funciones existen
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name IN ('estadisticas_compras_agiles', 'revisar_datos_prueba_compras_agiles');

-- Probar función de estadísticas
SELECT * FROM estadisticas_compras_agiles();
```

**Si todo está bien, deberías ver:**
- ✅ 2 tablas listadas
- ✅ 2 funciones listadas
- ✅ Estadísticas de compras ágiles

---

## ⚠️ **Si hay Errores:**

### **Error: "relation already exists"**
- ✅ **Normal:** Significa que la tabla/función ya existe
- ✅ **Solución:** Puedes ignorar el error o usar `CREATE OR REPLACE`

### **Error: "permission denied"**
- ⚠️ **Problema:** No tienes permisos de administrador
- ✅ **Solución:** Usa una cuenta con permisos de admin en Supabase

### **Error: "syntax error"**
- ⚠️ **Problema:** Puede haber un error de sintaxis
- ✅ **Solución:** Revisa el mensaje de error y corrige la línea indicada

---

## ✅ **Después de Aplicar:**

1. ✅ **Verificar tablas:** Deberías ver `ordenes_compra` y `orden_compra_items` en la lista de tablas
2. ✅ **Probar funciones:** Ejecuta `SELECT * FROM estadisticas_compras_agiles();`
3. ✅ **Probar página:** Abre `/ordenes-compra` en la aplicación

---

**Estado:** ✅ **Script SQL listo para aplicar**  
**Tiempo estimado:** 2-3 minutos  
**Dificultad:** Fácil (solo copiar y pegar)
