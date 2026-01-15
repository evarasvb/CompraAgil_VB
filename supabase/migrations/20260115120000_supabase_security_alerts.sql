-- Ajustes de seguridad para alertas Supabase (FirmaVB)

-- 1) Vistas: forzar SECURITY INVOKER
ALTER VIEW IF EXISTS public.bi_oc_negocios_por_proveedor SET (security_invoker = true);
ALTER VIEW IF EXISTS public.oc_enriquecidas SET (security_invoker = true);
ALTER VIEW IF EXISTS public.dashboard_estado SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_asignaciones_detalle SET (security_invoker = true);
ALTER VIEW IF EXISTS public.bi_oc_precios_producto_proveedor SET (security_invoker = true);
ALTER VIEW IF EXISTS public.calendario_eventos SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_calendario_vendedor SET (security_invoker = true);
ALTER VIEW IF EXISTS public.bi_oc_negocios_por_institucion SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_reporte_equipo SET (security_invoker = true);
ALTER VIEW IF EXISTS public.oportunidades_all SET (security_invoker = true);
ALTER VIEW IF EXISTS public.licitaciones_urgentes SET (security_invoker = true);
ALTER VIEW IF EXISTS public.compras_agiles_con_institucion SET (security_invoker = true);
ALTER VIEW IF EXISTS public.licitaciones_con_match SET (security_invoker = true);
ALTER VIEW IF EXISTS public.bi_oc_productos SET (security_invoker = true);
ALTER VIEW IF EXISTS public.licitaciones_all SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_vendedor_dashboard SET (security_invoker = true);
ALTER VIEW IF EXISTS public.instituciones_dashboard SET (security_invoker = true);
ALTER VIEW IF EXISTS public.users_dashboard SET (security_invoker = true);

-- 2) Funciones: fijar search_path explícito
DO $$
DECLARE
  func_oid oid;
BEGIN
  FOR func_oid IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'check_match_encontrado',
        'get_user_role',
        'create_user_extended',
        'buscar_licitaciones',
        'match_licitacion_con_categorias',
        'update_updated_at_column'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = public, extensions',
      func_oid::regprocedure
    );
  END LOOP;
END $$;

-- 3) RLS: reemplazar USING(true) por auth.uid() IS NOT NULL
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, qual
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'cliente_exclusiones',
        'cliente_inventario',
        'cliente_notificaciones'
      )
      AND (qual = 'true' OR qual = '(true)')
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON %I.%I USING (auth.uid() IS NOT NULL)',
      pol.policyname,
      pol.schemaname,
      pol.tablename
    );
  END LOOP;
END $$;
