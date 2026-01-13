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
-- TABLA: COMPRAS_AGILES (para compatibilidad/BI)
-- Nota: en muchos despliegues "compras ágiles" viven en `licitaciones`.
-- Esta tabla permite persistir un subset/variant si tu stack la requiere.
-- =====================================================
CREATE TABLE IF NOT EXISTS compras_agiles (
  codigo TEXT PRIMARY KEY,
  titulo TEXT,
  organismo TEXT,
  descripcion TEXT,
  fecha_publicacion TIMESTAMP,
  fecha_cierre TIMESTAMP,
  link_detalle TEXT,
  match_score NUMERIC(10,2),
  categoria TEXT,
  categoria_match TEXT,
  palabras_encontradas JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE compras_agiles IS 'Compras ágiles normalizadas (opcional si ya usas licitaciones)';

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

-- Nota: NO se incluyen inserts de ejemplo en este repositorio.

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

-- =====================================================
-- EXTENSIONES (requeridas para UUID)
-- =====================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- TABLAS CLIENTE (FirmaVB)
-- =====================================================

-- Clientes / tenants (1 cliente por empresa)
CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE, -- opcional: vincular a auth.users (Lovable/Supabase Auth)
  nombre TEXT,
  rut TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE clientes IS 'Clientes/tenants FirmaVB';
COMMENT ON COLUMN clientes.user_id IS 'UUID del usuario en auth.users (opcional)';

-- Inventario por cliente (catálogo)
CREATE TABLE IF NOT EXISTS cliente_inventario (
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  categoria TEXT,
  precio NUMERIC(15,2) DEFAULT 0,
  unidad TEXT,
  keywords TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (cliente_id, sku)
);

COMMENT ON TABLE cliente_inventario IS 'Inventario/catálogo por cliente (upsert por sku)';

-- Exclusiones por cliente (no mostrar / no postular)
CREATE TABLE IF NOT EXISTS cliente_exclusiones (
  id SERIAL PRIMARY KEY,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (cliente_id, keyword)
);

-- Notificaciones por cliente
CREATE TABLE IF NOT EXISTS cliente_notificaciones (
  id SERIAL PRIMARY KEY,
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (cliente_id, email)
);

-- Ofertas / postulaciones (preparación para postulador automático)
CREATE TABLE IF NOT EXISTS cliente_ofertas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  -- Puede apuntar a una licitación del scraper o a compras_agiles (según tu stack)
  licitacion_codigo TEXT REFERENCES licitaciones(codigo) ON DELETE CASCADE,
  compra_agil_codigo TEXT REFERENCES compras_agiles(codigo) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'sugerida', -- sugerida|aprobada|enviada|fallida
  match_score NUMERIC(10,2),
  monto_oferta NUMERIC(15,2),
  oferta_id_mp TEXT,
  respuesta_mp JSONB,
  motivo TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK (estado IN ('sugerida','aprobada','enviada','fallida')),
  CHECK (licitacion_codigo IS NOT NULL OR compra_agil_codigo IS NOT NULL)
);

-- Unicidad por cliente + target (permite uno u otro)
CREATE UNIQUE INDEX IF NOT EXISTS ux_cliente_ofertas_cliente_licitacion
  ON cliente_ofertas(cliente_id, licitacion_codigo)
  WHERE licitacion_codigo IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_cliente_ofertas_cliente_compra_agil
  ON cliente_ofertas(cliente_id, compra_agil_codigo)
  WHERE compra_agil_codigo IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cliente_ofertas_estado
  ON cliente_ofertas(estado);

-- Migración segura (si la tabla ya existe en tu Supabase): agregar columnas faltantes
ALTER TABLE IF EXISTS cliente_ofertas
  ADD COLUMN IF NOT EXISTS compra_agil_codigo TEXT;
ALTER TABLE IF EXISTS cliente_ofertas
  ADD COLUMN IF NOT EXISTS match_score NUMERIC(10,2);
ALTER TABLE IF EXISTS cliente_ofertas
  ADD COLUMN IF NOT EXISTS monto_oferta NUMERIC(15,2);
ALTER TABLE IF EXISTS cliente_ofertas
  ADD COLUMN IF NOT EXISTS oferta_id_mp TEXT;
ALTER TABLE IF EXISTS cliente_ofertas
  ADD COLUMN IF NOT EXISTS respuesta_mp JSONB;

