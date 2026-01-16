# ✅ Credenciales Configuradas

## 🎉 **Estado:**
- ✅ Service Role Key agregada al archivo `.env`
- ✅ Archivo `.env` configurado correctamente
- ⚠️ Deno no está instalado (necesario para ejecutar el script automático)

---

## 📋 **Opciones para Ejecutar Migraciones:**

### **Opción 1: Instalar Deno y Ejecutar Automáticamente**

```bash
# Instalar Deno (macOS/Linux)
curl -fsSL https://deno.land/install.sh | sh

# O con Homebrew (macOS)
brew install deno

# Luego ejecutar
cd mercadopublico-scraper/agile-bidder
deno run --allow-net --allow-env --allow-read scripts/ejecutar-migraciones-auto.ts
```

### **Opción 2: Ejecutar Manualmente en Supabase (Más Rápido - 2 minutos)**

1. **Abre Supabase Dashboard**
   - Ve a: https://app.supabase.com
   - Selecciona tu proyecto: **FirmaVB**

2. **Abre SQL Editor**
   - Click en **"SQL Editor"** en el menú lateral
   - Click en **"New query"**

3. **Copia el SQL**
   - Abre: `mercadopublico-scraper/agile-bidder/APLICAR_MIGRACIONES.sql`
   - Selecciona TODO (Ctrl+A o Cmd+A)
   - Copia (Ctrl+C o Cmd+C)

4. **Pega y Ejecuta**
   - Pega en el editor de Supabase (Ctrl+V o Cmd+V)
   - Click en **"Run"** o presiona `Ctrl+Enter` (Mac: `Cmd+Enter`)

5. **Verifica**
   - Deberías ver mensajes de éxito

---

## ✅ **Credenciales Guardadas:**

- ✅ Service Role Key: Configurada en `.env`
- ✅ Supabase URL: `https://juiskeeutbaipwbeeezw.supabase.co`
- ✅ Archivo `.env` protegido (en `.gitignore`)

---

## 🎯 **Recomendación:**

**Ejecuta manualmente en Supabase Dashboard** (Opción 2) - Es más rápido y no requiere instalar Deno.

---

**¿Quieres que te guíe paso a paso para ejecutar en Supabase Dashboard?**
