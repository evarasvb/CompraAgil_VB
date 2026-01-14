## Extensión Chrome (Manifest V3) — Pending Sync

Esta carpeta **no existía** en el repo original: se agrega como “plantilla” para integrar la extensión de Lovable con el `pending_sync_server`.

### Configuración

- **URL del servidor**: define `PENDING_SYNC_URL` (idealmente via `chrome.storage` desde Options UI).
- **API Key**: define `PENDING_SYNC_API_KEY` (la misma que espera el server; se envía como header `x-api-key`).

### Flujo

Cada 5 minutos:
- GET `PENDING_SYNC_URL/api/pending-sync?limit=5`
- Por cada tarea:
  - abre una tab en background
  - ejecuta content script `scraper.js` (según `kind`)
  - POST `PENDING_SYNC_URL/api/pending-sync/complete` con `{ id, payload }`

### Nota

La extracción DOM es best-effort y puede necesitar ajustes finos según cambios del sitio MercadoPublico.

