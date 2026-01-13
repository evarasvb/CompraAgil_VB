# Frontend: carga masiva de inventario

App React (Vite) para **cargar masivamente productos** en `cliente_inventario` desde Excel/CSV:

- Descarga de **plantilla Excel** (columnas: SKU, Nombre, Descripción, Categoría, Precio, Unidad, Keywords)
- Carga con **drag & drop** (preview + validación)
- Guardado con **upsert por SKU** vía Supabase
- **Toasts** de confirmación / error

## Requisitos

- Node.js 18+

## Configuración

1) Copia la plantilla de variables:

```bash
cp .env.example .env
```

2) Completa:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- (opcional) `VITE_CLIENTE_INVENTARIO_ONCONFLICT` (por defecto `sku`)

## Correr en local

```bash
npm install
npm run dev
```

## Notas

- Se usa `xlsx` (SheetJS) por requerimiento. Actualmente `npm audit` reporta vulnerabilidades **sin fix disponible** para ese paquete; si esto va a producción, conviene evaluar mitigaciones (p.ej. validación estricta, límites de tamaño) o alternativa de parser.
