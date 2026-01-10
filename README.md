# CompraAgil_VB - Sistema de Automatización de Compras Públicas

🏆 **Sistema completo de automatización para MercadoPúblico Chile**

Extrae, analiza y cotiza automáticamente en Compras Ágiles del Estado.

---

## 📊 Arquitectura del Sistema

```
┌────────────────────────┐
│  MercadoPúblico.cl     │
│  (Compras Ágiles)       │
└────────┬───────────────┘
         │
         │ Scraping (cada hora)
         │
         ▼
┌────────────────────────┐
│ GitHub Actions +      │
│ Puppeteer Scraper     │
└────────┬───────────────┘
         │
         │ Guarda en DB
         │
         ▼
┌────────────────────────┐
│ Supabase (PostgreSQL) │
│ • licitaciones         │
│ • licitacion_items     │
└────────┬───────────────┘
         │
         │ Lee nuevas licitaciones
         │
         ▼
┌────────────────────────┐
│ n8n (Matching Engine)  │
│ • Fuzzy matching        │
│ • Cálculo de precios    │
└────────┬───────────────┘
         │
         ├────────────────────────────────────────────┐
         │                                            │
         ▼                                            ▼
┌───────────────────────┐          ┌─────────────────────┐
│ Odoo CRM             │          │ Lovable Dashboard   │
│ (Oportunidades)      │          │ (Monitoreo)         │
└───────────────────────┘          └─────────────────────┘
```

---

## ✨ Características

### 🔍 Scraping Inteligente
- **Extracción automática** de Compras Ágiles cada hora
- **Modo incremental** para procesar solo nuevas licitaciones
- **Detalle completo** de productos/items solicitados
- **Documentos adjuntos** (cuando estén disponibles)
- **Ejecutado en GitHub Actions** (sin servidor propio)

### 🤖 Matching Automático
- Comparación de productos solicitados vs. tu inventario
- Cálculo automático de precios y márgenes
- Priorización por confidence score

### 💼 Integración CRM
- Creación automática de oportunidades en Odoo
- Seguimiento de estado de ofertas
- Dashboard de monitoreo en tiempo real

---

## 🚀 Guía de Instalación Rápida

### 1️⃣ Clonar el Repositorio

```bash
git clone https://github.com/evarasvb/CompraAgil_VB.git
cd CompraAgil_VB
```

### 2️⃣ Configurar Supabase

**📄 Sigue la guía completa en**: [`SETUP_SUPABASE.md`](./SETUP_SUPABASE.md)

