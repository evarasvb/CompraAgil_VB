# 🚀 Cómo Aplicar Migraciones SQL - Método Automático

## ✅ **Opción 1: Desde la Aplicación (Más Fácil)**

### **Paso 1: Abrir la Página de Usuarios**
1. Inicia sesión en la aplicación
2. Ve a **"Usuarios"** en el menú lateral
3. En la parte superior, verás el botón **"Aplicar Migraciones SQL"**

### **Paso 2: Aplicar Migraciones**
1. Click en **"Aplicar Migraciones SQL"**
2. Click en **"Aplicar Migraciones Automáticamente"**
3. Si funciona: ✅ Verás mensaje de éxito
4. Si no funciona: Se mostrará el SQL para copiar

### **Paso 3: Si Necesitas Ejecutar Manualmente**
1. Se mostrará el SQL completo
2. Click en **"Copiar SQL"**
3. Click en **"Abrir SQL Editor"** (se abre Supabase)
4. Pega el SQL y ejecuta

---

## ✅ **Opción 2: Desde Supabase Dashboard (Directo)**

### **Paso 1: Abrir Supabase**
1. Ve a: https://app.supabase.com
2. Selecciona tu proyecto

### **Paso 2: Abrir SQL Editor**
1. Click en **"SQL Editor"** en el menú lateral
2. Click en **"New query"**

### **Paso 3: Copiar y Ejecutar**
1. Abre el archivo: `mercadopublico-scraper/agile-bidder/APLICAR_MIGRACIONES.sql`
2. Copia **todo el contenido** (Ctrl+A, Ctrl+C)
3. Pégalo en el SQL Editor de Supabase
4. Click en **"Run"** o presiona `Ctrl+Enter`

### **Paso 4: Verificar**
Deberías ver mensajes como:
- ✅ "Success. No rows returned"
- ✅ "CREATE VIEW"
- ✅ "CREATE FUNCTION"
- ✅ "CREATE TABLE"

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

## 🔍 **Verificar que se Aplicó:**

### **En Supabase SQL Editor, ejecuta:**

```sql
-- Verificar tablas
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('ordenes_compra', 'orden_compra_items');

-- Verificar funciones
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name IN ('estadisticas_compras_agiles', 'revisar_datos_prueba_compras_agiles');

-- Probar función
SELECT * FROM estadisticas_compras_agiles();
```

**Si todo está bien, verás:**
- ✅ 2 tablas listadas
- ✅ 2 funciones listadas
- ✅ Estadísticas de compras ágiles

---

## ⚠️ **Si hay Errores:**

### **Error: "relation already exists"**
- ✅ **Normal:** Significa que ya existe
- ✅ **Solución:** Puedes ignorar el error

### **Error: "permission denied"**
- ⚠️ **Problema:** No tienes permisos de admin
- ✅ **Solución:** Usa una cuenta con permisos de admin

---

## ✅ **Después de Aplicar:**

1. ✅ **Verificar tablas:** Deberías ver `ordenes_compra` y `orden_compra_items`
2. ✅ **Probar funciones:** Ejecuta `SELECT * FROM estadisticas_compras_agiles();`
3. ✅ **Probar página:** Abre `/ordenes-compra` en la aplicación

---

**Tiempo estimado:** 2-3 minutos  
**Dificultad:** Fácil  
**Método recomendado:** Desde la aplicación (botón en Usuarios)
