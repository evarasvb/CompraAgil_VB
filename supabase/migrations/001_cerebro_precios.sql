-- Migración: Cerebro de Precios
-- Descripción: Crea las tablas necesarias para el cálculo de márgenes y configuración global
-- Fecha: 2025-01-XX

-- Tabla producto_maestro: Catálogo de productos con costos y precios
CREATE TABLE IF NOT EXISTS producto_maestro (
    sku TEXT PRIMARY KEY,
    nombre_interno TEXT NOT NULL,
    costo_neto NUMERIC NOT NULL,
    precio_venta_sugerido NUMERIC,
    familia TEXT,
    palabras_clave TEXT[],
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla configuracion_global: Configuraciones flexibles del sistema
CREATE TABLE IF NOT EXISTS configuracion_global (
    clave TEXT PRIMARY KEY,
    valor JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla match_correcciones: Aprendizaje de correcciones manuales
CREATE TABLE IF NOT EXISTS match_correcciones (
    id SERIAL PRIMARY KEY,
    descripcion_mp TEXT NOT NULL,
    sku_correcto TEXT NOT NULL REFERENCES producto_maestro(sku) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_producto_maestro_familia ON producto_maestro(familia);
CREATE INDEX IF NOT EXISTS idx_producto_maestro_palabras_clave ON producto_maestro USING GIN(palabras_clave);
CREATE INDEX IF NOT EXISTS idx_match_correcciones_descripcion ON match_correcciones(descripcion_mp);
CREATE INDEX IF NOT EXISTS idx_match_correcciones_sku ON match_correcciones(sku_correcto);

-- Habilitar Row Level Security (RLS) en todas las tablas
ALTER TABLE producto_maestro ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_global ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_correcciones ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para producto_maestro
-- Permitir SELECT, INSERT, UPDATE a usuarios autenticados y service_role
CREATE POLICY IF NOT EXISTS "producto_maestro_select_authenticated"
    ON producto_maestro FOR SELECT
    TO authenticated, service_role
    USING (true);

CREATE POLICY IF NOT EXISTS "producto_maestro_insert_authenticated"
    ON producto_maestro FOR INSERT
    TO authenticated, service_role
    WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "producto_maestro_update_authenticated"
    ON producto_maestro FOR UPDATE
    TO authenticated, service_role
    USING (true)
    WITH CHECK (true);

-- Políticas RLS para configuracion_global
CREATE POLICY IF NOT EXISTS "configuracion_global_select_authenticated"
    ON configuracion_global FOR SELECT
    TO authenticated, service_role
    USING (true);

CREATE POLICY IF NOT EXISTS "configuracion_global_insert_authenticated"
    ON configuracion_global FOR INSERT
    TO authenticated, service_role
    WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "configuracion_global_update_authenticated"
    ON configuracion_global FOR UPDATE
    TO authenticated, service_role
    USING (true)
    WITH CHECK (true);

-- Políticas RLS para match_correcciones
CREATE POLICY IF NOT EXISTS "match_correcciones_select_authenticated"
    ON match_correcciones FOR SELECT
    TO authenticated, service_role
    USING (true);

CREATE POLICY IF NOT EXISTS "match_correcciones_insert_authenticated"
    ON match_correcciones FOR INSERT
    TO authenticated, service_role
    WITH CHECK (true);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para actualizar updated_at
CREATE TRIGGER IF NOT EXISTS update_producto_maestro_updated_at
    BEFORE UPDATE ON producto_maestro
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER IF NOT EXISTS update_configuracion_global_updated_at
    BEFORE UPDATE ON configuracion_global
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Agregar columnas de matching a licitacion_items (si la tabla existe)
-- Estas columnas almacenan los resultados del matching automático
DO $$
BEGIN
    -- Agregar match_sku si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'licitacion_items' AND column_name = 'match_sku'
    ) THEN
        ALTER TABLE licitacion_items ADD COLUMN match_sku TEXT;
    END IF;

    -- Agregar costo_unitario si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'licitacion_items' AND column_name = 'costo_unitario'
    ) THEN
        ALTER TABLE licitacion_items ADD COLUMN costo_unitario NUMERIC;
    END IF;

    -- Agregar margen_estimado si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'licitacion_items' AND column_name = 'margen_estimado'
    ) THEN
        ALTER TABLE licitacion_items ADD COLUMN margen_estimado NUMERIC;
    END IF;

    -- Agregar confidence_score si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'licitacion_items' AND column_name = 'confidence_score'
    ) THEN
        ALTER TABLE licitacion_items ADD COLUMN confidence_score NUMERIC;
    END IF;

    -- Agregar fecha_match si no existe (para tracking)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'licitacion_items' AND column_name = 'fecha_match'
    ) THEN
        ALTER TABLE licitacion_items ADD COLUMN fecha_match TIMESTAMPTZ;
    END IF;
END $$;

-- Crear índice para búsquedas eficientes de items sin match
CREATE INDEX IF NOT EXISTS idx_licitacion_items_match_sku_null 
    ON licitacion_items(licitacion_codigo, item_index) 
    WHERE match_sku IS NULL;

-- Insertar configuración inicial de margen mínimo (ejemplo)
INSERT INTO configuracion_global (clave, valor)
VALUES ('margen_minimo', '{"valor": 0.15, "descripcion": "Margen mínimo permitido (15%)"}')
ON CONFLICT (clave) DO NOTHING;

-- Comentarios en las tablas
COMMENT ON TABLE producto_maestro IS 'Catálogo maestro de productos con costos y precios';
COMMENT ON TABLE configuracion_global IS 'Configuraciones globales del sistema en formato JSONB';
COMMENT ON TABLE match_correcciones IS 'Correcciones manuales de matching para aprendizaje';
