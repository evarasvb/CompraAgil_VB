"""
match_compra_agil.py
---------------------

CLI para ejecutar el motor de coincidencias (PriceMatcher) con entradas
propias de Compra Ágil. Lee un archivo Excel/CSV con al menos una columna de
descripción y opcionalmente una columna de cantidad. Devuelve un Excel con las
mejores coincidencias (top‑N) incluyendo precio unitario neto, precio total con
IVA y totales extendidos por cantidad.

Uso ejemplo::

    python match_compra_agil.py \
        --input_file solicitudes_compra_agil.xlsx \
        --description_column DESCRIPCION \
        --quantity_column CANTIDAD \
        --price_list_file price_list_normalized_brand.xlsx \
        --top_n 3 \
        --output_file resultados_match_compra_agil.xlsx

"""

from __future__ import annotations

import argparse
import os
from typing import List, Dict, Any, Optional

import pandas as pd

from agilvb_matcher import PriceMatcher


def read_input_file(path: str, description_col: str, quantity_col: Optional[str]) -> pd.DataFrame:
    """Carga un Excel/CSV y devuelve un DataFrame con descripciones y cantidades.

    La columna de descripción es obligatoria; la de cantidad es opcional.
    Si la cantidad no está, se asume 1.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"Input file not found: {path}")
    ext = os.path.splitext(path)[1].lower()
    if ext == ".csv":
        df = pd.read_csv(path)
    else:
        df = pd.read_excel(path)
    if description_col not in df.columns:
        raise ValueError(
            f"Column '{description_col}' not found in input file. Available columns: {list(df.columns)}"
        )
    out = pd.DataFrame({
        description_col: df[description_col].astype(str)
    })
    if quantity_col and quantity_col in df.columns:
        out[quantity_col] = pd.to_numeric(df[quantity_col], errors="coerce").fillna(1).astype(int)
    else:
        out[quantity_col or "CANTIDAD"] = 1
    return out


def flatten_results(
    results: List[Dict[str, Any]],
    description_col: str,
    quantity_col: str,
    quantities_by_description: Dict[str, int],
) -> pd.DataFrame:
    """Aplana los resultados incluyendo cantidades y totales extendidos."""
    rows: List[Dict[str, Any]] = []
    for item in results:
        description = item["item"]
        quantity = int(quantities_by_description.get(description, 1))
        for rank, match in enumerate(item["matches"], start=1):
            net_unit = float(match["net_price"]) if match["net_price"] is not None else 0.0
            total_unit = float(match["total_price"]) if match["total_price"] is not None else 0.0
            cost_unit = float(match["net_cost"]) if match.get("net_cost") is not None else None
            margin_unit = float(match["net_margin"]) if match.get("net_margin") is not None else None
            margin_pct = float(match["margin_pct"]) if match.get("margin_pct") is not None else None
            rows.append({
                description_col: description,
                quantity_col: quantity,
                "match_rank": rank,
                "matched_product": match["product"],
                "score": match["score"],
                "net_price_unit": net_unit,
                "total_price_unit": total_unit,
                "net_cost_unit": cost_unit,
                "net_margin_unit": margin_unit,
                "margin_pct": margin_pct,
                "net_price_extended": net_unit * quantity,
                "total_price_extended": total_unit * quantity,
                "net_cost_extended": (cost_unit * quantity) if cost_unit is not None else None,
                "net_margin_extended": (margin_unit * quantity) if margin_unit is not None else None,
            })
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Ejecuta el motor de coincidencias sobre un archivo de descripciones de Compra Ágil "
            "y genera un reporte con precios unitarios y totales extendidos."
        )
    )
    parser.add_argument("--input_file", required=True, help="Ruta al archivo de entrada (Excel o CSV) de Compra Ágil.")
    parser.add_argument(
        "--description_column",
        default="DESCRIPCION",
        help="Nombre de la columna con las descripciones (por defecto DESCRIPCION).",
    )
    parser.add_argument(
        "--quantity_column",
        default="CANTIDAD",
        help="Nombre de la columna con cantidades (si no existe, se asume 1).",
    )
    parser.add_argument(
        "--price_list_file",
        default="price_list_normalized_brand.xlsx",
        help="Archivo Excel con la lista de precios normalizada. Por defecto price_list_normalized_brand.xlsx.",
    )
    parser.add_argument(
        "--costs_url",
        default="https://docs.google.com/spreadsheets/d/1uOX021G12iLk6KtGBnRXA0ThLXE0eZ87/export?format=csv&gid=1149198498",
        help="URL (CSV export) con costos netos. Por defecto, la planilla compartida.",
    )
    parser.add_argument(
        "--costs_file",
        default="",
        help="Ruta alternativa a archivo de costos (CSV/XLSX). Si se provee, tiene prioridad sobre costs_url.",
    )
    parser.add_argument(
        "--costs_product_column",
        default="GP",
        help="Columna en el archivo de costos que identifica el producto (por defecto GP).",
    )
    parser.add_argument(
        "--costs_cost_column",
        default="COSTO_NETO",
        help=(
            "Columna en el archivo de costos con el costo neto (por defecto COSTO_NETO). "
            "Si el CSV viene sin esta columna, exporta/normaliza a una columna COSTO_NETO."
        ),
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
        help="Ruta del archivo Excel de salida.",
    )

    args = parser.parse_args()

    df_in = read_input_file(args.input_file, args.description_column, args.quantity_column)
    descriptions = df_in[args.description_column].dropna().astype(str).tolist()
    if not descriptions:
        print("No se encontraron descripciones en el archivo de entrada.")
        return
    quantities = {
        row[args.description_column]: int(row[args.quantity_column])
        for _, row in df_in.iterrows()
    }

    costs_file = args.costs_file.strip() or None
    costs_url = None if costs_file else (args.costs_url.strip() or None)
    matcher = PriceMatcher(
        args.price_list_file,
        costs_file=costs_file,
        costs_url=costs_url,
        costs_product_column=args.costs_product_column,
        costs_cost_column=args.costs_cost_column,
    )
    results = matcher.match_items(descriptions, top_n=args.top_n)

    df_out = flatten_results(
        results,
        description_col=args.description_column,
        quantity_col=args.quantity_column,
        quantities_by_description=quantities,
    )

    output_dir = os.path.dirname(args.output_file)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)
    df_out.to_excel(args.output_file, index=False)
    print(f"Se han guardado {len(df_out)} filas de coincidencias en {args.output_file}")


if __name__ == "__main__":
    main()

