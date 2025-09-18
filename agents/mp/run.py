from __future__ import annotations

import os
from typing import Any, Dict


def run(context: Dict[str, Any]) -> Dict[str, Any]:
    # Stub de agente MP: valida credenciales y devuelve estatus básico.
    has_ticket = bool(os.getenv("MERCADOPUBLICO_TICKET"))
    return {
        "status": "ok" if has_ticket else "missing_creds",
        "details": {"keywords": context.get("post_keywords", [])[:5]},
    }

