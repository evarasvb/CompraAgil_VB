## Scraper de Compras Ágiles (MercadoPúblico)

Scraper **sin login** para extraer **Compras Ágiles** desde el buscador de MercadoPúblico (`/compra-agil`) y, opcionalmente, obtener el **detalle de productos solicitados** desde la ficha (`/ficha?code=...`).

El objetivo es **persistir los datos en Supabase** (Postgres) usando `upsert` para evitar duplicados, y habilitar una ejecución periódica (por ejemplo, en GitHub Actions).

> Importante: MercadoPúblico es un sitio dinámico (React). El scraper usa esperas y heurísticas para ser tolerante, pero si el DOM cambia puede requerir ajustes.

### 1) Qué hace el scraper

- **Listado**: navega por páginas del buscador de Compras Ágiles y extrae datos básicos por compra (código, título, fechas, presupuesto, organismo, etc.).
- **Detalle**: para cada `codigo`, navega a `https://buscador.mercadopublico.cl/ficha?code=<codigo>` y extrae el **Listado de productos solicitados** (items).
- **Adjuntos**: intenta detectar **documentos adjuntos** en la ficha (si tienes tabla para guardarlos).
- **Persistencia**: guarda en Supabase en tablas normalizadas:
  - `licitaciones` (cabecera)
  - `licitacion_items` (productos)
  - `licitacion_documentos` (adjuntos, opcional)

### 2) Requisitos

- **Node.js 18+**
- **npm**
- Linux/macOS/Windows. En entornos CI (GitHub Actions), Puppeteer descarga Chromium automáticamente.

### 3) Instalación paso a paso

1) Clona el repo y cambia a la rama del scraper:

```bash
git clone https://github.com/evarasvb/CompraAgil_VB.git
cd CompraAgil_VB
git checkout cursor/mercadopublico-agile-scraper-4a12
```

2) Entra a la carpeta del scraper e instala dependencias:

```bash
cd mercadopublico-scraper
npm install
```

### 4) Configuración (.env)

El scraper lee variables desde un archivo `.env`.

1) Crea tu `.env` desde la plantilla:

```bash
cp .env.example .env
```

2) Ejemplo recomendado de `.env`:

```bash
# Supabase (requerido para modo producción)
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_KEY=tu_service_role_key_o_key_con_permisos_de_escritura

# Control de paginación
MAX_PAGES=1

# Incremental (opcional)
INCREMENTAL_MODE=false
```

> Nota: para **escritura** en Supabase normalmente necesitarás una key con permisos (por ejemplo **service role**) o políticas RLS que permitan `insert/upsert` desde esa key. No uses tu `anon` key si RLS bloquea escrituras.

### 5) Uso

#### Modo test simple (sin Supabase, sin detalle)
Solo valida que el listado carga y que el scraper “ve” compras:

```bash
node scraper.js --test-simple
```

Qué hace:
- Extrae el listado de la primera página (por defecto `MAX_PAGES=1`)
- Imprime cuántas compras encontró y algunos códigos
- No usa Supabase
- No entra a `/ficha`

#### Modo test con dry-run (sin credenciales)
Ejecuta el flujo completo en modo test. Si no hay `SUPABASE_URL/KEY`, funciona como **dry-run** (no escribe, solo reporta):

```bash
npm test
```

#### Modo producción con Supabase
Escribe en Supabase (requiere `SUPABASE_URL` y `SUPABASE_KEY` en `.env`):

```bash
node scraper.js
```

#### Modo incremental (últimos ~75 minutos)
Activa incremental en el `.env`:

```bash
INCREMENTAL_MODE=true
```

Qué hace:
- Filtra compras recientes usando `publicada_el >= ahora - 75 minutos`
- Antes de procesar, consulta Supabase y **omite** códigos ya existentes (solo procesa compras nuevas)

### 6) Variables de entorno (explicadas)

- **`SUPABASE_URL`**: URL del proyecto Supabase.
- **`SUPABASE_KEY`**: API key con permisos de lectura/escritura para las tablas (típicamente **service role** en CI).
- **`MP_API_TICKET`** *(solo scraper OC)*: Ticket de la API oficial de MercadoPúblico para consultar Órdenes de Compra.
  - Si **no** se configura en GitHub Actions, el workflow de OC **no falla**: emite un warning y **se omite** hasta que el secret exista.
- **`MAX_PAGES`**:
  - `1` (default): procesa 1 página.
  - `N`: procesa N páginas.
  - `auto`: intenta calcular páginas con el total de resultados / 15 (puede variar si el sitio cambia).
