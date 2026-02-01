#!/usr/bin/env python3
"""
search_mercadopublico.py
------------------------

CLI para buscar licitaciones en Mercado Público relacionadas con tóners, resmas
y artículos de oficina. Consume el API público de Mercado Público utilizando un
"ticket" (token) leído desde la variable de entorno MERCADOPUBLICO_TICKET.

Características:
- Consulta por rango de fechas (una llamada por día) usando el endpoint público.
- Filtra por palabras clave (acento-insensible) en nombre y descripción.
- Opcionalmente intenta traer el detalle de cada licitación y filtrar también
  por los ítems (si el API los expone en la respuesta de detalle).
- Exporta resultados a JSON y/o CSV.

Uso rápido:
    MERCADOPUBLICO_TICKET=TU_TICKET \
    python search_mercadopublico.py \
      --start_date 2025-09-01 --end_date 2025-09-17 \
      --keywords "TONER,TÓNER,RESMA,RESMAS,OFICINA,ARTICULOS DE OFICINA,TINTA,CARTUCHO" \
      --states "Publicada,Abierta" \
      --fetch_details \
      --out_json licitaciones_oficina.json --out_csv licitaciones_oficina.csv

Notas:
- El API de Mercado Público evoluciona. Este script maneja estructuras comunes
  (Listado->Licitaciones) y realiza algunas tolerancias de parsing.
- Si la red no está disponible o no tienes ticket válido, la ejecución fallará.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

import unicodedata

try:
    import requests
except ImportError as exc:
    print("Falta la dependencia 'requests'. Instálala con: pip install requests", file=sys.stderr)
    raise


BASE_URL = "https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json"


def remove_accents(text: str) -> str:
    normalized = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


def normalize(text: Optional[str]) -> str:
    if not text:
        return ""
    return remove_accents(text).upper()


def daterange(start: datetime, end: datetime) -> Iterable[datetime]:
    current = start
    while current <= end:
        yield current
        current = current + timedelta(days=1)


def http_get(url: str, params: Dict[str, Any], retries: int = 3, backoff: float = 1.5, timeout: int = 30) -> requests.Response:
    last_exc: Optional[Exception] = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, timeout=timeout)
            if resp.status_code == 200:
                return resp
            # Retry on transient server errors and rate limiting
            if resp.status_code in {429, 500, 502, 503, 504}:
                time.sleep((backoff ** attempt))
                continue
            # For other status codes, raise
            resp.raise_for_status()
            return resp
        except Exception as exc:
            last_exc = exc
            time.sleep((backoff ** attempt))
    if last_exc:
        raise last_exc
    raise RuntimeError("Unexpected HTTP error without exception")


def extract_listado(json_data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extrae la lista de licitaciones desde respuestas típicas del API."""
    if not isinstance(json_data, dict):
        return []
    # Estructura común: { ..., "Listado": { "Licitaciones": [ {...}, ... ] } }
    listado = json_data.get("Listado")
    if isinstance(listado, dict):
        licitaciones = listado.get("Licitaciones")
        if isinstance(licitaciones, list):
            return [x for x in licitaciones if isinstance(x, dict)]
        # Algunos endpoints devuelven un objeto único bajo "Licitacion"
        unica = listado.get("Licitacion")
        if isinstance(unica, dict):
            return [unica]
    # Fallback: tal vez la lista esté directamente en la raíz
    licitaciones = json_data.get("Licitaciones")
    if isinstance(licitaciones, list):
        return [x for x in licitaciones if isinstance(x, dict)]
    return []


def fetch_daily_licitaciones(ticket: str, day: datetime) -> List[Dict[str, Any]]:
    params = {
        "ticket": ticket,
        "fecha": day.strftime("%Y-%m-%d"),
    }
    resp = http_get(BASE_URL, params)
    try:
        data = resp.json()
    except Exception:
        data = {}
    return extract_listado(data)


