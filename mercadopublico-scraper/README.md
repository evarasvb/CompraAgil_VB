## Scraper de Compras Ágiles (MercadoPublico)

Scraper (fase 1, **sin login**) para extraer compras desde `buscador.mercadopublico.cl/compra-agil` usando un navegador headless (Puppeteer).

### Qué extrae

Por cada compra intenta capturar:

- **codigo**
- **titulo**
- **estado** (ej: "Publicada recibiendo cotizaciones")
- **estado_detallado** (ej: "Recibiendo cotizaciones")
- **publicada_el** (ISO local: `YYYY-MM-DDTHH:mm:00`)
- **finaliza_el** (ISO local: `YYYY-MM-DDTHH:mm:00`)
- **presupuesto_estimado** (CLP como número)
- **organismo** y **departamento**
- **link_detalle** (cuando es posible)

> Nota: los selectores del sitio pueden cambiar. El scraper usa heurísticas (texto + regex) para ser tolerante, pero puede requerir ajustes si el DOM cambia.

### Instalación

Desde la carpeta del scraper:

```bash
cd /workspace/mercadopublico-scraper
npm install
```

### Uso

Ejecutar (por defecto usa headless):

```bash
npm start
```

Modo prueba (solo 1 página):

```bash
npm test
```

Opciones útiles:

```bash
node scraper.js --from 2025-12-09 --to 2026-01-08 --pages 5
node scraper.js --headed
node scraper.js --out ./output/compras_agiles.json
node scraper.js --no-resume
```

### Output

- `output/compras_agiles.json`: salida final
- `output/progress_compras.json`: progreso (se guarda cada N páginas)

Formato:

```json
{
  "fecha_extraccion": "2026-01-08T16:00:00.000Z",
  "total_compras": 4708,
  "total_resultados": 4708,
  "params": { "...": "..." },
  "compras": [
    {
      "codigo": "1161266-3-COT26",
      "titulo": "ADQUISICIÓN DE AGENDAD 2026 Y TACO CALENDARIO",
      "estado": "Publicada recibiendo cotizaciones",
      "publicada_el": "2026-01-08T13:24:00",
      "finaliza_el": "2026-01-12T08:00:00",
      "presupuesto_estimado": 300000,
      "organismo": "I MUNICIPALIDAD DE TUCAPEL",
      "departamento": "Adquisiciones Contratos y Licitaciones",
      "link_detalle": "https://...",
      "estado_detallado": "Recibiendo cotizaciones"
    }
  ]
}
```

### Notas

- Incluye **reintentos** (navegación y extracción), **esperas aleatorias** entre páginas (anti-rate-limit), y **guardado de progreso**.
- Fase 2 (futuro): login + extracción de datos adicionales + documentos.

