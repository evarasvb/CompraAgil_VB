# 🔑 Guía de Configuración de Keys de Supabase

## ⚠️ Problema Común

El scraper necesita la **service_role_key** para poder escribir en Supabase sin ser bloqueado por RLS (Row Level Security).

Si usas la **anon key**, verás errores como:
```
Error: new row violates row-level security policy for table "licitaciones"
```

## ✅ Solución

### 1. Verificar tu Key Actual

Ejecuta el script de verificación:

```bash
cd /Users/marketingdiseno/CompraAgil_VB
node verificar_supabase_key.js
```

O manualmente, decodifica el JWT:
```bash
# Extrae el payload del JWT (segunda parte)
echo "TU_KEY_AQUI" | cut -d'.' -f2 | base64 -d | jq '.role'
```

Si dice `"anon"` → Necesitas cambiarla
Si dice `"service_role"` → ✅ Está correcta

### 2. Obtener la Service Role Key

1. Ve a tu proyecto en Supabase Dashboard
2. Click en **Settings** (⚙️) en el menú lateral
3. Click en **API**
4. Busca la sección **"Project API keys"**
5. Copia la **"service_role" key** (la que dice "secret" - NO la "anon public")
   - ⚠️ Esta key es SECRETA, nunca la expongas en el frontend

### 3. Actualizar .env Local

Edita `mercadopublico-scraper/.env`:

```bash
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # service_role key aquí
```

### 4. Actualizar GitHub Secrets

1. Ve a tu repositorio en GitHub
2. **Settings** → **Secrets and variables** → **Actions**
3. Busca o crea el secret `SUPABASE_KEY`
4. Pega la **service_role key** (no la anon key)
5. Click **Update secret**

### 5. Verificar

#### Localmente:
```bash
cd mercadopublico-scraper
node scraper.js --pages 1
```

Si funciona sin errores de RLS → ✅ Correcto

#### En GitHub Actions:
1. Ve a **Actions** en GitHub
2. Ejecuta manualmente el workflow "Scraper Compras Ágiles"
3. Revisa los logs - debería decir:
   ```
   ✅ SUPABASE_KEY es service_role (correcto para scraper)
   ```

## 🔒 Seguridad

- ✅ **Service Role Key**: Úsala SOLO en:
  - Scripts del servidor (scraper, matcher)
  - GitHub Actions
  - Edge Functions del backend
  
- ❌ **NUNCA** uses service_role_key en:
  - Frontend (React, Vue, etc.)
  - Código del cliente
  - Variables de entorno públicas

- ✅ **Anon Key**: Úsala en:
  - Frontend
  - Aplicaciones cliente
  - Código que se ejecuta en el navegador

## 📋 Checklist

- [ ] Verificado que `.env` tiene service_role_key
- [ ] Verificado que GitHub Secrets tiene service_role_key
- [ ] Scraper ejecuta sin errores de RLS
- [ ] GitHub Actions ejecuta correctamente
- [ ] Datos aparecen en `compras_agiles` y `licitacion_items`

## 🐛 Troubleshooting

### Error: "RLS policy violation"
→ Tu key es `anon`, cámbiala a `service_role`

### Error: "Invalid API key"
→ Verifica que copiaste la key completa (son muy largas)

### Error: "Key not found"
→ Verifica que el secret en GitHub se llama exactamente `SUPABASE_KEY`

### Los datos no aparecen
→ Verifica que el scraper se ejecutó correctamente (revisa logs)
→ Verifica en Supabase que las tablas existen y tienen datos
