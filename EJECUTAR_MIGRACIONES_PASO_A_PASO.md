# ⚡ Ejecutar Migraciones - Paso a Paso AHORA

## 🎯 **Sigue estos pasos (2 minutos):**

### **Paso 1: Abre Supabase Dashboard**
1. Ve a: https://app.supabase.com
2. Inicia sesión si es necesario
3. Selecciona tu proyecto: **FirmaVB** (o el que corresponda)

### **Paso 2: Abre SQL Editor**
1. En el menú lateral izquierdo, click en **"SQL Editor"**
2. Click en el botón **"New query"** (verde, arriba a la derecha)

### **Paso 3: Copia el SQL**
1. En tu editor (Cursor), el archivo `APLICAR_MIGRACIONES.sql` ya está abierto
2. Selecciona **TODO** el contenido:
   - **Windows/Linux**: Presiona `Ctrl+A`
   - **Mac**: Presiona `Cmd+A`
3. Copia el contenido:
   - **Windows/Linux**: Presiona `Ctrl+C`
   - **Mac**: Presiona `Cmd+C`

### **Paso 4: Pega en Supabase**
1. Ve a la ventana de Supabase SQL Editor
2. Click en el área de texto grande (donde dice "Type your query here...")
3. Pega el contenido:
   - **Windows/Linux**: Presiona `Ctrl+V`
   - **Mac**: Presiona `Cmd+V`

### **Paso 5: Ejecuta**
1. Click en el botón **"Run"** (verde, arriba)
   - O presiona `Ctrl+Enter` (Windows/Linux)
   - O presiona `Cmd+Enter` (Mac)

### **Paso 6: Verifica Resultados**
Deberías ver en la parte inferior:
- ✅ Mensajes de éxito como:
  - "Success. No rows returned"
  - "CREATE VIEW"
  - "CREATE FUNCTION"
  - "CREATE TABLE"
  - "CREATE POLICY"

Si ves errores de "already exists", es normal (el SQL es idempotente, pero algunos mensajes pueden aparecer).

---

## ✅ **Qué se Aplicará:**

- ✅ Vista `compras_agiles_sospechosas`
- ✅ Vista `compras_agiles_sin_productos`
- ✅ Función `revisar_datos_prueba_compras_agiles()`
- ✅ Función `estadisticas_compras_agiles()`
- ✅ Tabla `ordenes_compra`
- ✅ Tabla `orden_compra_items`
- ✅ Índices y políticas RLS
- ✅ Triggers

---

## 🔍 **Verificar que Funcionó:**

Después de ejecutar, prueba en el SQL Editor:

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

---

**Tiempo estimado:** 2 minutos  
**Dificultad:** Muy fácil

¡Vamos! 🚀