-- Payload que la extensión Chrome usará para autocompletar/postular en MercadoPúblico.
-- (No contiene credenciales; solo datos de la oferta).
ALTER TABLE IF EXISTS cliente_ofertas
  ADD COLUMN IF NOT EXISTS payload_postulacion JSONB;

-- =====================================================
-- ÍNDICES CLIENTE
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_cliente_inventario_cliente
  ON cliente_inventario(cliente_id);

CREATE INDEX IF NOT EXISTS idx_cliente_inventario_sku
  ON cliente_inventario(sku);

-- =====================================================
-- TRIGGERS updated_at para tablas cliente
-- =====================================================
DROP TRIGGER IF EXISTS update_clientes_updated_at ON clientes;
CREATE TRIGGER update_clientes_updated_at
  BEFORE UPDATE ON clientes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_cliente_inventario_updated_at ON cliente_inventario;
CREATE TRIGGER update_cliente_inventario_updated_at
  BEFORE UPDATE ON cliente_inventario
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_cliente_ofertas_updated_at ON cliente_ofertas;
CREATE TRIGGER update_cliente_ofertas_updated_at
  BEFORE UPDATE ON cliente_ofertas
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- VISTAS PARA DASHBOARD / CALENDARIO
-- =====================================================

-- Vista simple para listar todas las licitaciones (sin filtros “últimos 7 días”)
CREATE OR REPLACE VIEW licitaciones_all AS
SELECT
  l.*,
  COALESCE(l.finaliza_el, l.fecha_cierre_primer_llamado::text) AS cierre_raw
FROM licitaciones l
ORDER BY l.created_at DESC;

COMMENT ON VIEW licitaciones_all IS 'Listado completo de licitaciones (para dashboards que deben mostrar TODO)';

-- Eventos calendario (apertura/cierre) usando campos disponibles.
-- Nota: publicada_el/finaliza_el son strings ISO locales (YYYY-MM-DDTHH:MM:SS). Se castea a timestamp sin zona.
CREATE OR REPLACE VIEW calendario_eventos AS
SELECT
  l.codigo AS licitacion_codigo,
  l.titulo,
  'apertura'::text AS tipo,
  (l.publicada_el)::timestamp AS fecha,
  l.link_detalle
FROM licitaciones l
WHERE l.publicada_el IS NOT NULL AND l.publicada_el <> ''
UNION ALL
SELECT
  l.codigo AS licitacion_codigo,
  l.titulo,
  'cierre'::text AS tipo,
  (l.finaliza_el)::timestamp AS fecha,
  l.link_detalle
FROM licitaciones l
WHERE l.finaliza_el IS NOT NULL AND l.finaliza_el <> ''
ORDER BY fecha ASC;

COMMENT ON VIEW calendario_eventos IS 'Eventos (apertura/cierre) para vista calendario en el frontend';

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
  created_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE ordenes_compra IS 'Órdenes de compra (cabecera) para análisis histórico';

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
  created_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE ordenes_compra_items IS 'Detalle/líneas de órdenes de compra (para BI y análisis de precios)';

-- =====================================================
-- RLS (opcional): habilitar cuando se use Supabase Auth en frontend
-- =====================================================
-- ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE cliente_inventario ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE cliente_exclusiones ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE cliente_notificaciones ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE cliente_ofertas ENABLE ROW LEVEL SECURITY;
--
-- -- Políticas sugeridas (requieren user_id en clientes):
-- -- Clientes: el usuario puede ver/actualizar su cliente
-- CREATE POLICY "clientes_select_own" ON clientes FOR SELECT
--   USING (auth.uid() = user_id);
-- CREATE POLICY "clientes_update_own" ON clientes FOR UPDATE
--   USING (auth.uid() = user_id);
--
-- -- Inventario: el usuario puede ver/editar su inventario vía join a clientes
-- CREATE POLICY "cliente_inventario_select_own" ON cliente_inventario FOR SELECT
--   USING (EXISTS (SELECT 1 FROM clientes c WHERE c.id = cliente_inventario.cliente_id AND c.user_id = auth.uid()));
-- CREATE POLICY "cliente_inventario_upsert_own" ON cliente_inventario FOR INSERT
--   WITH CHECK (EXISTS (SELECT 1 FROM clientes c WHERE c.id = cliente_inventario.cliente_id AND c.user_id = auth.uid()));
-- CREATE POLICY "cliente_inventario_update_own" ON cliente_inventario FOR UPDATE
--   USING (EXISTS (SELECT 1 FROM clientes c WHERE c.id = cliente_inventario.cliente_id AND c.user_id = auth.uid()));

