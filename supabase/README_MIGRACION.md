# Instrucciones para Aplicar la Migración SQL

Este directorio contiene la migración SQL necesaria para crear el "Cerebro de Precios" en Supabase.

## Archivo de Migración

- `migrations/001_cerebro_precios.sql` - Crea las tablas necesarias para el sistema de matching y cálculo de márgenes.

## Cómo Aplicar la Migración

### Opción 1: Desde el Dashboard de Supabase (Recomendado)

1. Ve a tu proyecto en [Supabase Dashboard](https://app.supabase.com)
2. Navega a **SQL Editor**
3. Abre el archivo `supabase/migrations/001_cerebro_precios.sql`
4. Copia y pega todo el contenido en el editor SQL
5. Haz clic en **Run** para ejecutar la migración

### Opción 2: Usando Supabase CLI

Si tienes Supabase CLI instalado:

```bash
# Asegúrate de estar en el directorio raíz del proyecto
supabase db push
```

O directamente:

```bash
supabase db execute --file supabase/migrations/001_cerebro_precios.sql
```

## Tablas Creadas

La migración crea las siguientes tablas:

1. **producto_maestro**: Catálogo de productos con costos y precios
   - `sku` (TEXT, PRIMARY KEY)
   - `nombre_interno` (TEXT)
   - `costo_neto` (NUMERIC)
   - `precio_venta_sugerido` (NUMERIC, opcional)
   - `familia` (TEXT)
   - `palabras_clave` (TEXT[])
   - `updated_at` (TIMESTAMPTZ)

2. **configuracion_global**: Configuraciones flexibles del sistema
   - `clave` (TEXT, PRIMARY KEY)
   - `valor` (JSONB)
   - `updated_at` (TIMESTAMPTZ)

3. **match_correcciones**: Correcciones manuales para aprendizaje
   - `id` (SERIAL, PRIMARY KEY)
   - `descripcion_mp` (TEXT)
   - `sku_correcto` (TEXT, FK a producto_maestro)
   - `created_at` (TIMESTAMPTZ)

## Columnas Agregadas a licitacion_items

La migración también agrega las siguientes columnas a la tabla existente `licitacion_items`:

- `match_sku` (TEXT) - SKU del producto encontrado
- `costo_unitario` (NUMERIC) - Costo unitario del producto
- `margen_estimado` (NUMERIC) - Margen calculado (0-1)
- `confidence_score` (NUMERIC) - Score de confianza del match (0-1)
- `fecha_match` (TIMESTAMPTZ) - Fecha del último matching

## Seguridad (RLS)

Todas las tablas tienen Row Level Security (RLS) habilitado con políticas que permiten:
- SELECT, INSERT, UPDATE para usuarios `authenticated` y `service_role`

## Verificación

Después de aplicar la migración, verifica que las tablas se crearon correctamente:

```sql
-- Verificar tablas
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('producto_maestro', 'configuracion_global', 'match_correcciones');

-- Verificar columnas en licitacion_items
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'licitacion_items' 
  AND column_name IN ('match_sku', 'costo_unitario', 'margen_estimado', 'confidence_score', 'fecha_match');
```

## Próximos Pasos

1. **Cargar productos**: Inserta tus productos en la tabla `producto_maestro`
2. **Configurar GitHub Secrets**: Asegúrate de tener configurado `SUPABASE_DB_URL` en los secrets de GitHub Actions
3. **Probar el matcher**: Ejecuta manualmente `python run_matcher.py --mode=db --days=1` para verificar que todo funciona

## Ejemplo de Inserción de Productos

```sql
INSERT INTO producto_maestro (sku, nombre_interno, costo_neto, precio_venta_sugerido, familia, palabras_clave)
VALUES 
  ('SKU001', 'ESCRITORIO 2 CAJONES COLOR NATURAL', 50000, 65000, 'Muebles', ARRAY['escritorio', 'mesa', 'oficina']),
  ('SKU002', 'CAJONERA OFICINA GABINETE', 35000, 45000, 'Muebles', ARRAY['cajonera', 'gabinete', 'archivero']);
```
