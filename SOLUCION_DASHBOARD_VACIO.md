# 🔧 Solución: Dashboard Vacío - Compras Ágiles No Aparecen

## ❌ Problema Identificado

El dashboard muestra "No hay compras ágiles nuevas" aunque el scraper guardó 50 compras en la base de datos.

## 🔍 Causa Raíz

El hook `useLicitacionesNuevas` filtra compras con:
```typescript
.or('match_encontrado.eq.false,match_encontrado.is.null')
```

Pero el scraper **NO estaba estableciendo** `match_encontrado` al guardar, por lo que:
- Si el campo no existe o es `undefined`, la query no lo encuentra
- Las compras no aparecen en "Licitaciones Nuevas"

## ✅ Solución Aplicada

Modificado `scraper.js` para establecer explícitamente:
```javascript
match_encontrado: false,
match_score: null,
```

Esto asegura que todas las compras nuevas aparezcan en el dashboard.

## 📋 Cambios Realizados

### Archivo: `mercadopublico-scraper/scraper.js`

**Función**: `upsertComprasAgiles()`

**Antes**:
```javascript
const row = {
  codigo: lic.codigo,
  nombre: lic.titulo || `Compra Ágil ${lic.codigo}`,
  // ... otros campos
  // ❌ No establecía match_encontrado
};
```

**Después**:
```javascript
const row = {
  codigo: lic.codigo,
  nombre: lic.titulo || `Compra Ágil ${lic.codigo}`,
  // ... otros campos
  match_encontrado: false,  // ✅ Establecido explícitamente
  match_score: null,        // ✅ Establecido explícitamente
};
```

## 🚀 Próximos Pasos

### Opción 1: Actualizar Compras Existentes (Rápido)

Ejecuta este SQL en Supabase para actualizar las compras ya guardadas:

```sql
UPDATE compras_agiles 
SET match_encontrado = false, match_score = null 
WHERE match_encontrado IS NULL;
```

### Opción 2: Re-ejecutar Scraper (Recomendado)

El scraper ahora establecerá correctamente los valores:

```bash
cd mercadopublico-scraper
node scraper.js --pages 5
```

Las nuevas compras aparecerán automáticamente en el dashboard.

## ✅ Verificación

Después de aplicar la solución:

1. **Refrescar el dashboard** en firmavb.cl/licitaciones
2. **Verificar** que aparezcan compras en "Licitaciones Nuevas"
3. **Confirmar** que el contador muestre el número correcto

## 📊 Estado Esperado

- ✅ Compras aparecen en "Licitaciones Nuevas"
- ✅ Contador muestra cantidad correcta
- ✅ Botón "Analizar Match" disponible
- ✅ Al hacer match, se mueven a "Oportunidades con Match"

---

**Última actualización**: Después de corregir `upsertComprasAgiles()`
**Estado**: ✅ Código corregido, pendiente re-ejecutar scraper o actualizar BD
