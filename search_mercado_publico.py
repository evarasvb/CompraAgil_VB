"""
search_mercado_publico.py
-------------------------

Descarga licitaciones desde el API de Mercado Público filtrando por
palabras clave (tóner/toner, resmas, artículos de oficina), obtiene sus ítems
y ejecuta el PriceMatcher contra la lista de precios para generar un Excel
con coincidencias por licitación e ítem, además de un consolidado.

Requiere un ticket en la variable de entorno MERCADOPUBLICO_TICKET.
Lee variables desde .env si existe (python-dotenv).
"""

from __future__ import annotations

import os
import time
import math
import argparse
from typing import Dict, Any, List, Optional

import requests
import pandas as pd
from dotenv import load_dotenv

from agilvb_matcher import PriceMatcher


LICITACIONES_ENDPOINT = "https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json"
LICITACION_DETALLE_ENDPOINT = "https://api.mercadopublico.cl/servicios/v1/publico/licitaciones/licitacion"  # + "/{codigo}.json"


def get_env(name: str, default: Optional[str] = None) -> str:
    value = os.getenv(name)
    if value is None:
        if default is None:
            raise RuntimeError(f"Missing required environment variable: {name}")
        return default
    return value


def request_with_retry(url: str, params: Dict[str, Any], max_retries: int = 3, backoff: float = 1.5) -> Dict[str, Any]:
    for attempt in range(max_retries):
        try:
            resp = requests.get(url, params=params, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            if attempt == max_retries - 1:
                raise
            time.sleep(backoff * (attempt + 1))
    return {}


def search_licitaciones(ticket: str, texto: str, estados: str, dias_atras: int, pagina_max: int) -> List[Dict[str, Any]]:
    resultados: List[Dict[str, Any]] = []
    for pagina in range(1, pagina_max + 1):
        params = {
            "ticket": ticket,
            "texto": texto,
            "estado": estados,  # p.ej. Publicada, Cerrada, etc.
            "pagina": pagina,
            "fecha": f"-{dias_atras}",  # últimos N días
        }
        data = request_with_retry(LICITACIONES_ENDPOINT, params)
        lista = data.get("Listado", []) or data.get("ListadoLicitaciones", [])
        if not lista:
            break
        resultados.extend(lista)
        # Si retorna total de paginas, podemos cortar antes
        total = data.get("CantidadTotal", 0) or len(lista)
        if total and len(lista) < 10:
            # Heurística simple para cortar si no hay más
            break
    return resultados


def get_detalle_items(ticket: str, codigo_licitacion: str) -> List[Dict[str, Any]]:
    url = f"{LICITACION_DETALLE_ENDPOINT}/{codigo_licitacion}.json"
    data = request_with_retry(url, {"ticket": ticket})
    detalles = data.get("Listado", {}) or data
    # Estructura suele exponer Items bajo 'Listado'->'Items' o similar
    items: List[Dict[str, Any]] = []
    licitacion = detalles.get("Listado", {}).get("Licitacion", {}) if isinstance(detalles, dict) else {}
    if isinstance(licitacion, dict):
        items = licitacion.get("Items", {}).get("Listado", []) or licitacion.get("Items", {}).get("Item", []) or []
    return items


def build_keywords() -> List[str]:
    # Cubrimos variantes: toner/tonner, resma(s), artículos de oficina y papelería
    return [
        "toner", "tonner", "tóner", "cartucho", "tinta",
        "resma", "resmas", "papel bond", "carta", "oficio",
        "artículos de oficina", "papelería", "útiles de oficina",
    ]


def main() -> None:
    load_dotenv()  # carga .env si existe

    parser = argparse.ArgumentParser(description="Busca licitaciones en Mercado Público y hace matching de ítems contra la lista de precios")
    parser.add_argument("--price_list_file", default=os.getenv("MP_PRICE_LIST", "price_list_normalized_brand.xlsx"))
    parser.add_argument("--output_dir", default=os.getenv("MP_OUTPUT_DIR", "resultados"))
    parser.add_argument("--dias_atras", type=int, default=int(os.getenv("MP_DIAS_ATRAS", "7")))
    parser.add_argument("--estados", default=os.getenv("MP_ESTADOS", "Publicada"))
    parser.add_argument("--max_paginas", type=int, default=int(os.getenv("MP_MAX_PAGINAS", "5")))
    parser.add_argument("--top_n", type=int, default=int(os.getenv("MP_TOP_MATCHES", "3")))
    parser.add_argument("--extra_keywords", nargs="*", default=[])

    args = parser.parse_args()

    ticket = get_env("MERCADOPUBLICO_TICKET")

    keywords = build_keywords() + [kw for kw in args.extra_keywords if kw]
    texto = " OR ".join(keywords)

    licitaciones = search_licitaciones(
        ticket=ticket,
        texto=texto,
        estados=args.estados,
        dias_atras=args.dias_atras,
        pagina_max=args.max_paginas,
    )

    if not licitaciones:
        print("No se encontraron licitaciones con los criterios dados.")
        return

    os.makedirs(args.output_dir, exist_ok=True)

    matcher = PriceMatcher(args.price_list_file)

    all_rows: List[Dict[str, Any]] = []
    for lic in licitaciones:
        codigo = lic.get("CodigoExterno") or lic.get("Codigo") or lic.get("CodigoLicitacion")
        nombre = lic.get("Nombre") or lic.get("NombreLicitacion") or ""
        if not codigo:
            continue
        items = get_detalle_items(ticket, codigo)
        if not items:
            continue
        # Hacer matching por descripción de item
        descriptions = []
        for it in items:
            desc = it.get("NombreProducto") or it.get("Descripcion") or it.get("Nombre") or ""
            if desc:
                descriptions.append(desc)
        if not descriptions:
            continue
        results = matcher.match_items(descriptions, top_n=args.top_n)

        # Aplanar y escribir archivo por licitación
        rows: List[Dict[str, Any]] = []
        for item_result in results:
            item_desc = item_result["item"]
            for rank, m in enumerate(item_result["matches"], start=1):
                rows.append({
                    "codigo_licitacion": codigo,
                    "nombre_licitacion": nombre,
                    "item_descripcion": item_desc,
                    "match_rank": rank,
                    "matched_product": m["product"],
                    "score": m["score"],
                    "net_price": m["net_price"],
                    "total_price": m["total_price"],
                })
        if rows:
            df = pd.DataFrame(rows)
            df.to_excel(os.path.join(args.output_dir, f"match_{codigo}.xlsx"), index=False)
            all_rows.extend(rows)

    if all_rows:
        df_all = pd.DataFrame(all_rows)
        df_all.to_excel(os.path.join(args.output_dir, "consolidado.xlsx"), index=False)
        print(f"Se generaron {len(all_rows)} filas en el consolidado y archivos por licitación en '{args.output_dir}'.")
    else:
        print("No hubo ítems matcheados para las licitaciones encontradas.")


if __name__ == "__main__":
    main()

