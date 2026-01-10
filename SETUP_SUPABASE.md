# Guía de Configuración de Supabase para CompraAgil_VB

## 📋 Resumen

Esta guía te ayudará a configurar correctamente Supabase para el proyecto de scraping y matching de Compras Ágiles de MercadoPúblico.

## 🔑 Paso 1: Obtener Credenciales de Supabase

### 1.1 Acceder a tu Proyecto

1. Ve a [supabase.com/dashboard](https://supabase.com/dashboard)
2. Inicia sesión con tu cuenta
3. Selecciona tu proyecto (o crea uno nuevo si no tienes)

### 1.2 Obtener las API Keys

1. En el dashboard de tu proyecto, ve a **Settings** (⚙️ ícono de configuración en la barra lateral)
2. Selecciona **API** en el menú de configuración
3. Encontrarás dos secciones importantes:

#### Project URL
```
https://[tu-proyecto-id].supabase.co
```

#### API Keys
- **`anon` / `public`**: Esta key es segura para uso en el cliente
- **`service_role` / `secret`**: Esta key tiene acceso total (⚠️ NUNCA la expongas públicamente)

**Para este proyecto, usaremos la `service_role` key** porque nuestro scraper necesita permisos completos de escritura.

## 🗄️ Paso 2: Crear las Tablas en Supabase

### 2.1 Acceder al SQL Editor

1. En tu dashboard de Supabase, ve a **SQL Editor** en la barra lateral
2. Click en **+ New query**
3. Copia y pega el siguiente SQL:

```sql
-- ============================================
-- TABLAS PARA SISTEMA DE COMPRAS ÁGILES
-- ============================================

-- TABLA PRINCIPAL: Licitaciones/Compras Ágiles
CREATE TABLE IF NOT EXISTS licitaciones (
  codigo TEXT PRIMARY KEY,
  titulo TEXT,
  organismo TEXT,
  departamento TEXT,
  presupuesto_estimado NUMERIC(12,2),
  fecha_publicacion TIMESTAMP,
  fecha_cierre_primer_llamado TIMESTAMP,
  fecha_cierre_segundo_llamado TIMESTAMP,
  direccion_entrega TEXT,
  plazo_entrega TEXT,
  tipo_presupuesto TEXT,
  estado TEXT,
  estado_detallado TEXT,
  link_detalle TEXT,
  rut_institucion TEXT,
  tiene_adjuntos BOOLEAN DEFAULT FALSE,
  
  -- METADATA PARA PROCESAMIENTO
  fecha_extraccion TIMESTAMP DEFAULT NOW(),
  procesada BOOLEAN DEFAULT FALSE,
  match_encontrado BOOLEAN DEFAULT FALSE,
  oferta_enviada BOOLEAN DEFAULT FALSE,
  oferta_id TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- TABLA: Productos/Items de cada Licitación
CREATE TABLE IF NOT EXISTS licitacion_items (
  id SERIAL PRIMARY KEY,
  licitacion_codigo TEXT NOT NULL REFERENCES licitaciones(codigo) ON DELETE CASCADE,
  item_index INTEGER NOT NULL,
  
  -- DATOS DE MERCADOPÚBLICO
  producto_id TEXT,
  nombre TEXT,
  descripcion TEXT,
  cantidad TEXT,
  unidad TEXT,
  
  -- MATCHING CON INVENTARIO
  id_producto_inventario TEXT,
  match_confidence NUMERIC(5,2),
  precio_unitario_sugerido NUMERIC(12,2),
  precio_total_sugerido NUMERIC(12,2),
  margen_estimado NUMERIC(5,2),
  
  -- METADATA
  match_procesado BOOLEAN DEFAULT FALSE,
  incluido_en_oferta BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(licitacion_codigo, item_index)
);

-- TABLA: Documentos adjuntos (opcional)
CREATE TABLE IF NOT EXISTS licitacion_documentos (
  id SERIAL PRIMARY KEY,
  licitacion_codigo TEXT NOT NULL REFERENCES licitaciones(codigo) ON DELETE CASCADE,
  nombre TEXT,
  url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(licitacion_codigo, url)
);

-- ============================================
-- ÍNDICES PARA OPTIMIZAR CONSULTAS
-- ============================================

CREATE INDEX IF NOT EXISTS idx_licitaciones_fecha_pub 
  ON licitaciones(fecha_publicacion DESC);

CREATE INDEX IF NOT EXISTS idx_licitaciones_no_procesada 
  ON licitaciones(procesada) 
  WHERE procesada = FALSE;

CREATE INDEX IF NOT EXISTS idx_licitaciones_match 
  ON licitaciones(match_encontrado) 
  WHERE match_encontrado = TRUE;

CREATE INDEX IF NOT EXISTS idx_items_licitacion 
  ON licitacion_items(licitacion_codigo);

CREATE INDEX IF NOT EXISTS idx_items_no_procesado 
  ON licitacion_items(match_procesado) 
  WHERE match_procesado = FALSE;

CREATE INDEX IF NOT EXISTS idx_licitaciones_fecha_extraccion 
  ON licitaciones(fecha_extraccion DESC);

-- ============================================
-- TRIGGER PARA UPDATED_AT AUTOMÁTICO
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_licitaciones_updated_at 
  BEFORE UPDATE ON licitaciones
  FOR EACH ROW 
  EXECUTE PROCEDURE update_updated_at_column();

-- ============================================
-- VISTA: Licitaciones con conteo de items
-- ============================================

CREATE OR REPLACE VIEW v_licitaciones_resumen AS
SELECT 
  l.*,
  COUNT(li.id) as cantidad_items,
  COUNT(CASE WHEN li.match_procesado = TRUE THEN 1 END) as items_con_match
FROM licitaciones l
LEFT JOIN licitacion_items li ON l.codigo = li.licitacion_codigo
GROUP BY l.codigo;

-- ============================================
-- POLÍTICAS RLS (Row Level Security)
-- ============================================
-- Por ahora deshabilitado para simplificar desarrollo
-- Habilitar en producción:

-- ALTER TABLE licitaciones ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE licitacion_items ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE licitacion_documentos ENABLE ROW LEVEL SECURITY;

-- ============================================
-- VERIFICACIÓN
-- ============================================

SELECT 'Tablas creadas exitosamente' as mensaje;
```

4. Click en **Run** (▶️) para ejecutar el script
5. Deberías ver el mensaje: `Tablas creadas exitosamente`

### 2.2 Verificar las Tablas

Ejecuta esta query para verificar:

```sql
SELECT 
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('licitaciones', 'licitacion_items', 'licitacion_documentos')
ORDER BY table_name, ordinal_position;
```

## 🔧 Paso 3: Configuración Local

### 3.1 Crear archivo .env

En tu proyecto local, crea el archivo `.env` en la carpeta `mercadopublico-scraper/`:

```bash
cd ~/CompraAgil_VB/mercadopublico-scraper
cp .env.example .env
nano .env
```

### 3.2 Configurar las variables

Edita el archivo `.env` con tus credenciales:

```bash
SUPABASE_URL=https://[tu-proyecto-id].supabase.co
SUPABASE_KEY=[tu-service-role-key]

# Configuración de scraping
MAX_PAGES=5
INCREMENTAL_MODE=true
```

⚠️ **IMPORTANTE**: 
- Reemplaza `[tu-proyecto-id]` con el ID real de tu proyecto
- Reemplaza `[tu-service-role-key]` con tu key de Supabase
- **NUNCA** subas el archivo `.env` a GitHub (ya está en `.gitignore`)

### 3.3 Probar la conexión localmente

```bash
cd ~/CompraAgil_VB/mercadopublico-scraper
npm install
node scraper.js --test
```

Si todo está bien configurado, deberías ver:
```
Iniciando scraper de Compras Ágiles...
Página 1/1: https://buscador.mercadopublico.cl/compra-agil?...
Total resultados detectado: XXXX
Extraídas X compras en la página 1
Upsert OK: X filas en 'licitaciones'.
Finalizado. Compras únicas vistas (memoria): X
```

## 🚀 Paso 4: Configuración en GitHub Actions

### 4.1 Configurar GitHub Secrets

1. Ve a tu repositorio: [github.com/evarasvb/CompraAgil_VB](https://github.com/evarasvb/CompraAgil_VB)
2. Click en **Settings** (⚙️)
3. En el menú lateral, ve a **Secrets and variables** → **Actions**
4. Click en **New repository secret**
5. Crea estos dos secrets:

#### Secret 1: SUPABASE_URL
- **Name**: `SUPABASE_URL`
- **Secret**: `https://[tu-proyecto-id].supabase.co`

#### Secret 2: SUPABASE_KEY
- **Name**: `SUPABASE_KEY`
- **Secret**: `[tu-service-role-key]`

### 4.2 Verificar los Secrets

Después de crearlos, deberías ver:
- ✅ SUPABASE_URL
- ✅ SUPABASE_KEY

### 4.3 Ejecutar el Workflow Manualmente

1. Ve a la pestaña **Actions** en tu repositorio
2. Selecciona el workflow **Scraper Compras Ágiles (Cada Hora)**
3. Click en **Run workflow**
4. Espera a que termine (debería tomar 2-5 minutos)
5. Revisa los logs para confirmar que funciona

## 📊 Paso 5: Verificar los Datos en Supabase

### 5.1 Ver datos en Table Editor

1. En Supabase, ve a **Table Editor**
2. Selecciona la tabla `licitaciones`
3. Deberías ver las compras extraídas
4. Revisa también `licitacion_items` para ver los productos

### 5.2 Queries útiles

#### Ver últimas compras extraídas
```sql
SELECT 
  codigo,
  titulo,
  organismo,
  presupuesto_estimado,
  fecha_publicacion,
  fecha_extraccion
FROM licitaciones
ORDER BY fecha_extraccion DESC
LIMIT 20;
```

#### Ver compras con sus items
```sql
SELECT 
  l.codigo,
  l.titulo,
  l.presupuesto_estimado,
  li.item_index,
  li.nombre as item_nombre,
  li.cantidad,
  li.unidad
FROM licitaciones l
JOIN licitacion_items li ON l.codigo = li.licitacion_codigo
WHERE l.procesada = FALSE
ORDER BY l.fecha_publicacion DESC, li.item_index;
```

#### Estadísticas generales
```sql
SELECT 
  COUNT(*) as total_licitaciones,
  COUNT(CASE WHEN procesada = FALSE THEN 1 END) as pendientes_procesar,
  COUNT(CASE WHEN match_encontrado = TRUE THEN 1 END) as con_match,
  COUNT(CASE WHEN oferta_enviada = TRUE THEN 1 END) as ofertas_enviadas,
  MAX(fecha_extraccion) as ultima_extraccion
FROM licitaciones;
```

## 🔍 Solución de Problemas

### Error: "Invalid API key"

✅ **Solución**:
1. Verifica que estás usando la **service_role key** (no la anon key)
2. Confirma que la key no tiene espacios al inicio/final
3. Regenera la key en Supabase si es necesario (Settings → API → Generate new secret)

### Error: "relation 'licitaciones' does not exist"

✅ **Solución**:
1. Ejecuta nuevamente el script SQL del Paso 2.1
2. Verifica que estás en el schema correcto (`public`)
3. Confirma que tu SUPABASE_URL apunta al proyecto correcto

### GitHub Action falla con timeout

✅ **Solución**:
1. Reduce `MAX_PAGES` en el workflow (ej: de 5 a 2)
2. Aumenta el timeout en `scraper.js` (config.navigationTimeoutMs)
3. Verifica que Chrome/Puppeteer se instala correctamente

### No se extraen productos

✅ **Solución**:
1. Verifica que la función `scrapeCompraDetallada` está funcionando
2. Prueba localmente con `--test` y `--headed` para ver el navegador
3. Revisa los selectores CSS en el código (pueden cambiar si MercadoPúblico actualiza su sitio)

## 📈 Próximos Pasos

### Fase 2: Matching Engine (n8n)
- Configurar workflow de matching automático
- Conectar con tu inventario (Google Sheets/Excel)
- Calcular precios y márgenes

### Fase 3: Integración Odoo
- Crear oportunidades automáticas en CRM
- Sincronizar productos matched

### Fase 4: Dashboard Lovable
- Visualizar licitaciones en tiempo real
- Monitorear performance de matching
- Panel de control de ofertas

## 🆘 Soporte

Si tienes problemas:
1. Revisa los logs del scraper
2. Verifica las credenciales de Supabase
3. Consulta la documentación de [Supabase](https://supabase.com/docs)
4. Revisa el código en el repositorio

---

**Última actualización**: 2026-01-09  
**Versión**: 1.0.0
