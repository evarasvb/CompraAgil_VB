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
  WHERE fecha_cierre_primer_llamado > NOW();

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
  COUNT(i.id) as total_items,
  COUNT(i.id) FILTER (WHERE i.match_confidence >= 70) as items_con_match,
  AVG(i.match_confidence) as match_confidence_promedio,
  SUM(i.precio_total_sugerido) as monto_total_estimado
FROM licitaciones l
LEFT JOIN licitacion_items i ON l.codigo = i.licitacion_codigo
WHERE l.match_encontrado = TRUE
GROUP BY l.codigo
ORDER BY match_confidence_promedio DESC, l.presupuesto_estimado DESC;

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
