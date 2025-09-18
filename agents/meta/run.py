from __future__ import annotations

import os
from typing import Any, Dict


def run(context: Dict[str, Any]) -> Dict[str, Any]:
    ok = bool(os.getenv("META_TOKEN"))
    publications = context.get("publications", [])
    return {"status": "ok" if ok else "missing_creds", "to_publish": len(publications)}

