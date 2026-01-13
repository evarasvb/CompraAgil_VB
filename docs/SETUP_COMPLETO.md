# Setup Completo - Sistema CompraAgil VB

## 🎯 Arquitectura del Sistema

```
[MercadoPúblico] → (cada hora)
     ↓
[GitHub Actions: Scraper + Supabase]
     ↓
[Supabase DB: licitaciones + items]
     ↓
[n8n: Matching Engine] ←→ [Inventario]
     ↓
[Odoo CRM: Oportunidades]
     ↓
[API Bot: Sube ofertas] → [MercadoPúblico]
     ↓
[Lovable Dashboard]
```

## 📋 Fase 1: Configuración de Supabase

### 1.1 Obtener Credenciales

1. Ve a [supabase.com/dashboard](https://supabase.com/dashboard)
2. Selecciona tu proyecto
3. Ve a **Project Settings** → **API**
4. Copia:
   - **Project URL**: `https://juiskeeutbaipwbeeezw.supabase.co`
   - **`service_role` secret key** (para el scraper)

### 1.2 Crear Tablas en Supabase

#### Opción recomendada (sin programar): 1 click desde GitHub Actions ✅

Este repo incluye un workflow que aplica automáticamente `supabase/schema.sql` a tu proyecto.

1) En Supabase:
- Project Settings → Database → Connection string → **URI**
- Copia la URI tipo:
  - `postgresql://postgres:<DB_PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres`

2) En GitHub (repo `CompraAgil_VB`):
- Settings → Secrets and variables → Actions → **New repository secret**
- Name: `SUPABASE_DB_URL`
- Value: pega la URI completa (incluye el password)

3) Ejecutar el workflow:
- GitHub → Actions → **Apply Supabase schema (manual)** → Run workflow

> Si `SUPABASE_DB_URL` no está configurado, el workflow no falla: muestra warning y no aplica cambios.

#### Opción manual (SQL Editor)

Ejecuta este SQL en el SQL Editor de Supabase:

```sql
-- TABLA PRINCIPAL DE LICITACIONES
CREATE TABLE IF NOT EXISTS licitaciones (
  codigo TEXT PRIMARY KEY,
  titulo TEXT,
  organismo TEXT,
  rut_institucion TEXT,
  departamento TEXT,
  presupuesto_estimado NUMERIC,
  fecha_publicacion TIMESTAMP,
  fecha_cierre_primer_llamado TIMESTAMP,
  fecha_cierre_segundo_llamado TIMESTAMP,
  direccion_entrega TEXT,
  plazo_entrega TEXT,
  tipo_presupuesto TEXT,
  estado TEXT,
  estado_detallado TEXT,
  link_detalle TEXT,
  tiene_adjuntos BOOLEAN DEFAULT FALSE,
  
  -- METADATA PARA PROCESAMIENTO
  procesada BOOLEAN DEFAULT FALSE,
  match_encontrado BOOLEAN DEFAULT FALSE,
  oferta_enviada BOOLEAN DEFAULT FALSE,
  oferta_id TEXT,
  fecha_extraccion TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- TABLA DE PRODUCTOS/ITEMS
CREATE TABLE IF NOT EXISTS licitacion_items (
  id SERIAL,
  licitacion_codigo TEXT REFERENCES licitaciones(codigo) ON DELETE CASCADE,
  item_index INTEGER,
  
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
  
  PRIMARY KEY (licitacion_codigo, item_index)
);

-- TABLA DE DOCUMENTOS (OPCIONAL)
CREATE TABLE IF NOT EXISTS licitacion_documentos (
  id SERIAL PRIMARY KEY,
  licitacion_codigo TEXT REFERENCES licitaciones(codigo) ON DELETE CASCADE,
  nombre TEXT,
  url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(licitacion_codigo, url)
);

-- ÍNDICES PARA VELOCIDAD
CREATE INDEX IF NOT EXISTS idx_licitaciones_fecha_pub ON licitaciones(fecha_publicacion DESC);
CREATE INDEX IF NOT EXISTS idx_licitaciones_no_procesada ON licitaciones(procesada) WHERE procesada = FALSE;
CREATE INDEX IF NOT EXISTS idx_licitaciones_match ON licitaciones(match_encontrado) WHERE match_encontrado = TRUE;
CREATE INDEX IF NOT EXISTS idx_items_licitacion ON licitacion_items(licitacion_codigo);
CREATE INDEX IF NOT EXISTS idx_items_no_procesado ON licitacion_items(match_procesado) WHERE match_procesado = FALSE;

-- TRIGGER PARA UPDATED_AT
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER IF NOT EXISTS update_licitaciones_updated_at 
BEFORE UPDATE ON licitaciones
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
```

## 📋 Fase 2: Configuración de GitHub Actions

