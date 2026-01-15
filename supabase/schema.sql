-- =====================================================
-- SCHEMA COMPLETO PARA COMPRAAGIL VB
-- Base de datos: Supabase PostgreSQL
-- Propósito: Almacenar licitaciones de MercadoPúblico
--          con productos y hacer matching automático
-- =====================================================

-- TABLA PRINCIPAL: LICITACIONES
-- Almacena datos generales de cada compra ágil
CREATE TABLE IF NOT EXISTS licitaciones (
  -- Identificación
  codigo TEXT PRIMARY KEY,  -- Ej: "1161266-3-COT26"
  
  -- Información General
  titulo TEXT,
  estado TEXT,
  estado_detallado TEXT,
  
  -- Fechas (compatibilidad con el scraper actual)
  -- Nota: el scraper guarda strings ISO locales (sin zona) en `publicada_el/finaliza_el`.
  -- Si prefieres tipos timestamp, cambia a TIMESTAMP y ajusta el scraper para incluir zona.
  publicada_el TEXT,
  finaliza_el TEXT,

  -- Organización Compradora
  organismo TEXT,
  rut_institucion TEXT,
  departamento TEXT,
  
  -- Datos Financieros
  presupuesto_estimado NUMERIC(15,2),
  tipo_presupuesto TEXT,
  
  -- Fechas Importantes
  fecha_publicacion TIMESTAMP WITH TIME ZONE,
  fecha_cierre_primer_llamado TIMESTAMP WITH TIME ZONE,
  fecha_cierre_segundo_llamado TIMESTAMP WITH TIME ZONE,
  fecha_extraccion TIMESTAMP WITH TIME ZONE,
  
  -- Detalles de Entrega
  direccion_entrega TEXT,
  plazo_entrega TEXT,
  
  -- Enlaces
  link_detalle TEXT,

  -- Matching / categorización (FirmaVB)
  categoria TEXT,
  categoria_match TEXT,
  match_score NUMERIC(10,2),
  palabras_encontradas JSONB,
  
  -- Documentos
  tiene_adjuntos BOOLEAN DEFAULT FALSE,
  
  -- METADATA PARA PROCESAMIENTO AUTOMATIZADO
  procesada BOOLEAN DEFAULT FALSE,
  match_encontrado BOOLEAN DEFAULT FALSE,
  oferta_enviada BOOLEAN DEFAULT FALSE,
  oferta_id TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Comentarios para documentación
COMMENT ON TABLE licitaciones IS 'Almacena compras ágiles de MercadoPúblico con datos completos';
COMMENT ON COLUMN licitaciones.codigo IS 'Código único de la licitación en MercadoPúblico';
COMMENT ON COLUMN licitaciones.procesada IS 'Indica si ya se procesó para matching con inventario';
COMMENT ON COLUMN licitaciones.match_encontrado IS 'TRUE si se encontró al menos un producto en inventario';
COMMENT ON COLUMN licitaciones.oferta_enviada IS 'TRUE si ya se envió oferta a MercadoPúblico';
COMMENT ON COLUMN licitaciones.publicada_el IS 'Fecha/hora de publicación (string ISO local) extraída del listado compra-agil';
COMMENT ON COLUMN licitaciones.finaliza_el IS 'Fecha/hora de cierre (string ISO local) extraída del listado compra-agil';
COMMENT ON COLUMN licitaciones.categoria IS 'Categoría interna calculada por matcher (ej: articulos_oficina, aseo, etc.)';
COMMENT ON COLUMN licitaciones.categoria_match IS 'Label legible de la categoría (para UI)';
COMMENT ON COLUMN licitaciones.match_score IS 'Score del matcher (dependiente de heurísticas / keywords)';
COMMENT ON COLUMN licitaciones.palabras_encontradas IS 'JSON con palabras/keywords que gatillaron el match';

-- =====================================================
-- TABLA: LICITACION_ITEMS
-- Almacena productos/items de cada licitación
-- =====================================================
CREATE TABLE IF NOT EXISTS licitacion_items (
  id SERIAL,
  licitacion_codigo TEXT NOT NULL REFERENCES licitaciones(codigo) ON DELETE CASCADE,
  item_index INTEGER NOT NULL,
  
  -- DATOS DE MERCADOPÚBLICO
  producto_id TEXT,  -- ID del catálogo de MercadoPúblico
  nombre TEXT,
  descripcion TEXT,
  cantidad TEXT,
  unidad TEXT,
  
  -- MATCHING CON TU INVENTARIO
  id_producto_inventario TEXT,  -- Tu SKU interno
  match_confidence NUMERIC(5,2),  -- 0-100%
  match_method TEXT,  -- 'exact', 'fuzzy', 'manual', 'ai'
  
  -- PRICING
  precio_unitario_sugerido NUMERIC(12,2),
  precio_total_sugerido NUMERIC(12,2),
  margen_estimado NUMERIC(5,2),
  
  -- METADATA
  match_procesado BOOLEAN DEFAULT FALSE,
  incluido_en_oferta BOOLEAN DEFAULT FALSE,
  notas TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  PRIMARY KEY (licitacion_codigo, item_index)
);

COMMENT ON TABLE licitacion_items IS 'Items/productos de cada licitación con matching a inventario';
COMMENT ON COLUMN licitacion_items.match_confidence IS 'Confianza del matching: 0-100%';
COMMENT ON COLUMN licitacion_items.match_method IS 'Método usado para el matching';

-- =====================================================
-- TABLA: LICITACION_DOCUMENTOS
-- Almacena documentos adjuntos de cada licitación
-- =====================================================
CREATE TABLE IF NOT EXISTS licitacion_documentos (
  id SERIAL PRIMARY KEY,
  licitacion_codigo TEXT NOT NULL REFERENCES licitaciones(codigo) ON DELETE CASCADE,
  nombre TEXT,
  url TEXT NOT NULL,
  tipo_documento TEXT,  -- 'bases', 'anexo', 'pliego', etc
  descargado BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(licitacion_codigo, url)
);

COMMENT ON TABLE licitacion_documentos IS 'Documentos adjuntos de cada licitación';

-- =====================================================
-- TABLA: OFERTAS
-- Registro de ofertas enviadas a MercadoPúblico
-- =====================================================
CREATE TABLE IF NOT EXISTS ofertas (
  id SERIAL PRIMARY KEY,
  oferta_id TEXT UNIQUE,  -- ID generado por MercadoPúblico
  licitacion_codigo TEXT NOT NULL REFERENCES licitaciones(codigo),
  
  -- Estado de la oferta
  estado TEXT,  -- 'borrador', 'enviada', 'adjudicada', 'rechazada'
  monto_total NUMERIC(15,2),
  
  -- Timestamps
  fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fecha_envio TIMESTAMP WITH TIME ZONE,
  fecha_resultado TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  notas TEXT,
  adjudicada BOOLEAN DEFAULT FALSE
);

COMMENT ON TABLE ofertas IS 'Registro de ofertas enviadas a MercadoPúblico';

-- =====================================================
-- ÍNDICES PARA OPTIMIZACIÓN DE QUERIES
-- =====================================================

-- Índices en licitaciones
CREATE INDEX IF NOT EXISTS idx_licitaciones_fecha_pub 
  ON licitaciones(fecha_publicacion DESC);

CREATE INDEX IF NOT EXISTS idx_licitaciones_no_procesada 
  ON licitaciones(procesada) 
  WHERE procesada = FALSE;

CREATE INDEX IF NOT EXISTS idx_licitaciones_match 
  ON licitaciones(match_encontrado) 
  WHERE match_encontrado = TRUE;

CREATE INDEX IF NOT EXISTS idx_licitaciones_fecha_cierre 
  ON licitaciones(fecha_cierre_primer_llamado) 
  WHERE fecha_cierre_primer_llamado IS NOT NULL;

-- Índices en items
CREATE INDEX IF NOT EXISTS idx_items_licitacion 
  ON licitacion_items(licitacion_codigo);

CREATE INDEX IF NOT EXISTS idx_items_no_procesado 
  ON licitacion_items(match_procesado) 
  WHERE match_procesado = FALSE;

CREATE INDEX IF NOT EXISTS idx_items_match_confidence 
  ON licitacion_items(match_confidence DESC) 
  WHERE match_confidence >= 70;

-- Índices en documentos
CREATE INDEX IF NOT EXISTS idx_documentos_licitacion 
  ON licitacion_documentos(licitacion_codigo);

-- =====================================================
-- FUNCIONES Y TRIGGERS
-- =====================================================

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger en licitaciones
DROP TRIGGER IF EXISTS update_licitaciones_updated_at ON licitaciones;
CREATE TRIGGER update_licitaciones_updated_at 
  BEFORE UPDATE ON licitaciones
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Función para marcar licitación como con match cuando hay items con match
CREATE OR REPLACE FUNCTION check_match_encontrado()
RETURNS TRIGGER AS $$
BEGIN
  -- Si hay al menos un item con match_confidence > 70%, marcar la licitación
  UPDATE licitaciones 
  SET match_encontrado = TRUE
  WHERE codigo = NEW.licitacion_codigo
    AND EXISTS (
      SELECT 1 FROM licitacion_items
      WHERE licitacion_codigo = NEW.licitacion_codigo
        AND match_confidence >= 70
    );
  
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para actualizar match_encontrado automáticamente
DROP TRIGGER IF EXISTS trigger_check_match ON licitacion_items;
CREATE TRIGGER trigger_check_match
  AFTER INSERT OR UPDATE OF match_confidence ON licitacion_items
  FOR EACH ROW
  EXECUTE FUNCTION check_match_encontrado();

-- =====================================================
-- VISTAS ÚTILES PARA QUERIES COMUNES
-- =====================================================

-- Vista: Licitaciones con alto potencial (match > 70%)
CREATE OR REPLACE VIEW licitaciones_con_match AS
SELECT
  l.*,
  COALESCE(agg.total_items, 0) as total_items,
  COALESCE(agg.items_con_match, 0) as items_con_match,
  agg.match_confidence_promedio,
  agg.monto_total_estimado
FROM licitaciones l
LEFT JOIN (
  SELECT
    licitacion_codigo,
    COUNT(*) as total_items,
    COUNT(*) FILTER (WHERE match_confidence >= 70) as items_con_match,
    AVG(match_confidence) as match_confidence_promedio,
    SUM(precio_total_sugerido) as monto_total_estimado
  FROM licitacion_items
  GROUP BY licitacion_codigo
) agg ON l.codigo = agg.licitacion_codigo
WHERE l.match_encontrado = TRUE
ORDER BY agg.match_confidence_promedio DESC, l.presupuesto_estimado DESC;

COMMENT ON VIEW licitaciones_con_match IS 'Licitaciones con al menos un producto en inventario';

-- Vista: Licitaciones urgentes (cierran en 48 horas)
CREATE OR REPLACE VIEW licitaciones_urgentes AS
SELECT 
  l.*,
  EXTRACT(EPOCH FROM (l.fecha_cierre_primer_llamado - NOW())) / 3600 as horas_restantes
FROM licitaciones l
WHERE l.fecha_cierre_primer_llamado > NOW()
  AND l.fecha_cierre_primer_llamado <= NOW() + INTERVAL '48 hours'
  AND l.oferta_enviada = FALSE
ORDER BY l.fecha_cierre_primer_llamado ASC;

COMMENT ON VIEW licitaciones_urgentes IS 'Licitaciones que cierran en las próximas 48 horas';

-- Vista: Dashboard de estado
CREATE OR REPLACE VIEW dashboard_estado AS
SELECT 
  COUNT(*) as total_licitaciones,
  COUNT(*) FILTER (WHERE procesada = TRUE) as procesadas,
  COUNT(*) FILTER (WHERE match_encontrado = TRUE) as con_match,
  COUNT(*) FILTER (WHERE oferta_enviada = TRUE) as ofertas_enviadas,
  SUM(presupuesto_estimado) as monto_total_oportunidades,
  SUM(presupuesto_estimado) FILTER (WHERE match_encontrado = TRUE) as monto_con_match
FROM licitaciones
WHERE fecha_extraccion >= NOW() - INTERVAL '7 days';

COMMENT ON VIEW dashboard_estado IS 'Métricas generales de últimos 7 días';

-- =====================================================
-- VISTAS “ALL” PARA DASHBOARD (SIN FILTRO 7 DÍAS)
-- =====================================================

-- Todas las Compras Ágiles/licitaciones scrapeadas (para dashboards que deben mostrar TODO)
CREATE OR REPLACE VIEW licitaciones_all AS
SELECT
  l.*
FROM licitaciones l
ORDER BY l.created_at DESC;

COMMENT ON VIEW licitaciones_all IS 'Listado completo de compras ágiles scrapeadas (sin filtros de fecha)';

-- =====================================================
-- CONFIGURACIÓN DE ROW LEVEL SECURITY (RLS)
-- DESACTIVADO para service_role key
-- =====================================================

-- Las tablas son accesibles con service_role key sin RLS
-- Si quieres agregar RLS para el frontend:

-- ALTER TABLE licitaciones ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Public read access" ON licitaciones FOR SELECT USING (true);

-- =====================================================
-- DATOS DE PRUEBA (OPCIONAL)
-- =====================================================

-- Descomentar para insertar datos de prueba:
/*
INSERT INTO licitaciones (codigo, titulo, organismo, presupuesto_estimado, fecha_publicacion, fecha_cierre_primer_llamado)
VALUES 
  ('1161266-3-COT26', 'ADQUISICIÓN DE AGENDAS 2026', 'I MUNICIPALIDAD DE TUCAPEL', 300000, NOW(), NOW() + INTERVAL '3 days'),
  ('1161267-4-COT26', 'COMPRA DE MATERIAL DE OFICINA', 'MINISTERIO DE SALUD', 500000, NOW(), NOW() + INTERVAL '5 days')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO licitacion_items (licitacion_codigo, item_index, nombre, descripcion, cantidad, unidad)
VALUES
  ('1161266-3-COT26', 1, 'Agendas', 'AGENDA CLÁSICA AÑO 2026 RHEIN O SIMILAR', '30', 'Unidades'),
  ('1161266-3-COT26', 2, 'Taco calendario', 'TACO CALENDARIO 2026 11X17 CM', '40', 'Globales')
ON CONFLICT (licitacion_codigo, item_index) DO NOTHING;
*/

-- =====================================================
-- LICITACIONES GRANDES (>=100 UTM) - API (estructura base)
-- =====================================================

-- Requerido para gen_random_uuid() (ordenes_compra_items)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS licitaciones_api (
  codigo TEXT PRIMARY KEY,
  titulo TEXT,
  organismo TEXT,
  descripcion TEXT,
  estado TEXT,
  fecha_publicacion TIMESTAMP,
  fecha_cierre TIMESTAMP,
  link_detalle TEXT,
  presupuesto_estimado NUMERIC(15,2),
  raw_json JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  -- Para cache inteligente (si fue scrapeado recientemente, skip)
  last_scraped_at TIMESTAMP WITH TIME ZONE,
  -- Para cache agresivo: marcar "stale" y reintentar en otra pasada
  stale BOOLEAN NOT NULL DEFAULT FALSE,
  stale_marked_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE licitaciones_api IS 'Licitaciones (>=100 UTM) obtenidas por API (no incluye Compras Ágiles)';

-- Compatibilidad: si la tabla ya existía antes del cambio
ALTER TABLE licitaciones_api
  ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE licitaciones_api
  ADD COLUMN IF NOT EXISTS stale BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE licitaciones_api
  ADD COLUMN IF NOT EXISTS stale_marked_at TIMESTAMP WITH TIME ZONE;

-- =====================================================
-- ÓRDENES DE COMPRA (OC) - HISTÓRICO PARA BI
-- =====================================================

-- Cabecera OC
CREATE TABLE IF NOT EXISTS ordenes_compra (
  numero_oc TEXT PRIMARY KEY,
  numero_licitacion TEXT,
  demandante TEXT,
  rut_demandante TEXT,
  unidad_compra TEXT,
  fecha_envio_oc TIMESTAMP,
  estado TEXT,
  proveedor TEXT,
  rut_proveedor TEXT,
  neto NUMERIC,
  iva NUMERIC,
  total NUMERIC,
  subtotal NUMERIC,
  raw_json JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  -- Para cache inteligente (si fue scrapeado recientemente, skip)
  last_scraped_at TIMESTAMP WITH TIME ZONE,
  -- Para cache agresivo: marcar "stale" y reintentar en otra pasada
  stale BOOLEAN NOT NULL DEFAULT FALSE,
  stale_marked_at TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE ordenes_compra IS 'Órdenes de compra (cabecera) para análisis histórico';

-- Compatibilidad: si la tabla ya existía antes del cambio
ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS stale BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS stale_marked_at TIMESTAMP WITH TIME ZONE;

-- Ítems/líneas OC
CREATE TABLE IF NOT EXISTS ordenes_compra_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_oc TEXT REFERENCES ordenes_compra(numero_oc) ON DELETE CASCADE,
  codigo_producto TEXT,
  producto TEXT,
  cantidad NUMERIC,
  unidad TEXT,
  precio_unitario NUMERIC,
  descuento NUMERIC,
  cargos NUMERIC,
  valor_total NUMERIC,
  especificaciones TEXT,
  raw_json JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE ordenes_compra_items IS 'Detalle/líneas de órdenes de compra (para BI y análisis de precios)';

-- Índices recomendados para BI
CREATE INDEX IF NOT EXISTS idx_oc_fecha_envio ON ordenes_compra(fecha_envio_oc);
CREATE INDEX IF NOT EXISTS idx_oc_demandante ON ordenes_compra(demandante);
CREATE INDEX IF NOT EXISTS idx_oc_proveedor ON ordenes_compra(proveedor);
CREATE INDEX IF NOT EXISTS idx_oc_numero_licitacion ON ordenes_compra(numero_licitacion);
CREATE INDEX IF NOT EXISTS idx_oc_items_numero_oc ON ordenes_compra_items(numero_oc);
CREATE INDEX IF NOT EXISTS idx_oc_items_producto ON ordenes_compra_items(producto);

-- Índices para cache/operación
CREATE INDEX IF NOT EXISTS idx_licitaciones_api_last_scraped_at ON licitaciones_api(last_scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_oc_last_scraped_at ON ordenes_compra(last_scraped_at DESC);

-- =====================================================
-- PENDIENTE SYNC DESDE EXTENSIÓN CHROME (ANTI-BLOQUEO)
-- =====================================================

CREATE TABLE IF NOT EXISTS pending_extension_sync (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  identifier TEXT NOT NULL,
  url TEXT,
  reason TEXT,
  context JSONB,
  status TEXT DEFAULT 'pending',
  attempts INT DEFAULT 0,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  completed_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  payload JSONB
);

-- =====================================================
-- MONITOREO: HEALTH LOG DE SCRAPERS
-- =====================================================

CREATE TABLE IF NOT EXISTS scraper_health_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  tipo_scraper TEXT NOT NULL, -- oc_api, lic_api, compra_agil, etc.
  status TEXT NOT NULL, -- ok|fail|alert
  duracion_ms INTEGER,
  items_obtenidos INTEGER,
  errores TEXT,
  meta JSONB
);

COMMENT ON TABLE scraper_health_log IS 'Log de salud de scrapers (status, duración, items, errores) para monitoreo y alertas.';
CREATE INDEX IF NOT EXISTS idx_scraper_health_log_tipo_created ON scraper_health_log(tipo_scraper, created_at DESC);

ALTER TABLE scraper_health_log ADD COLUMN IF NOT EXISTS duracion_ms INTEGER;

-- =====================================================
-- INSTITUCIONES (compradores) - ENRIQUECIMIENTO
-- =====================================================
-- Nota: algunos datos (reclamos/conducta de pago) pueden venir de fuentes externas.
-- Esta tabla permite ir acumulando métricas por institución (RUT).
CREATE TABLE IF NOT EXISTS instituciones (
  rut TEXT PRIMARY KEY,
  nombre TEXT,
  division TEXT,
  codigo_entidad TEXT,
  sector TEXT,
  sitio_web TEXT,
  telefono TEXT,
  correo TEXT,
  domicilio_legal TEXT,
  region TEXT,
  comuna TEXT,

  -- Métricas derivadas (ej. desde ordenes_compra)
  oc_total INTEGER,
  oc_monto_total NUMERIC,
  oc_ultima_fecha TIMESTAMP WITH TIME ZONE,

  -- Campos reservados para futuros scrapers (si se logra extraer desde MercadoPublico)
  conducta_pago TEXT,
  pago_promedio_dias INTEGER,
  pago_sigfe BOOLEAN,
  pago_actualizado_el TIMESTAMP WITH TIME ZONE,
  reclamos_total INTEGER,
  reclamos_ultima_fecha TIMESTAMP WITH TIME ZONE,

  meta JSONB,
  last_seen_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE instituciones IS 'Instituciones compradoras (RUT) con métricas/enriquecimiento (OC, reclamos, conducta de pago, etc.)';
CREATE INDEX IF NOT EXISTS idx_instituciones_oc_total ON instituciones(oc_total DESC);
CREATE INDEX IF NOT EXISTS idx_instituciones_last_seen ON instituciones(last_seen_at DESC);

-- =====================================================
-- VISTA UNIFICADA: OPORTUNIDADES (Compra Ágil vs Licitación grande)
-- =====================================================

CREATE OR REPLACE VIEW oportunidades_all AS
SELECT
  'compra_agil'::text AS tipo_proceso,
  l.codigo,
  l.titulo,
  l.organismo,
  NULL::text AS descripcion,
  l.estado,
  (l.publicada_el)::timestamp AS fecha_publicacion,
  (l.finaliza_el)::timestamp AS fecha_cierre,
  l.link_detalle,
  l.presupuesto_estimado,
  l.categoria_match,
  l.match_score,
  l.created_at
FROM licitaciones l
UNION ALL
SELECT
  'licitacion'::text AS tipo_proceso,
  a.codigo,
  a.titulo,
  a.organismo,
  a.descripcion,
  a.estado,
  a.fecha_publicacion,
  a.fecha_cierre,
  a.link_detalle,
  a.presupuesto_estimado,
  NULL::text AS categoria_match,
  NULL::numeric AS match_score,
  a.created_at
FROM licitaciones_api a;

COMMENT ON VIEW oportunidades_all IS 'Unión de compras ágiles (scraping) y licitaciones grandes (API) con campo tipo_proceso';

-- =====================================================
-- VISTAS BI: Órdenes de compra agrupadas + origen (compra_agil vs licitacion)
-- =====================================================

CREATE OR REPLACE VIEW oc_enriquecidas AS
SELECT
  oc.*,
  COALESCE(o.tipo_proceso, 'desconocido') AS tipo_origen
FROM ordenes_compra oc
LEFT JOIN oportunidades_all o ON o.codigo = oc.numero_licitacion;

COMMENT ON VIEW oc_enriquecidas IS 'Órdenes de compra con tipo_origen (compra_agil vs licitacion) vía join con oportunidades_all';

CREATE OR REPLACE VIEW bi_oc_negocios_por_institucion AS
SELECT
  tipo_origen,
  demandante,
  COUNT(*) AS cantidad_ordenes,
  COUNT(DISTINCT proveedor) AS cantidad_proveedores,
  SUM(COALESCE(total, 0)) AS monto_total
FROM oc_enriquecidas
GROUP BY tipo_origen, demandante
ORDER BY monto_total DESC;

COMMENT ON VIEW bi_oc_negocios_por_institucion IS 'BI: agrupa órdenes por institución (demandante) y tipo_origen';

CREATE OR REPLACE VIEW bi_oc_negocios_por_proveedor AS
SELECT
  tipo_origen,
  proveedor,
  COUNT(*) AS cantidad_ordenes,
  COUNT(DISTINCT demandante) AS cantidad_instituciones,
  SUM(COALESCE(total, 0)) AS monto_total
FROM oc_enriquecidas
GROUP BY tipo_origen, proveedor
ORDER BY monto_total DESC;

COMMENT ON VIEW bi_oc_negocios_por_proveedor IS 'BI: ranking de proveedores por monto y tipo_origen';

CREATE OR REPLACE VIEW bi_oc_productos AS
SELECT
  e.tipo_origen,
  i.codigo_producto,
  i.producto,
  COUNT(*) AS lineas,
  COUNT(DISTINCT e.proveedor) AS proveedores,
  COUNT(DISTINCT e.demandante) AS instituciones,
  SUM(COALESCE(i.valor_total, 0)) AS monto_total,
  MIN(i.precio_unitario) AS precio_unitario_min,
  AVG(i.precio_unitario) AS precio_unitario_prom,
  MAX(i.precio_unitario) AS precio_unitario_max
FROM ordenes_compra_items i
JOIN oc_enriquecidas e ON e.numero_oc = i.numero_oc
GROUP BY e.tipo_origen, i.codigo_producto, i.producto
ORDER BY monto_total DESC;

COMMENT ON VIEW bi_oc_productos IS 'BI: productos por monto/precio y tipo_origen, basado en ordenes_compra_items';

CREATE OR REPLACE VIEW bi_oc_precios_producto_proveedor AS
SELECT
  e.tipo_origen,
  i.codigo_producto,
  i.producto,
  e.proveedor,
  COUNT(*) AS muestras,
  MIN(i.precio_unitario) AS precio_min,
  AVG(i.precio_unitario) AS precio_prom,
  MAX(i.precio_unitario) AS precio_max
FROM ordenes_compra_items i
JOIN oc_enriquecidas e ON e.numero_oc = i.numero_oc
GROUP BY e.tipo_origen, i.codigo_producto, i.producto, e.proveedor
ORDER BY precio_prom DESC;

COMMENT ON VIEW bi_oc_precios_producto_proveedor IS 'BI: comparación de precios unitarios por proveedor para un producto';

-- =====================================================
-- CALENDARIO (eventos para compras ágiles + licitaciones grandes)
-- =====================================================

CREATE OR REPLACE VIEW calendario_eventos AS
SELECT
  l.codigo AS codigo,
  'compra_agil'::text AS tipo_proceso,
  l.titulo,
  'apertura'::text AS tipo_evento,
  (l.publicada_el)::timestamp AS fecha,
  l.link_detalle
FROM licitaciones l
WHERE l.publicada_el IS NOT NULL AND l.publicada_el <> ''
UNION ALL
SELECT
  l.codigo AS codigo,
  'compra_agil'::text AS tipo_proceso,
  l.titulo,
  'cierre'::text AS tipo_evento,
  (l.finaliza_el)::timestamp AS fecha,
  l.link_detalle
FROM licitaciones l
WHERE l.finaliza_el IS NOT NULL AND l.finaliza_el <> ''
UNION ALL
SELECT
  a.codigo AS codigo,
  'licitacion'::text AS tipo_proceso,
  a.titulo,
  'apertura'::text AS tipo_evento,
  a.fecha_publicacion AS fecha,
  a.link_detalle
FROM licitaciones_api a
WHERE a.fecha_publicacion IS NOT NULL
UNION ALL
SELECT
  a.codigo AS codigo,
  'licitacion'::text AS tipo_proceso,
  a.titulo,
  'cierre'::text AS tipo_evento,
  a.fecha_cierre AS fecha,
  a.link_detalle
FROM licitaciones_api a
WHERE a.fecha_cierre IS NOT NULL
ORDER BY fecha ASC;

COMMENT ON VIEW calendario_eventos IS 'Eventos (apertura/cierre) para calendario, separando compra_agil vs licitacion';

-- =====================================================
-- FIN DEL SCHEMA
-- =====================================================

-- Para verificar que todo se creó correctamente:
SELECT 
  'licitaciones' as tabla, COUNT(*) as registros FROM licitaciones
UNION ALL
SELECT 
  'licitacion_items' as tabla, COUNT(*) as registros FROM licitacion_items
UNION ALL
SELECT 
  'licitacion_documentos' as tabla, COUNT(*) as registros FROM licitacion_documentos;
