"""
Orquestador Vendedor360
Ejecuta el ciclo maestro: percibir -> actuar -> analizar -> proponer mejoras.

Secuencia base: Wherex -> Senegocia -> Mercado Público -> Meta -> LinkedIn.
Registra logs estructurados en ./logs y mantiene STATUS.md e IMPROVEMENTS.md.
"""

from __future__ import annotations

import csv
import json
import os
import sys
import time
from datetime import datetime
from typing import Any, Dict, List


LOGS_DIR = "logs"
QUEUES_DIR = "queues"
EXCLUSIONS_PATH = os.path.join("agents", "exclusiones.json")
STATUS_MD = "STATUS.md"
IMPROVEMENTS_MD = "IMPROVEMENTS.md"


def ensure_dirs() -> None:
    os.makedirs(LOGS_DIR, exist_ok=True)
    os.makedirs(QUEUES_DIR, exist_ok=True)


def load_csv_keywords(path: str) -> List[str]:
    if not os.path.exists(path):
        return []
    keywords: List[str] = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            val = (row.get("keyword") or row.get("palabra") or row.get("texto") or "").strip()
            if val:
                keywords.append(val)
    return keywords


def load_publications(path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(path):
        return []
    items: List[Dict[str, Any]] = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            items.append(row)
    return items


def load_exclusions(path: str) -> List[str]:
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict):
        return list(data.get("exclusiones", []))
    if isinstance(data, list):
        return data
    return []


def creds_status() -> Dict[str, str]:
    def isset(name: str) -> str:
        return "set" if os.getenv(name) else "missing"

    return {
        "MERCADOPUBLICO_TICKET": isset("MERCADOPUBLICO_TICKET"),
        "WHEREX_USER": isset("WHEREX_USER"),
        "WHEREX_PASSWORD": isset("WHEREX_PASSWORD"),
        "SENEGOCIA_USER": isset("SENEGOCIA_USER"),
        "SENEGOCIA_PASSWORD": isset("SENEGOCIA_PASSWORD"),
        "META_TOKEN": isset("META_TOKEN"),
        "LINKEDIN_TOKEN": isset("LINKEDIN_TOKEN"),
    }


def write_status_md(status: Dict[str, str]) -> None:
    lines = [
        "# STATUS",
        "",
        f"Updated: {datetime.utcnow().isoformat()}Z",
        "",
    ]
    for k, v in status.items():
        lines.append(f"- {k}: {v}")
    with open(STATUS_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def append_improvement(note: str) -> None:
    header = "# IMPROVEMENTS\n\n" if not os.path.exists(IMPROVEMENTS_MD) else ""
    with open(IMPROVEMENTS_MD, "a", encoding="utf-8") as f:
        if header:
            f.write(header)
        f.write(f"- {datetime.utcnow().isoformat()}Z: {note}\n")


def run_agents(context: Dict[str, Any]) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []

    # Wherex
    try:
        from agents.wherex.run import run as run_wherex  # type: ignore
        results.append({"agent": "wherex", **run_wherex(context)})
    except Exception as exc:  # noqa: BLE001
        results.append({"agent": "wherex", "status": "error", "error": str(exc)})

    # Senegocia
    try:
        from agents.senegocia.run import run as run_senegocia  # type: ignore
        results.append({"agent": "senegocia", **run_senegocia(context)})
    except Exception as exc:  # noqa: BLE001
        results.append({"agent": "senegocia", "status": "error", "error": str(exc)})

    # Mercado Público
    try:
        from agents.mp.run import run as run_mp  # type: ignore
        results.append({"agent": "mp", **run_mp(context)})
    except Exception as exc:  # noqa: BLE001
        results.append({"agent": "mp", "status": "error", "error": str(exc)})

    # Meta
    try:
        from agents.meta.run import run as run_meta  # type: ignore
        results.append({"agent": "meta", **run_meta(context)})
    except Exception as exc:  # noqa: BLE001
        results.append({"agent": "meta", "status": "error", "error": str(exc)})

    # LinkedIn
    try:
        from agents.linkedin.run import run as run_linkedin  # type: ignore
        results.append({"agent": "linkedin", **run_linkedin(context)})
    except Exception as exc:  # noqa: BLE001
        results.append({"agent": "linkedin", "status": "error", "error": str(exc)})

    return results


def main() -> None:
    ensure_dirs()

    postulaciones_csv = os.path.join(QUEUES_DIR, "postulaciones.csv")
    publicaciones_csv = os.path.join(QUEUES_DIR, "publicaciones.csv")

    post_keywords = load_csv_keywords(postulaciones_csv)
    pubs = load_publications(publicaciones_csv)
    exclusions = load_exclusions(EXCLUSIONS_PATH)

    status = creds_status()
    write_status_md(status)

    context: Dict[str, Any] = {
        "post_keywords": post_keywords,
        "publications": pubs,
        "exclusions": exclusions,
        "status": status,
        "started_at": datetime.utcnow().isoformat() + "Z",
    }

    results = run_agents(context)

    log = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "context": {"num_keywords": len(post_keywords), "num_publications": len(pubs), "num_exclusions": len(exclusions)},
        "results": results,
    }
    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    with open(os.path.join(LOGS_DIR, f"orchestrator_{ts}.json"), "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, indent=2)

    # Heurística simple de mejora
    if not post_keywords:
        append_improvement("No hay keywords en queues/postulaciones.csv; agregar términos específicos por familia de productos.")


if __name__ == "__main__":
    main()