### 2.1 Configurar Secrets en GitHub

1. Ve a tu repositorio: [github.com/evarasvb/CompraAgil_VB/settings/secrets/actions](https://github.com/evarasvb/CompraAgil_VB/settings/secrets/actions)
2. Click en **New repository secret**
3. Agrega estos secrets:

   - **Name**: `SUPABASE_URL`
     - **Value**: `https://juiskeeutbaipwbeeezw.supabase.co`
   
   - **Name**: `SUPABASE_KEY`
     - **Value**: Tu `service_role` key de Supabase

### 2.2 Verificar Workflow

El workflow ya está configurado en `.github/workflows/scraper-hourly.yml`.

- Se ejecuta **cada hora** automáticamente
- Usa modo incremental (últimos 75 minutos)
- Guarda datos en Supabase

## 📋 Fase 3: Testing Local

### 3.1 Configurar entorno local

```bash
cd ~/CompraAgil_VB/mercadopublico-scraper

# Crear .env
cp .env.example .env
nano .env
```

Editar `.env`:
```bash
SUPABASE_URL=https://juiskeeutbaipwbeeezw.supabase.co
SUPABASE_KEY=tu_service_role_key_aqui
INCREMENTAL_MODE=false
MAX_PAGES=2
```

### 3.2 Ejecutar scraper local

```bash
# Instalar dependencias
npm install

# Test simple (sin Supabase)
node scraper.js --test-simple

# Test completo (1 página)
node scraper.js --test --headed

# Producción (5 páginas)
node scraper.js --pages 5
```

## 📋 Fase 4: Matching Engine (n8n)

### 4.1 Workflow n8n

1. **Trigger**: Schedule (cada 5 minutos)
2. **Nodo Supabase**: Query licitaciones no procesadas
   ```sql
   SELECT * FROM licitaciones 
   WHERE procesada = FALSE 
   ORDER BY fecha_publicacion DESC
   LIMIT 50
   ```
3. **Loop**: Por cada licitación
   - Obtener items de `licitacion_items`
   - Hacer matching con tu inventario (Excel/Google Sheets)
   - Actualizar `match_confidence`, `precio_unitario_sugerido`
4. **Condicional**: Si `match_confidence > 80%`
   - Marcar `match_encontrado = TRUE`
   - Crear oportunidad en Odoo
5. **Finalizar**: Marcar `procesada = TRUE`

## 📋 Fase 5: Integración Odoo

### 5.1 Crear Oportunidad desde n8n

Usa HTTP Request en n8n:

```javascript
// URL
POST https://firmavb.odoo.com/xmlrpc/2/object

// Body
{
  "jsonrpc": "2.0",
  "method": "call",
  "params": {
    "service": "object",
    "method": "execute",
    "args": [
      "db_name",
      user_id,
      "password",
      "crm.lead",
      "create",
      {
        "name": "[MercadoPúblico] {{ $json.codigo }}",
        "description": "{{ $json.titulo }}",
        "partner_name": "{{ $json.organismo }}",
        "expected_revenue": {{ $json.presupuesto_estimado }},
        "tag_ids": [[6, 0, [tag_id_mercado_publico]]]
      }
    ]
  }
}
```

## 📋 Fase 6: Dashboard Lovable

Crear dashboard en Lovable para:
- Ver licitaciones en tiempo real
- Monitorear matching confidence
- Ver oportunidades creadas en Odoo
- Estado de ofertas enviadas

## 🔥 Comandos Rápidos

```bash
# Ver logs de GitHub Actions
gh run list --repo evarasvb/CompraAgil_VB

# Ejecutar manualmente el workflow
gh workflow run scraper-hourly.yml --repo evarasvb/CompraAgil_VB

# Ver últimas ejecuciones
gh run view --repo evarasvb/CompraAgil_VB
```

## ✅ Checklist de Implementación

- [ ] Crear tablas en Supabase (SQL arriba)
- [ ] Configurar secrets en GitHub
- [ ] Test local del scraper
- [ ] Verificar que GitHub Actions funciona
- [ ] Crear workflow n8n para matching
- [ ] Integrar con Odoo CRM
- [ ] Crear dashboard en Lovable
- [ ] Monitorear primera semana

## 🚨 Troubleshooting

### Error: Invalid API Key
- Verificar que usas `service_role` key (no `anon` key)
- Verificar que los secrets en GitHub están correctos
- Verificar que el `.env` local tiene la key correcta

### Scraper no encuentra elementos
- Ejecutar con `--headed` para ver el navegador
- Verificar que MercadoPúblico no cambió su estructura
- Revisar logs en GitHub Actions

### No se guardan datos en Supabase
- Verificar que las tablas existen
- Verificar permisos de la tabla (deben ser públicos para escritura con service_role)
- Revisar logs de errores en el scraper