- **`INCREMENTAL_MODE`**:
  - `true`: procesa solo compras recientes y evita reprocesar códigos existentes.
  - `false`: procesa según el rango `--from/--to` o el default “hoy”.

### 7) Estructura de datos en Supabase (tablas)

El scraper asume estas tablas (nombres exactos):

#### Tabla `licitaciones`
Uso: cabecera de cada compra/licitación.

- **Clave/unique**: `codigo` (recomendado UNIQUE)
- Campos sugeridos:
  - `codigo` (text)
  - `titulo` (text)
  - `estado` (text)
  - `estado_detallado` (text)
  - `publicada_el` (text o timestamp) *(el scraper genera `YYYY-MM-DDTHH:mm:00` como string local)*
  - `finaliza_el` (text o timestamp)
  - `presupuesto_estimado` (int)
  - `organismo` (text)
  - `departamento` (text)
  - `link_detalle` (text)
  - `fecha_extraccion` (timestamptz/text)

#### Tabla `licitacion_items`
Uso: productos del “Listado de productos solicitados”.

- **Clave/unique compuesta**: `(licitacion_codigo, item_index)` (recomendado UNIQUE)
- Campos sugeridos:
  - `licitacion_codigo` (text) *(FK opcional a `licitaciones.codigo`)*
  - `item_index` (int)
  - `producto_id` (text, nullable)
  - `nombre` (text)
  - `descripcion` (text)
  - `cantidad` (text o numeric, nullable)
  - `unidad` (text)

#### Tabla `licitacion_documentos` (opcional)
Uso: adjuntos detectados en la ficha.

- **Clave/unique compuesta**: `(licitacion_codigo, url)` (recomendado UNIQUE)
- Campos sugeridos:
  - `licitacion_codigo` (text)
  - `nombre` (text)
  - `url` (text)

> Si no creas `licitacion_documentos`, el scraper seguirá funcionando y solo mostrará un warning al intentar insertar documentos.

### 8) GitHub Actions (ejecución automática)

Para ejecutar automáticamente en GitHub Actions:

1) En GitHub, ve a **Settings → Secrets and variables → Actions → New repository secret** y agrega:
- `SUPABASE_URL`
- `SUPABASE_KEY`
- (opcional) `MAX_PAGES`
- (opcional) `INCREMENTAL_MODE`

2) En tu workflow, expón esas variables al job. Ejemplo mínimo:

```yaml
name: Scrape Compras Ágiles
on:
  schedule:
    - cron: "*/30 * * * *" # cada 30 min
  workflow_dispatch: {}

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "18"
      - name: Install
        working-directory: mercadopublico-scraper
        run: npm install
      - name: Run scraper
        working-directory: mercadopublico-scraper
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
          MAX_PAGES: ${{ secrets.MAX_PAGES }}
          INCREMENTAL_MODE: ${{ secrets.INCREMENTAL_MODE }}
        run: node scraper.js
```

Recomendación:
- Para jobs programados, usa `INCREMENTAL_MODE=true` y `MAX_PAGES=auto` o un número razonable.

### 9) Troubleshooting común

- **Timeout esperando resultados / “Waiting failed … exceeded”**
  - Sube `navigationTimeoutMs/resultsTimeoutMs` (ya vienen altos).
  - Prueba en modo visible: `node scraper.js --headed`
  - Revisa si el sitio cambió el texto “Revisar detalle” o la estructura del listado.

- **Pocas compras extraídas (ej. 5-6)**
  - Puede ser paginación/scroll o cambios en UI. Prueba `--headed` y valida que se ve el listado.
  - Aumenta `MAX_PAGES` y verifica que efectivamente cambia la URL con `page_number`.

- **Supabase error: relation/table does not exist**
  - Crea las tablas `licitaciones` y `licitacion_items` (y opcional `licitacion_documentos`) con los nombres exactos.

- **Supabase error por `onConflict`**
  - Asegúrate de tener **UNIQUE** en:
    - `licitaciones.codigo`
    - `licitacion_items.(licitacion_codigo, item_index)`
    - `licitacion_documentos.(licitacion_codigo, url)` (si aplica)

- **No inserta nada en Supabase / RLS**
  - Si RLS está activo, necesitas políticas que permitan `insert/update` o usa una key con permisos adecuados (en CI suele ser **service role**).

- **Bloqueos / rate limiting**
  - El detalle corre con concurrencia **máx 3**. Si te bloquean, baja concurrencia en el código o aumenta delays.