def fetch_licitacion_detalle(ticket: str, codigo_externo: str) -> Optional[Dict[str, Any]]:
    params = {
        "ticket": ticket,
        "codigo": codigo_externo,
    }
    resp = http_get(BASE_URL, params)
    try:
        data = resp.json()
    except Exception:
        return None
    listado = extract_listado(data)
    if listado:
        # Si el detalle viene como único objeto, ya está incluido
        # o como lista de un elemento
        return listado[0]
    # Fallback: algunos retornan bajo "Listado":{"Licitacion":{...}}
    if isinstance(data, dict):
        listado_root = data.get("Listado")
        if isinstance(listado_root, dict):
            licitacion = listado_root.get("Licitacion")
            if isinstance(licitacion, dict):
                return licitacion
    return None


def matches_keywords(record: Dict[str, Any], keywords_norm: List[str]) -> bool:
    nombre = normalize(record.get("Nombre") or record.get("NombreLicitacion") or "")
    descripcion = normalize(record.get("Descripcion") or record.get("DescripcionLicitacion") or "")
    base_text = f"{nombre} {descripcion}"
    if any(k in base_text for k in keywords_norm):
        return True
    # Buscar en ítems si están presentes
    items = record.get("Items") or record.get("ListadoItems")
    if isinstance(items, list):
        for it in items:
            if not isinstance(it, dict):
                continue
            item_desc = normalize(
                it.get("NombreItem")
                or it.get("NombreProducto")
                or it.get("Descripcion")
                or ""
            )
            if any(k in item_desc for k in keywords_norm):
                return True
    return False


def filter_by_state(record: Dict[str, Any], allowed_states_norm: Optional[List[str]]) -> bool:
    if not allowed_states_norm:
        return True
    estado = normalize(record.get("Estado") or record.get("EstadoLicitacion") or "")
    return any(state in estado for state in allowed_states_norm)


