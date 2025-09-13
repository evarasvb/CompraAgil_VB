"""
match_mercado_publico.py
-------------------------

Este módulo proporciona una interfaz de línea de comandos para ejecutar
el motor de coincidencias (`PriceMatcher`) sobre un archivo de descripciones
provenientes de Mercado Público. El objetivo es comparar cada
descripción contra el catálogo de productos del proveedor y generar un
listado de coincidencias con los precios netos y totales.

El script acepta como entrada un archivo Excel o CSV con una columna de
descripciones (por defecto "DESCRIPCION") y produce como salida un
archivo Excel con las coincidencias. Para cada descripción se incluyen
las mejores coincidencias (top‑N) junto con el nombre del producto, la
similitud (0–1), el precio neto y el precio total (con IVA).

Uso ejemplo::

    python match_mercado_publico.py \
        --input_file solicitudes_mp.xlsx \
        --description_column DESCRIPCION \
        --price_list_file price_list_normalized_brand.xlsx \
        --top_n 3 \
        --output_file resultados_match.xlsx

Para cargar los datos se utiliza pandas, por lo que el script es
compatible con archivos `.xlsx` y `.csv`. Si el archivo de entrada
contiene varias hojas, se utiliza la primera.
"""

from __future__ import annotations

import argparse
import os
from typing import List, Dict, Any

import pandas as pd

from agilvb_matcher import PriceMatcher


def read_input_file(path: str, description_col: str) -> List[str]:
    """Load an Excel or CSV file and extract item descriptions.

    Args:
        path: Path to the input file (.xlsx or .csv).
        description_col: Name of the column containing descriptions.

    Returns:
        A list of non-empty descriptions.

    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If the specified column is missing.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"Input file not found: {path}")
    # Determine extension
    ext = os.path.splitext(path)[1].lower()
    if ext == ".csv":
        df = pd.read_csv(path)
    else:
        # Default to Excel; load first sheet
        df = pd.read_excel(path)
    if description_col not in df.columns:
        raise ValueError(
            f"Column '{description_col}' not found in input file. Available columns: {list(df.columns)}"
        )
    descriptions = df[description_col].dropna().astype(str).tolist()
    return descriptions


def flatten_results(
    results: List[Dict[str, Any]],
    description_col: str,
) -> pd.DataFrame:
    """Transform nested match results into a flat DataFrame.

    Each row in the output corresponds to a single match for a given
    description. If multiple matches are requested (top‑N), each rank
    appears in una fila separada.

    Args:
        results: List of dictionaries returned by ``PriceMatcher.match_items``.
        description_col: Name to use for the original description column in the output.

    Returns:
        A pandas DataFrame with columns:
            description_col, match_rank, matched_product, score, net_price, total_price
    """
    rows: List[Dict[str, Any]] = []
    for item in results:
        description = item["item"]
        for rank, match in enumerate(item["matches"], start=1):
            rows.append({
                description_col: description,
                "match_rank": rank,
                "matched_product": match["product"],
                "score": match["score"],
                "net_price": match["net_price"],
                "total_price": match["total_price"],
            })
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Ejecuta el motor de coincidencias sobre un archivo de descripciones de Mercado Público "
            "y genera un reporte de coincidencias con precios."
        )
    )
    parser.add_argument("--input_file", required=True, help="Ruta al archivo de entrada (Excel o CSV) que contiene las descripciones de Mercado Público.")
    parser.add_argument(
        "--description_column",
        default="DESCRIPCION",
        help="Nombre de la columna con las descripciones a comparar (por defecto DESCRIPCION).",
    )
    parser.add_argument(
        "--price_list_file",
        default="price_list_normalized_brand.xlsx",
        help="Archivo Excel con el catálogo de precios normalizado. Por defecto se usa price_list_normalized_brand.xlsx.",
    )
    parser.add_argument(
        "--top_n",
        type=int,
        default=3,
        help="Número de coincidencias a devolver por cada descripción (por defecto 3).",
    )
    parser.add_argument(
        "--output_file",
        required=True,
        help="Ruta del archivo Excel de salida donde se guardarán las coincidencias.",
    )

    args = parser.parse_args()

    # Load descriptions
    descriptions = read_input_file(args.input_file, args.description_column)
    if not descriptions:
        print("No se encontraron descripciones en el archivo de entrada.")
        return

    # Initialize matcher
    matcher = PriceMatcher(args.price_list_file)
    # Perform matching
    results = matcher.match_items(descriptions, top_n=args.top_n)

    # Convert to flat DataFrame and save
    df_out = flatten_results(results, args.description_column)
    # Ensure output directory exists
    output_dir = os.path.dirname(args.output_file)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)
    df_out.to_excel(args.output_file, index=False)
    print(f"Se han guardado {len(df_out)} filas de coincidencias en {args.output_file}")


if __name__ == "__main__":
    main()