Resumen rápido:
1. Crea cuenta en [supabase.com](https://supabase.com)
2. Crea un nuevo proyecto
3. Ejecuta el script SQL para crear las tablas
4. Obtén tu `SUPABASE_URL` y `SUPABASE_KEY`

### 3️⃣ Configurar Localmente

```bash
cd mercadopublico-scraper
npm install
cp .env.example .env
nano .env  # Edita con tus credenciales
```

Contenido del `.env`:
```bash
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_KEY=tu_service_role_key_aqui
MAX_PAGES=5
INCREMENTAL_MODE=true
```

### 4️⃣ Probar Localmente

```bash
# Modo test (solo 1 página, sin persistencia)
node scraper.js --test

# Modo test simple (más rápido, sin detalle de productos)
node scraper.js --test-simple

# Modo headed (ver el navegador)
node scraper.js --test --headed

# Modo producción (todas las páginas configuradas)
node scraper.js
```

### 5️⃣ Configurar GitHub Actions

1. Ve a tu repositorio en GitHub
2. **Settings** → **Secrets and variables** → **Actions**
3. Crea estos secrets:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`

4. Ve a **Actions** → Ejecuta manualmente **"Scraper Compras Ágiles (Cada Hora)"**

---

## 💻 Uso y Comandos

### Scraper Local

```bash
cd mercadopublico-scraper

# Opciones disponibles:
node scraper.js [opciones]

# --test              # Modo prueba (1 página, con Supabase)
# --test-simple       # Modo prueba rápido (sin Supabase, sin detalle)
# --headed            # Mostrar navegador (para debug)
# --from YYYY-MM-DD   # Fecha inicio personalizada
# --to YYYY-MM-DD     # Fecha fin personalizada
# --pages N           # Número de páginas a procesar
# --incremental       # Forzar modo incremental
# --no-incremental    # Deshabilitar modo incremental
```

### Ejemplos Prácticos

```bash
# Extraer compras de las últimas 24 horas
node scraper.js --from 2026-01-08 --to 2026-01-09 --pages 10

# Probar sin guardar en Supabase
node scraper.js --test-simple --headed

# Modo incremental (solo últimos 75 minutos)
node scraper.js --incremental --pages 3
```

---

## 🛠️ Estructura del Proyecto

```
CompraAgil_VB/
├── .github/
│   └── workflows/
│       ├── scraper-hourly.yml      # Workflow cada hora
│       └── scraper-scheduled.yml   # Workflow programado
├── mercadopublico-scraper/
│   ├── scraper.js              # Script principal
│   ├── config.js               # Configuración
│   ├── utils.js                # Funciones auxiliares
│   ├── package.json
│   └── .env.example            # Template de variables
├── agilvb_matcher.py           # Motor de matching
├── match_compra_agil.py        # Script de matching
├── price_list_normalized.xlsx  # Inventario/Catálogo
├── SETUP_SUPABASE.md           # Guía de configuración DB
├── ARCHITECTURE_OVERVIEW.md    # Descripción arquitectura
└── README.md                   # Este archivo
```

---

## 📊 Base de Datos (Supabase)

### Tablas Principales

#### `licitaciones`
Almacena los datos principales de cada Compra Ágil:
- `codigo` (PK): Ej. "1161266-3-COT26"
- `titulo`: Nombre de la compra
- `organismo`: Institución compradora
- `presupuesto_estimado`: Monto
- `fecha_publicacion`: Cuándo se publicó
- `fecha_cierre_primer_llamado`: Deadline para cotizar
- `link_detalle`: URL completa
- `procesada`: Si ya se analizó
- `match_encontrado`: Si hay productos matcheados

#### `licitacion_items`
Detalle de productos solicitados:
- `licitacion_codigo` (FK): Relación con licitaciones
- `item_index`: Número de item
- `producto_id`: ID de MercadoPúblico
- `nombre`: Nombre del producto
- `descripcion`: Especificaciones
- `cantidad`: Cantidad solicitada
- `unidad`: Tipo de unidad (Unidades, Globales, etc.)
- `match_confidence`: Score de matching (0-100)
- `precio_unitario_sugerido`: Precio calculado

#### `licitacion_documentos`
Documentos adjuntos (PDFs, planillas):
- `licitacion_codigo` (FK)
- `nombre`: Nombre del archivo
- `url`: Link de descarga

---

## 🔄 Workflow Automático

### GitHub Actions: Scraper Cada Hora

**Archivo**: `.github/workflows/scraper-hourly.yml`

**Ejecución**: Cada hora en punto (0 minutos)

**Proceso**:
1. Instala Node.js y dependencias
2. Configura variables de entorno desde Secrets
3. Instala Chrome para Puppeteer
4. Ejecuta el scraper en modo incremental (MAX_PAGES=5)
5. Guarda resultados en Supabase

**Cómo ejecutar manualmente**:
1. Ve a **Actions** en GitHub
2. Selecciona "Scraper Compras Ágiles (Cada Hora)"
3. Click en **Run workflow**

---

## 🤖 Fase 2: Matching Engine (Próximamente)

### Configuración de n8n

1. **Trigger**: Webhook o Schedule (cada 5 minutos)
2. **Consulta Supabase**: Obtener licitaciones con `procesada = FALSE`
3. **Por cada licitación**:
   - Obtener items
   - Buscar en inventario (Google Sheets / Excel / DB)
   - Fuzzy matching (nombre + descripción)
   - Calcular precio sugerido
   - Actualizar `licitacion_items` con match
4. **Si confidence > 80%**:
   - Marcar `match_encontrado = TRUE`
   - Crear oportunidad en Odoo CRM
5. **Marcar como procesada**

### Integración con Odoo

```javascript
// Ejemplo de nodo HTTP Request en n8n
POST https://firmavb.odoo.com/xmlrpc/2/object
Body: {
  "service": "object",
  "method": "execute",
  "args": [
    "database",
    user_id,
    "password",
    "crm.lead",
    "create",
    {
      "name": `[${codigo}] ${titulo}`,
      "partner_name": organismo,
      "expected_revenue": presupuesto_estimado,
      "description": `Detalles: ${link_detalle}`
    }
  ]
}
```

---

## 📊 Queries Útiles (Supabase SQL)

### Ver últimas compras extraídas
```sql
SELECT 
  codigo,
  titulo,
  organismo,
  presupuesto_estimado,
  fecha_publicacion,
  fecha_extraccion
FROM licitaciones
ORDER BY fecha_extraccion DESC
LIMIT 20;
```

### Licitaciones sin procesar
```sql
SELECT 
  COUNT(*) as total,
  SUM(presupuesto_estimado) as monto_total
FROM licitaciones
WHERE procesada = FALSE;
```

### Productos por licitación
```sql
SELECT 
  l.codigo,
  l.titulo,
  li.nombre as producto,
  li.cantidad,
  li.unidad
FROM licitaciones l
JOIN licitacion_items li ON l.codigo = li.licitacion_codigo
WHERE l.codigo = '1161266-3-COT26';
```

### Estadísticas generales
```sql
SELECT 
  COUNT(*) as total_licitaciones,
  COUNT(CASE WHEN procesada = FALSE THEN 1 END) as pendientes,
  COUNT(CASE WHEN match_encontrado = TRUE THEN 1 END) as con_match,
  SUM(presupuesto_estimado) as presupuesto_total,
  MAX(fecha_extraccion) as ultima_extraccion
FROM licitaciones;
```

---

## 🔍 Solución de Problemas

### ❌ Scraper falla con "Invalid API key"

**Solución**:
1. Verifica que estés usando la **service_role key** de Supabase
2. Confirma que no hay espacios al inicio/final de la key
3. Regenera la key si es necesario: Supabase → Settings → API → Generate new secret

### ❌ GitHub Action timeout

**Solución**:
1. Reduce `MAX_PAGES` en el workflow (de 5 a 2)
2. Aumenta timeout en `scraper.js`: `config.navigationTimeoutMs`
3. Verifica que Puppeteer se instala correctamente en los logs

### ❌ No se extraen productos

**Solución**:
1. Ejecuta localmente con `--headed` para ver el navegador
2. Verifica que los selectores CSS siguen siendo correctos
3. MercadoPúblico puede haber cambiado su estructura HTML

### ❌ Tabla no existe en Supabase

**Solución**:
1. Ejecuta el script SQL completo de `SETUP_SUPABASE.md`
2. Verifica que estás en el schema `public`
3. Confirma que `SUPABASE_URL` apunta al proyecto correcto

---

## 📅 Roadmap

### ✅ Fase 1: Scraping (COMPLETADO)
- [x] Scraper con Puppeteer
- [x] Extracción de productos detallados
- [x] Modo incremental
- [x] GitHub Actions automatizado
- [x] Persistencia en Supabase

### 🚧 Fase 2: Matching (EN PROGRESO)
- [ ] Workflow n8n para matching automático
- [ ] Integración con inventario (Google Sheets)
- [ ] Cálculo de precios y márgenes
- [ ] Algoritmo de fuzzy matching mejorado

### 🔮 Fase 3: CRM y Ofertas (PRÓXIMO)
- [ ] Creación automática de oportunidades en Odoo
- [ ] Sincronización bidireccional
- [ ] Bot para subir ofertas automáticamente
- [ ] Notificaciones vía WhatsApp/Email

### 🔮 Fase 4: Dashboard (FUTURO)
- [ ] Dashboard Lovable para monitoreo
- [ ] Visualización en tiempo real
- [ ] Métricas y KPIs
- [ ] Alertas personalizadas

---

## 📄 Documentación Adicional

- **[SETUP_SUPABASE.md](./SETUP_SUPABASE.md)**: Guía completa de configuración de base de datos
- **[ARCHITECTURE_OVERVIEW.md](./ARCHITECTURE_OVERVIEW.md)**: Visión general de la arquitectura
- **[Documentación Google Doc](https://docs.google.com/document/d/1y5_rNzfEtjg9wDtLuks5XA-uOPAxEB_cqqSN9RJsYAk/edit)**: Especificaciones técnicas detalladas

---

## ⚖️ Licencia

Este proyecto es de uso privado para FirmaVB.

---

## 👥 Autor

**Eva Aravena**  
FirmaVB - Automatización Empresarial  
📧 evaras@firmavb.cl  
🌐 [firmavb.cl](https://firmavb.cl)

---

## 🔗 Links Útiles

- [MercadoPúblico - Compras Ágiles](https://buscador.mercadopublico.cl/compra-agil)
- [Supabase Dashboard](https://supabase.com/dashboard)
- [GitHub Actions](https://github.com/evarasvb/CompraAgil_VB/actions)
- [Puppeteer Docs](https://pptr.dev/)
- [n8n Documentation](https://docs.n8n.io/)
- [Odoo XML-RPC API](https://www.odoo.com/documentation/16.0/developer/reference/external_api.html)

---

**Última actualización**: 2026-01-09  
**Versión**: 1.0.0  
**Estado**: 🟢 Producción - Fase 1 Activa
