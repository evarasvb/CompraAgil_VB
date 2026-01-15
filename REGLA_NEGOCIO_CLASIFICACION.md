# 📋 Regla de Negocio: Clasificación de Procesos

## ⚠️ REGLA CRÍTICA DEL SISTEMA

### Distinción entre LICITACIONES y COMPRAS ÁGILES

**Basado en el monto del proceso:**

- **LICITACIONES**: Monto **> 100 UTM**
- **COMPRAS ÁGILES**: Monto **<= 100 UTM**

### Valores de Referencia (Enero 2026)

- **UTM Enero 2026**: **$69.751 CLP** (Banco Central de Chile)
- **Umbral de Licitación**: 100 UTM = **$6.975.100 CLP**

### Cálculo

```typescript
const UTM_2026 = 67000; // CLP
const UMBRAL_LICITACION = 100 * UTM_2026; // ~$6.700.000 CLP

function esLicitacion(monto: number): boolean {
  return monto > UMBRAL_LICITACION;
}

function esCompraAgil(monto: number): boolean {
  return monto <= UMBRAL_LICITACION;
}
```

## 📊 Aplicación en el Sistema

### 1. **Scraper** (`scraper.js`)
- ✅ Filtra y guarda solo compras ágiles (<= 100 UTM) en `compras_agiles`
- ✅ Las licitaciones (> 100 UTM) se guardan en `licitaciones` pero NO en `compras_agiles`

### 2. **Frontend** (`clasificacion.ts`)
- ✅ Utilidad `clasificarProceso(monto)` para determinar tipo
- ✅ Funciones helper: `esLicitacion()`, `esCompraAgil()`

### 3. **Evaristo** (`evaristo_manager.py`)
- ✅ Entiende la regla y la aplica en todas sus modificaciones
- ✅ Documentado en SYSTEM_PROMPT

### 4. **Base de Datos**
- ✅ `compras_agiles`: Solo procesos <= 100 UTM
- ✅ `licitaciones`: Todos los procesos (pero clasificados correctamente)

## 🔄 Actualización Anual

**IMPORTANTE**: El valor de UTM cambia cada año. Actualizar en:

1. `mercadopublico-scraper/scraper.js` - Constante `UTM_2026`
2. `mercadopublico-scraper/agile-bidder/src/utils/clasificacion.ts` - Constantes UTM
3. Verificar valor oficial en: https://www.sii.cl/valores_y_fechas/utm/utm2026.htm

## ✅ Checklist de Implementación

- [x] Función de clasificación creada
- [x] Scraper actualizado para filtrar
- [x] Evaristo documentado
- [x] Utilidades TypeScript creadas
- [ ] Actualizar queries existentes
- [ ] Actualizar componentes UI
- [ ] Migrar datos existentes si es necesario

---

**Última actualización**: Enero 2026
**UTM 2026**: $67.000 CLP (aproximado, verificar en SII)
