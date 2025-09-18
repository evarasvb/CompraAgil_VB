from __future__ import annotations

import os
from typing import Any, Dict


def run(context: Dict[str, Any]) -> Dict[str, Any]:
    ok = bool(os.getenv("SENEGOCIA_USER")) and bool(os.getenv("SENEGOCIA_PASSWORD"))
    return {"status": "ok" if ok else "missing_creds", "exclusions": len(context.get("exclusions", []))}

