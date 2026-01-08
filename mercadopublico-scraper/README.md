## Scraper de Compras Ágiles (MercadoPublico)

Scraper (fase 1, **sin login**) para extraer compras desde `buscador.mercadopublico.cl/compra-agil` usando un navegador headless (Puppeteer).
En vez de generar un JSON, **envía los datos a Supabase**.

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

### Configuración (Supabase)

Copia `.env.example` a `.env` y completa:

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `MAX_PAGES` (opcional, por defecto `1`)
- `INCREMENTAL_MODE` (opcional, por defecto `false`)

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
```

### Tablas esperadas

El scraper hace:

- Upsert en tabla **`licitaciones`** (por `codigo`)
- Upsert en tabla **`licitacion_items`** (por `licitacion_codigo,item_index`)

Si no se logra obtener `link_detalle`, igualmente inserta un **item mínimo** por compra (para cumplir la relación).

Además, extrae el detalle desde `https://buscador.mercadopublico.cl/ficha?code=...` para obtener:

- **Listado de productos solicitados** → se guarda en `licitacion_items`
- **Documentos adjuntos** → si existe la tabla `licitacion_documentos`, intenta upsert (por `licitacion_codigo,url`)

### Notas

- Incluye **reintentos** (navegación y extracción) y **esperas aleatorias** (anti-rate-limit).
- Soporta **modo incremental**: si `INCREMENTAL_MODE=true`, filtra compras cuya `publicada_el` esté dentro de los últimos ~75 minutos y evita reprocesar códigos ya existentes (consulta a Supabase).
- Fase 2 (futuro): login + extracción de datos adicionales + documentos.

