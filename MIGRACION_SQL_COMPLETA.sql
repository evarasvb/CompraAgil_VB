-- =============================================
-- MIGRACIÓN: Agregar costo_neto y margen_comercial
-- =============================================
-- INSTRUCCIONES:
-- 1. Copia TODO este archivo
-- 2. Ve a Supabase Dashboard → SQL Editor
-- 3. Pega y ejecuta
-- =============================================

-- Agregar costo_neto a inventory (obligatorio para nuevos productos)
DO $$
BEGIN
    -- Agregar costo_neto si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'inventory' 
        AND column_name = 'costo_neto'
    ) THEN
        ALTER TABLE public.inventory 
        ADD COLUMN costo_neto NUMERIC DEFAULT 0;
        
        -- Actualizar productos existentes: si no tienen costo, usar 80% del precio como estimación
        UPDATE public.inventory 
        SET costo_neto = precio_unitario * 0.8 
        WHERE costo_neto = 0 OR costo_neto IS NULL;
        
        -- Hacer el campo NOT NULL después de actualizar valores
        ALTER TABLE public.inventory 
        ALTER COLUMN costo_neto SET NOT NULL;
        
        -- Agregar comentario
        COMMENT ON COLUMN public.inventory.costo_neto IS 'Costo de adquisición del producto (obligatorio)';
    END IF;
END $$;

-- Agregar margen_comercial a inventory (calculado automáticamente)
DO $$
BEGIN
    -- Agregar margen_comercial si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'inventory' 
        AND column_name = 'margen_comercial'
    ) THEN
        ALTER TABLE public.inventory 
        ADD COLUMN margen_comercial NUMERIC;
        
        -- Calcular margen para productos existentes: (precio - costo) / precio * 100
        UPDATE public.inventory 
        SET margen_comercial = CASE 
            WHEN precio_unitario > 0 AND costo_neto >= 0 AND costo_neto < precio_unitario 
            THEN ROUND(((precio_unitario - costo_neto) / precio_unitario * 100)::numeric, 2)
            ELSE 0
        END
        WHERE margen_comercial IS NULL;
        
        -- Agregar comentario
        COMMENT ON COLUMN public.inventory.margen_comercial IS 'Margen comercial calculado: (precio - costo) / precio * 100';
    END IF;
END $$;

-- Agregar regiones_config a user_settings (para configuración de regiones con recargo)
DO $$
BEGIN
    -- Agregar regiones_config si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'user_settings' 
        AND column_name = 'regiones_config'
    ) THEN
        ALTER TABLE public.user_settings 
        ADD COLUMN regiones_config JSONB DEFAULT '[]'::jsonb;
        
        -- Migrar datos de regions a regiones_config si existe regions
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'user_settings' 
            AND column_name = 'regions'
        ) THEN
            -- Migrar regions existentes a regiones_config
            UPDATE public.user_settings
            SET regiones_config = (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'nombre', region,
                        'activa', true,
                        'recargo_porcentaje', 0
                    )
                )
                FROM jsonb_array_elements_text(regions::jsonb) AS region
            )
            WHERE regions IS NOT NULL 
            AND regions::text != '[]'::text
            AND (regiones_config IS NULL OR regiones_config::text = '[]'::text);
        END IF;
        
        -- Agregar comentario
        COMMENT ON COLUMN public.user_settings.regiones_config IS 'Configuración de regiones con recargos: [{"nombre": "Metropolitana", "activa": true, "recargo_porcentaje": 0}]';
    END IF;
END $$;

-- Crear función para calcular margen comercial automáticamente
CREATE OR REPLACE FUNCTION calcular_margen_comercial(
    precio_unitario NUMERIC,
    costo_neto NUMERIC
) RETURNS NUMERIC AS $$
BEGIN
    IF precio_unitario IS NULL OR precio_unitario <= 0 THEN
        RETURN NULL;
    END IF;
    
    IF costo_neto IS NULL OR costo_neto < 0 THEN
        RETURN NULL;
    END IF;
    
    IF costo_neto >= precio_unitario THEN
        RETURN 0;
    END IF;
    
    RETURN ROUND(((precio_unitario - costo_neto) / precio_unitario * 100)::numeric, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Crear trigger para actualizar margen_comercial automáticamente
CREATE OR REPLACE FUNCTION update_margen_comercial_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.precio_unitario IS NOT NULL AND NEW.costo_neto IS NOT NULL THEN
        NEW.margen_comercial = calcular_margen_comercial(NEW.precio_unitario, NEW.costo_neto);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear trigger si no existe
DROP TRIGGER IF EXISTS trigger_update_margen_comercial ON public.inventory;
CREATE TRIGGER trigger_update_margen_comercial
    BEFORE INSERT OR UPDATE OF precio_unitario, costo_neto ON public.inventory
    FOR EACH ROW
    EXECUTE FUNCTION update_margen_comercial_trigger();

-- Índice para búsquedas por margen
CREATE INDEX IF NOT EXISTS idx_inventory_margen_comercial 
    ON public.inventory(margen_comercial) 
    WHERE margen_comercial IS NOT NULL;

-- Comentarios finales
COMMENT ON FUNCTION calcular_margen_comercial IS 'Calcula el margen comercial: (precio - costo) / precio * 100';
COMMENT ON FUNCTION update_margen_comercial_trigger IS 'Trigger que actualiza margen_comercial automáticamente cuando cambia precio o costo';

-- =============================================
-- VERIFICACIÓN (opcional - ejecuta para verificar)
-- =============================================
-- SELECT 
--     column_name, 
--     data_type, 
--     is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'inventory' 
-- AND column_name IN ('costo_neto', 'margen_comercial')
-- ORDER BY column_name;
-- =============================================