def to_csv(path: str, rows: List[Dict[str, Any]]) -> None:
    if not rows:
        # Crear CSV vacío con encabezados básicos
        headers = [
            "CodigoExterno", "Nombre", "Estado", "FechaPublicacion",
            "FechaCierre", "Organismo", "Url",
        ]
        with open(path, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=headers)
            writer.writeheader()
        return
    # Unificar headers
    headers = sorted({key for row in rows for key in row.keys()})
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Busca licitaciones en Mercado Público por rango de fechas y filtra por palabras clave."
        )
    )
    parser.add_argument("--start_date", required=True, help="Fecha inicio (YYYY-MM-DD)")
    parser.add_argument("--end_date", required=True, help="Fecha término (YYYY-MM-DD)")
    parser.add_argument(
        "--keywords",
        default="TONER,TÓNER,RESMA,RESMAS,OFICINA,ARTICULOS DE OFICINA,TINTA,TINTAS,CARTUCHO,CARTUCHOS,PAPEL",
        help="Lista separada por comas de palabras clave para filtrar.",
    )
    parser.add_argument(
        "--states",
        default="PUBLICADA,ABIERTA",
        help="Estados permitidos (coma). Ej: PUBLICADA,ABIERTA,ADJUDICADA",
    )
    parser.add_argument(
        "--fetch_details",
        action="store_true",
        help="Intentar descargar el detalle por 'codigo' para buscar en items.",
    )
    parser.add_argument("--out_json", default=None, help="Ruta de salida JSON (opcional)")
    parser.add_argument("--out_csv", default=None, help="Ruta de salida CSV (opcional)")

    args = parser.parse_args()

    ticket = os.environ.get("MERCADOPUBLICO_TICKET")
    if not ticket:
        print("ERROR: Debes definir MERCADOPUBLICO_TICKET en el entorno.", file=sys.stderr)
        sys.exit(1)

    try:
        start = datetime.strptime(args.start_date, "%Y-%m-%d")
        end = datetime.strptime(args.end_date, "%Y-%m-%d")
    except ValueError:
        print("ERROR: Formato de fecha inválido. Usa YYYY-MM-DD.", file=sys.stderr)
        sys.exit(1)
    if end < start:
        print("ERROR: end_date debe ser >= start_date", file=sys.stderr)
        sys.exit(1)

    keywords_norm = [normalize(x.strip()) for x in args.keywords.split(",") if x.strip()]
    states_norm = [normalize(x.strip()) for x in args.states.split(",") if x.strip()]

    all_records: List[Dict[str, Any]] = []
    for day in daterange(start, end):
        try:
            daily = fetch_daily_licitaciones(ticket, day)
        except Exception as exc:
            print(f"Advertencia: error consultando {day.date()}: {exc}", file=sys.stderr)
            continue
        for rec in daily:
            # Normalizar algunas claves y añadir campos útiles
            codigo = rec.get("CodigoExterno") or rec.get("Codigo") or rec.get("CodigoLicitacion")
            url = rec.get("UrlPublicar") or rec.get("Url")
            if not url and codigo:
                url = f"https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?qs={codigo}"
            base_row = {
                "CodigoExterno": codigo,
                "Nombre": rec.get("Nombre") or rec.get("NombreLicitacion"),
                "Descripcion": rec.get("Descripcion") or rec.get("DescripcionLicitacion"),
                "Estado": rec.get("Estado") or rec.get("EstadoLicitacion"),
                "FechaPublicacion": (rec.get("Fechas") or {}).get("FechaPublicacion") if isinstance(rec.get("Fechas"), dict) else rec.get("FechaPublicacion"),
                "FechaCierre": (rec.get("Fechas") or {}).get("FechaCierre") if isinstance(rec.get("Fechas"), dict) else rec.get("FechaCierre"),
                "Organismo": (rec.get("Comprador") or {}).get("NombreOrganismo") if isinstance(rec.get("Comprador"), dict) else rec.get("Organismo"),
                "Url": url,
            }

            enriched = dict(rec)
            enriched.update(base_row)

            # Filtrado por estado primero
            if not filter_by_state(enriched, states_norm):
                continue

            # Si hay match directo por nombre/descr, aceptamos
            if matches_keywords(enriched, keywords_norm):
                all_records.append(enriched)
                continue

            # Si no hay match y se pidió detalle, intentar detalle y re-evaluar
            if args.fetch_details and codigo:
                try:
                    detalle = fetch_licitacion_detalle(ticket, str(codigo))
                except Exception:
                    detalle = None
                if isinstance(detalle, dict):
                    # Mezclar campos informativos sin sobrescribir claves ya presentes
                    merged = dict(detalle)
                    merged.update({k: v for k, v in base_row.items() if k not in merged})
                    if matches_keywords(merged, keywords_norm) and filter_by_state(merged, states_norm):
                        all_records.append(merged)

    # Eliminar duplicados por CodigoExterno conservando el primero
    seen: set = set()
    deduped: List[Dict[str, Any]] = []
    for r in all_records:
        code = r.get("CodigoExterno") or r.get("Codigo")
        key = str(code) if code is not None else json.dumps(r, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)

    # Salidas
    if args.out_json:
        with open(args.out_json, "w", encoding="utf-8") as fh:
            json.dump({"results": deduped, "count": len(deduped)}, fh, ensure_ascii=False, indent=2)
        print(f"JSON guardado en {args.out_json} ({len(deduped)} resultados)")

    if args.out_csv:
        to_csv(args.out_csv, deduped)
        print(f"CSV guardado en {args.out_csv} ({len(deduped)} resultados)")

    if not args.out_json and not args.out_csv:
        # Imprime un resumen legible por consola
        for r in deduped:
            print(f"- {r.get('CodigoExterno')}: {r.get('Nombre')} | {r.get('Estado')} | Cierra: {r.get('FechaCierre')} | {r.get('Url')}")


if __name__ == "__main__":
    main()

