#!/usr/bin/env python3
"""
matcher_db_adapter.py
---------------------

Adaptador para ejecutar el motor de matching (PriceMatcher) directamente
contra la base de datos Supabase, en lugar de leer desde archivos Excel.

Este módulo:
1. Se conecta a Supabase usando la URL de conexión directa de PostgreSQL
2. Descarga productos desde la tabla producto_maestro
3. Descarga licitaciones recientes desde licitacion_items donde match_sku sea NULL
4. Ejecuta la lógica de fuzzy matching existente
5. Actualiza licitacion_items con: match_sku, costo_unitario, margen_estimado, confidence_score

Uso:
    python matcher_db_adapter.py --days 1
    python matcher_db_adapter.py --mode db
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from urllib.parse import urlparse

import pandas as pd
import psycopg2
from psycopg2.extras import RealDictCursor

from agilvb_matcher import PriceMatcher


def get_db_connection() -> psycopg2.extensions.connection:
    """Obtiene una conexión a la base de datos Supabase.
    
    Lee la variable de entorno SUPABASE_DB_URL que debe tener el formato:
    postgresql://postgres:[password]@[host]:[port]/postgres
    
    Returns:
        Conexión a PostgreSQL.
        
    Raises:
        ValueError: Si SUPABASE_DB_URL no está configurada.
        psycopg2.Error: Si la conexión falla.
    """
    db_url = os.environ.get('SUPABASE_DB_URL')
    if not db_url:
        # Intentar construir desde SUPABASE_URL si está disponible
        supabase_url = os.environ.get('SUPABASE_URL')
        if supabase_url:
            # Extraer el host de la URL de Supabase
            parsed = urlparse(supabase_url)
            host = parsed.hostname
            if host:
                # Asumir formato estándar de Supabase
                db_url = f"postgresql://postgres:[password]@{host}:5432/postgres"
                print("⚠️  ADVERTENCIA: SUPABASE_DB_URL no está configurada.")
                print("   Necesitas configurar SUPABASE_DB_URL con la conexión directa a PostgreSQL.")
                print("   Formato: postgresql://postgres:[password]@[host]:5432/postgres")
                raise ValueError("SUPABASE_DB_URL no configurada")
        else:
            raise ValueError(
                "SUPABASE_DB_URL no está configurada. "
                "Configúrala con la URL de conexión directa a PostgreSQL de Supabase."
            )
    
    return psycopg2.connect(db_url)


def load_productos_from_db(conn: psycopg2.extensions.connection) -> pd.DataFrame:
    """Carga productos desde la tabla producto_maestro.
    
    Args:
        conn: Conexión a la base de datos.
        
    Returns:
        DataFrame con columnas: PRODUCTO (nombre_interno), precio venta Neto (costo_neto),
        y SKU (sku). Compatible con PriceMatcher.
    """
    query = """
        SELECT 
            sku as SKU,
            nombre_interno as PRODUCTO,
            costo_neto as "precio venta Neto",
            precio_venta_sugerido,
            familia,
            palabras_clave
        FROM producto_maestro
        ORDER BY sku
    """
    
    df = pd.read_sql_query(query, conn)
    
    # Si hay precio_venta_sugerido, usarlo como precio de venta neto
    if 'precio_venta_sugerido' in df.columns:
        df['precio venta Neto'] = df['precio_venta_sugerido'].fillna(df['precio venta Neto'])
    
    return df


def load_licitacion_items_pending(conn: psycopg2.extensions.connection, days: int = 1) -> pd.DataFrame:
    """Carga items de COMPRAS ÁGILES pendientes de matching.
    
    Nota: Este adaptador procesa solo compras ágiles extraídas por el scraper
    de MercadoPúblico desde la URL /compra-agil. El scraper solo inserta compras
    ágiles en las tablas licitaciones y licitacion_items.
    
    Args:
        conn: Conexión a la base de datos.
        days: Número de días hacia atrás para buscar licitaciones (por defecto 1).
        
    Returns:
        DataFrame con los items pendientes de matching (solo compras ágiles).
    """
    cutoff_date = datetime.now() - timedelta(days=days)
    
    # Consulta que filtra solo compras ágiles recientes
    # El scraper solo extrae compras ágiles, así que todas las licitaciones
    # en la tabla deberían ser compras ágiles, pero filtramos por fecha reciente
    query = """
        SELECT 
            li.licitacion_codigo,
            li.item_index,
            -- Combinar nombre y descripción para mejor matching
            -- IMPORTANTE: La institución hace un listado de peticiones de productos.
            -- Necesitamos hacer match contra CADA producto del listado, no solo el nombre de la compra.
            -- Combinamos nombre + descripción para tener el contexto completo de cada producto solicitado.
            TRIM(CONCAT(
                COALESCE(li.nombre, ''),
                CASE WHEN li.descripcion IS NOT NULL AND li.descripcion != '' 
                     AND li.descripcion != li.nombre  -- Evitar duplicar si son iguales
                     THEN ' ' || li.descripcion 
                     ELSE '' 
                END
            )) as descripcion_completa,
            li.nombre,
            li.descripcion,
            li.cantidad,
            li.unidad
        FROM licitacion_items li
        INNER JOIN licitaciones l ON li.licitacion_codigo = l.codigo
        WHERE li.match_sku IS NULL
          AND (
            -- Filtrar por fecha de publicación (formato texto ISO local)
            l.publicada_el >= %s::text
            OR 
            -- O por fecha de extracción (timestamp)
            l.fecha_extraccion >= %s
          )
        ORDER BY li.licitacion_codigo, li.item_index
    """
    
    df = pd.read_sql_query(query, conn, params=[cutoff_date.strftime('%Y-%m-%d'), cutoff_date])
    return df


def update_match_results(
    conn: psycopg2.extensions.connection,
    licitacion_codigo: str,
    item_index: int,
    match_sku: Optional[str],
    costo_unitario: Optional[float],
    margen_estimado: Optional[float],
    confidence_score: Optional[float],
) -> None:
    """Actualiza un item de licitación con los resultados del matching.
    
    Args:
        conn: Conexión a la base de datos.
        licitacion_codigo: Código de la licitación.
        item_index: Índice del item.
        match_sku: SKU del producto encontrado (None si no hay match).
        costo_unitario: Costo unitario del producto.
        margen_estimado: Margen estimado (0-1).
        confidence_score: Score de confianza del match (0-1).
    """
    cursor = conn.cursor()
    
    query = """
        UPDATE licitacion_items
        SET 
            match_sku = %s,
            costo_unitario = %s,
            margen_estimado = %s,
            confidence_score = %s,
            fecha_match = NOW()
        WHERE licitacion_codigo = %s
          AND item_index = %s
    """
    
    cursor.execute(
        query,
        (match_sku, costo_unitario, margen_estimado, confidence_score, licitacion_codigo, item_index)
    )
    conn.commit()
    cursor.close()


def calculate_margen(costo: float, precio_venta: float) -> float:
    """Calcula el margen como porcentaje.
    
    Args:
        costo: Costo del producto.
        precio_venta: Precio de venta.
        
    Returns:
        Margen como decimal (0.15 = 15%).
    """
    if precio_venta <= 0:
        return 0.0
    return (precio_venta - costo) / precio_venta


def process_matching(
    conn: psycopg2.extensions.connection,
    matcher: PriceMatcher,
    items_df: pd.DataFrame,
    min_confidence: float = 0.5,
) -> Dict[str, Any]:
    """Procesa el matching de items contra el catálogo.
    
    Args:
        conn: Conexión a la base de datos.
        matcher: Instancia de PriceMatcher configurada.
        items_df: DataFrame con items pendientes de matching.
        min_confidence: Score mínimo para considerar un match válido.
        
    Returns:
        Diccionario con estadísticas del procesamiento.
    """
    stats = {
        'total_items': len(items_df),
        'matched': 0,
        'no_match': 0,
        'low_confidence': 0,
        'errors': 0,
    }
    
    for _, row in items_df.iterrows():
        try:
            descripcion = row['descripcion_completa']
            if not descripcion or len(descripcion.strip()) == 0:
                stats['no_match'] += 1
                continue
            
            # Ejecutar matching
            result = matcher.match_item(descripcion, top_n=1)
            
            if not result['matches']:
                # No hay matches
                update_match_results(
                    conn, row['licitacion_codigo'], row['item_index'],
                    None, None, None, 0.0
                )
                stats['no_match'] += 1
                continue
            
            # Tomar el mejor match
            best_match = result['matches'][0]
            score = best_match['score']
            
            if score < min_confidence:
                # Score muy bajo
                update_match_results(
                    conn, row['licitacion_codigo'], row['item_index'],
                    None, None, None, score
                )
                stats['low_confidence'] += 1
                continue
            
            # Obtener el SKU del producto (necesitamos buscarlo en el catálogo)
            # El matcher devuelve el nombre del producto, necesitamos el SKU
            producto_nombre = best_match['product']
            costo_neto = best_match['net_price']
            precio_venta = best_match['total_price']
            
            # Buscar el SKU en el catálogo original
            # Usar el catálogo con SKU que guardamos al inicializar
            if hasattr(matcher, 'catalog_with_sku'):
                producto_row = matcher.catalog_with_sku[matcher.catalog_with_sku['PRODUCTO'] == producto_nombre]
            else:
                # Fallback: buscar en el DataFrame del matcher
                catalog_df = matcher.df
                producto_row = catalog_df[catalog_df['PRODUCTO'] == producto_nombre]
            
            if producto_row.empty:
                # No encontramos el SKU (no debería pasar, pero por seguridad)
                update_match_results(
                    conn, row['licitacion_codigo'], row['item_index'],
                    None, costo_neto, None, score
                )
                stats['errors'] += 1
                continue
            
            # Obtener el SKU
            if hasattr(matcher, 'catalog_with_sku'):
                sku = producto_row.iloc[0]['SKU']
            else:
                sku = producto_row.iloc[0].get('SKU', None)
                if sku is None or pd.isna(sku):
                    # Intentar usar el índice
                    sku = producto_row.index[0] if not producto_row.empty else None
            
            # Calcular margen
            margen = calculate_margen(costo_neto, precio_venta)
            
            # Actualizar en la base de datos
            update_match_results(
                conn, row['licitacion_codigo'], row['item_index'],
                str(sku) if sku else None,
                float(costo_neto),
                float(margen),
                float(score)
            )
            
            stats['matched'] += 1
            
        except Exception as e:
            print(f"Error procesando item {row['licitacion_codigo']}/{row['item_index']}: {e}")
            stats['errors'] += 1
            continue
    
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Ejecuta el motor de matching contra la base de datos Supabase. "
            "Procesa items de licitaciones pendientes y actualiza los resultados."
        )
    )
    parser.add_argument(
        "--days",
        type=int,
        default=1,
        help="Número de días hacia atrás para buscar licitaciones (por defecto: 1)",
    )
    parser.add_argument(
        "--min-confidence",
        type=float,
        default=0.5,
        help="Score mínimo de confianza para considerar un match válido (por defecto: 0.5)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Solo mostrar estadísticas sin actualizar la base de datos",
    )
    
    args = parser.parse_args()
    
    # Validar variables de entorno
    if not os.environ.get('SUPABASE_DB_URL'):
        print("❌ Error: SUPABASE_DB_URL no está configurada.")
        print("   Configúrala con la URL de conexión directa a PostgreSQL de Supabase.")
        print("   Formato: postgresql://postgres:[password]@[host]:5432/postgres")
        sys.exit(1)
    
    try:
        # Conectar a la base de datos
        print("🔌 Conectando a Supabase...")
        conn = get_db_connection()
        print("✅ Conexión establecida")
        
        # Cargar productos
        print("📦 Cargando productos desde producto_maestro...")
        productos_df = load_productos_from_db(conn)
        print(f"✅ Cargados {len(productos_df)} productos")
        
        if productos_df.empty:
            print("⚠️  No hay productos en la base de datos. Asegúrate de haber cargado el catálogo.")
            conn.close()
            sys.exit(1)
        
        # Crear un DataFrame temporal compatible con PriceMatcher
        # PriceMatcher espera un Excel con columnas 'PRODUCTO' y 'precio venta Neto'
        temp_catalog = productos_df.copy()
        
        # Asegurar que tenemos las columnas necesarias en el formato correcto
        # PriceMatcher necesita: PRODUCTO, precio venta Neto
        if 'PRODUCTO' not in temp_catalog.columns:
            if 'nombre_interno' in temp_catalog.columns:
                temp_catalog['PRODUCTO'] = temp_catalog['nombre_interno']
            else:
                raise ValueError("No se encontró la columna 'PRODUCTO' o 'nombre_interno' en producto_maestro")
        
        if 'precio venta Neto' not in temp_catalog.columns:
            if 'costo_neto' in temp_catalog.columns:
                temp_catalog['precio venta Neto'] = temp_catalog['costo_neto']
            else:
                raise ValueError("No se encontró la columna 'precio venta Neto' o 'costo_neto' en producto_maestro")
        
        # Guardar SKU para referencia posterior
        if 'SKU' not in temp_catalog.columns:
            temp_catalog['SKU'] = productos_df.get('SKU', productos_df.index)
        
        # Crear archivo Excel temporal para PriceMatcher
        import tempfile
        import openpyxl
        temp_file = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
        temp_file.close()
        
        # Guardar solo las columnas necesarias para PriceMatcher
        temp_catalog[['PRODUCTO', 'precio venta Neto', 'SKU']].to_excel(temp_file.name, index=False)
        
        # Inicializar matcher
        matcher = PriceMatcher(temp_file.name)
        
        # Guardar referencia al catálogo completo con SKU para uso posterior
        matcher.catalog_with_sku = temp_catalog[['PRODUCTO', 'SKU']].copy()
        
        # Cargar items pendientes (solo compras ágiles)
        print(f"🔍 Buscando items de COMPRAS ÁGILES pendientes de matching (últimos {args.days} días)...")
        items_df = load_licitacion_items_pending(conn, days=args.days)
        print(f"✅ Encontrados {len(items_df)} items de compras ágiles pendientes")
        
        if items_df.empty:
            print("✅ No hay items pendientes de matching.")
            conn.close()
            return
        
        # Procesar matching
        print("🔄 Procesando matching...")
        if args.dry_run:
            print("🔍 Modo dry-run: no se actualizará la base de datos")
            # Simular matching sin actualizar
            stats = {'total_items': len(items_df), 'matched': 0, 'no_match': 0, 'low_confidence': 0, 'errors': 0}
            for _, row in items_df.iterrows():
                descripcion = row['descripcion_completa']
                if descripcion:
                    result = matcher.match_item(descripcion, top_n=1)
                    if result['matches'] and result['matches'][0]['score'] >= args.min_confidence:
                        stats['matched'] += 1
                    else:
                        stats['no_match'] += 1
        else:
            stats = process_matching(conn, matcher, items_df, min_confidence=args.min_confidence)
        
        # Mostrar estadísticas
        print("\n📊 Estadísticas:")
        print(f"   Total items procesados: {stats['total_items']}")
        print(f"   ✅ Matches exitosos: {stats['matched']}")
        print(f"   ❌ Sin matches: {stats['no_match']}")
        print(f"   ⚠️  Baja confianza: {stats['low_confidence']}")
        print(f"   🔴 Errores: {stats['errors']}")
        
        # Limpiar archivo temporal
        try:
            os.unlink(temp_file.name)
        except:
            pass
        
        conn.close()
        print("\n✅ Proceso completado")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
