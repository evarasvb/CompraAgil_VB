#!/usr/bin/env python3
"""
Command-line interface for the AgilVB price matching engine.

This script allows you to match arbitrary product descriptions against a
vendor's catalogue stored in an Excel workbook or directly from Supabase.
It leverages the ``PriceMatcher`` class from the ``agilvb_matcher`` module
to perform keyword filtering and fuzzy string matching.

Usage examples::

    # Modo Excel (tradicional)
    python run_matcher.py Lista_de_Precios.xlsx "ESCRITORIO 2 CAJONES" \
        "CAJONERA OFICINA GABINETE CON LLAVE Y RUEDAS" --top 3

    # Modo base de datos (Supabase)
    python run_matcher.py --mode=db --days=1

This will print the top three catalogue matches for each provided
description, along with similarity scores and computed net/total prices.
"""

import argparse
import sys
from agilvb_matcher import PriceMatcher


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Match one or more item descriptions against a price list. "
            "Supports both Excel files and direct database mode (Supabase)."
        )
    )
    parser.add_argument(
        "--mode",
        choices=["excel", "db"],
        default="excel",
        help="Modo de operación: 'excel' para archivos Excel, 'db' para base de datos Supabase (default: excel)",
    )
    parser.add_argument(
        "price_file",
        nargs="?",
        help="Path to the Excel file containing the catalogue (required for --mode=excel)",
    )
    parser.add_argument(
        "items",
        nargs="*",
        help="One or more item descriptions to match against the catalogue (required for --mode=excel)",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=5,
        help="Number of top matches to return for each item (default: 5)",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=1,
        help="Número de días hacia atrás para buscar licitaciones en modo DB (default: 1)",
    )
    parser.add_argument(
        "--min-confidence",
        type=float,
        default=0.5,
        help="Score mínimo de confianza para considerar un match válido en modo DB (default: 0.5)",
    )

    args = parser.parse_args()

    if args.mode == "db":
        # Modo base de datos: delegar a matcher_db_adapter
        try:
            from matcher_db_adapter import (
                get_db_connection,
                load_productos_from_db,
                load_licitacion_items_pending,
                process_matching,
            )
            from agilvb_matcher import PriceMatcher
            import tempfile
            import openpyxl
            import os
            
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
            
            # Preparar catálogo para PriceMatcher
            temp_catalog = productos_df.copy()
            if 'PRODUCTO' not in temp_catalog.columns:
                if 'nombre_interno' in temp_catalog.columns:
                    temp_catalog['PRODUCTO'] = temp_catalog['nombre_interno']
                else:
                    raise ValueError("No se encontró la columna 'PRODUCTO' o 'nombre_interno'")
            
            if 'precio venta Neto' not in temp_catalog.columns:
                if 'costo_neto' in temp_catalog.columns:
                    temp_catalog['precio venta Neto'] = temp_catalog['costo_neto']
                else:
                    raise ValueError("No se encontró la columna 'precio venta Neto' o 'costo_neto'")
            
            if 'SKU' not in temp_catalog.columns:
                temp_catalog['SKU'] = productos_df.get('SKU', productos_df.index)
            
            # Crear archivo Excel temporal
            temp_file = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
            temp_file.close()
            temp_catalog[['PRODUCTO', 'precio venta Neto', 'SKU']].to_excel(temp_file.name, index=False)
            
            # Inicializar matcher
            matcher = PriceMatcher(temp_file.name)
            matcher.catalog_with_sku = temp_catalog[['PRODUCTO', 'SKU']].copy()
            
            # Cargar items pendientes (solo compras ágiles)
            print(f"🔍 Buscando items de COMPRAS ÁGILES pendientes de matching (últimos {args.days} días)...")
            items_df = load_licitacion_items_pending(conn, days=args.days)
            print(f"✅ Encontrados {len(items_df)} items de compras ágiles pendientes")
            
            if items_df.empty:
                print("✅ No hay items pendientes de matching.")
                conn.close()
                os.unlink(temp_file.name)
                return
            
            # Procesar matching
            print("🔄 Procesando matching...")
            stats = process_matching(conn, matcher, items_df, min_confidence=args.min_confidence)
            
            # Mostrar estadísticas
            print("\n📊 Estadísticas:")
            print(f"   Total items procesados: {stats['total_items']}")
            print(f"   ✅ Matches exitosos: {stats['matched']}")
            print(f"   ❌ Sin matches: {stats['no_match']}")
            print(f"   ⚠️  Baja confianza: {stats['low_confidence']}")
            print(f"   🔴 Errores: {stats['errors']}")
            
            # Limpiar
            conn.close()
            os.unlink(temp_file.name)
            print("\n✅ Proceso completado")
            
        except ImportError as e:
            print(f"❌ Error: No se pudo importar módulos necesarios: {e}")
            print("   Asegúrate de tener instaladas las dependencias: pandas, psycopg2-binary, openpyxl")
            sys.exit(1)
        except Exception as e:
            print(f"❌ Error ejecutando matcher en modo DB: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)
    else:
        # Modo Excel (tradicional)
        if not args.price_file:
            parser.error("price_file es requerido en modo excel")
        if not args.items:
            parser.error("Al menos un item description es requerido en modo excel")

        matcher = PriceMatcher(args.price_file)

        for description in args.items:
            result = matcher.match_item(description, top_n=args.top)
            print(f"\nMatches for: {result['item']}")
            for match in result["matches"]:
                product = match["product"]
                score = match["score"]
                net_price = match["net_price"]
                total_price = match["total_price"]
                print(
                    f"  {product} | score: {score:.2f} | "
                    f"net price: {net_price:.2f} | total price: {total_price:.2f}"
                )


if __name__ == "__main__":
    main()
