# 🚀 Aplicar Migración a Producción - Guía Rápida

## ✅ Estado Actual

- ✅ **Código commiteado**: Listo
- ⚠️ **Push pendiente**: Requiere autenticación manual (`git push`)
- ⚠️ **Migración BD**: Requiere aplicación manual

---

## 📋 PASO 1: Aplicar Migración de Base de Datos

### Opción A: Supabase Dashboard (Recomendado - 2 minutos)

1. **Ve a Supabase Dashboard**: https://supabase.com/dashboard
2. **Selecciona tu proyecto**
3. **Ve a SQL Editor** (menú lateral izquierdo)
4. **Copia y pega** el contenido del archivo:
   ```
   mercadopublico-scraper/agile-bidder/supabase/migrations/20260117000000_add_costo_neto_margen_comercial_inventory.sql
   ```
5. **Haz clic en "Run"** o presiona `Ctrl+Enter`
6. **Verifica** que no haya errores

### Opción B: Script Node.js (Automático)

```bash
cd /Users/marketingdiseno/CompraAgil_VB
export SUPABASE_URL="tu_url_de_supabase"
export SUPABASE_SERVICE_ROLE_KEY="tu_service_role_key"
node apply_migration.js
```

**Nota**: El script verificará el estado pero la migración debe aplicarse desde el Dashboard por seguridad.

---

## 📋 PASO 2: Hacer Push a GitHub

```bash
cd /Users/marketingdiseno/CompraAgil_VB
git push
```

Si pide autenticación:
- Usa tu token de GitHub o
- Configura SSH keys

---

## 📋 PASO 3: Verificar Deployment

Si tienes auto-deploy configurado (Vercel/Netlify):
- El deployment se iniciará automáticamente después del push
- Verifica en el dashboard de tu plataforma

Si es deployment manual:
```bash
cd mercadopublico-scraper/agile-bidder
npm run build
# Desplegar según tu proceso
```

---

## ✅ Verificación Post-Deployment

### 1. Verificar Campos en BD

Ejecuta en Supabase SQL Editor:
```sql
-- Verificar campos en inventory
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'inventory' 
AND column_name IN ('costo_neto', 'margen_comercial');

-- Verificar campos en user_settings
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'user_settings' 
AND column_name = 'regiones_config';
```

### 2. Verificar Frontend

1. **Cargar producto**: Ve a Inventory → Agregar Producto
   - ✅ Debe pedir "Costo Neto"
   - ✅ Debe calcular margen automáticamente

2. **Configurar regiones**: Ve a Settings → General
   - ✅ Debe mostrar checkboxes de regiones
   - ✅ Debe permitir configurar recargo por región

3. **Ver compras ágiles**: Ve a Compras Ágiles
   - ✅ Debe filtrar por regiones seleccionadas
   - ✅ Debe mostrar información valiosa (pago, presupuesto, fecha)

4. **Generar propuesta**: Selecciona una compra ágil
   - ✅ Debe aplicar recargo automáticamente si hay configurado

---

## 🐛 Troubleshooting

### Error: "costo_neto is required"
- **Causa**: La migración no se aplicó
- **Solución**: Aplica la migración desde Supabase Dashboard

### Error: "column does not exist"
- **Causa**: La migración falló o no se ejecutó completamente
- **Solución**: Revisa los logs en Supabase Dashboard → Logs

### Error: "margen_comercial is null"
- **Causa**: El trigger no está funcionando
- **Solución**: Verifica que el trigger existe:
  ```sql
  SELECT * FROM pg_trigger WHERE tgname = 'trigger_update_margen_comercial';
  ```

---

## 📊 Resumen

| Paso | Estado | Tiempo |
|------|--------|--------|
| 1. Aplicar migración BD | ⚠️ Pendiente | 2 min |
| 2. Push a GitHub | ⚠️ Pendiente | 1 min |
| 3. Deployment | ⚠️ Pendiente | 5-10 min |
| **TOTAL** | | **~15 min** |

---

**Última actualización**: 2026-01-17
**Próximo paso**: Aplicar migración en Supabase Dashboard
