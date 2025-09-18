from __future__ import annotations

import os
from typing import Any, Dict


def run(context: Dict[str, Any]) -> Dict[str, Any]:
    ok = bool(os.getenv("WHEREX_USER")) and bool(os.getenv("WHEREX_PASSWORD"))
    return {"status": "ok" if ok else "missing_creds", "count_keywords": len(context.get("post_keywords", []))}

