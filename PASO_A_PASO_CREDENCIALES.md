# 🔐 Configurar Credenciales - Paso a Paso

## 🎯 **Objetivo:**
Configurar las credenciales necesarias para ejecutar migraciones automáticamente.

---

## 📋 **Paso 1: Obtener Service Role Key**

### **1.1. Abre Supabase Dashboard**
- Ve a: https://app.supabase.com
- Inicia sesión si es necesario

### **1.2. Selecciona tu Proyecto**
- Click en el proyecto: **FirmaVB** (o el nombre de tu proyecto)

### **1.3. Ve a Settings → API**
- En el menú lateral izquierdo, click en **"Settings"**
- Click en **"API"** en el submenú

### **1.4. Busca "service_role" key**
- En la sección **"Project API keys"**
- Busca la key que dice **"service_role"** (⚠️ NO la "anon" key)
- La key es muy larga y empieza con `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

### **1.5. Copia la key**
- Click en el ícono de **copiar** (📋) al lado de la key
- ⚠️ **GUÁRDALA EN UN LUGAR SEGURO** - No la compartas

---

## 📋 **Paso 2: Crear archivo .env**

### **2.1. Navega a la carpeta del proyecto**
```bash
cd mercadopublico-scraper/agile-bidder
```

### **2.2. Crea el archivo .env**
```bash
# Si no existe, créalo desde el ejemplo
cp .env.example .env
```

O crea el archivo manualmente:
```bash
touch .env
```

### **2.3. Abre el archivo .env**
Abre el archivo `.env` en tu editor de texto favorito.

---

## 📋 **Paso 3: Agregar Credenciales**

### **3.1. Agrega estas líneas al .env:**

```bash
# Supabase URL (ya la tienes)
VITE_SUPABASE_URL=https://euzqadopjvdszcdjegmo.supabase.co
SUPABASE_URL=https://euzqadopjvdszcdjegmo.supabase.co

# Anon/Public Key (si ya la tienes, úsala)
VITE_SUPABASE_PUBLISHABLE_KEY=tu_anon_public_key_aqui

# Service Role Key (PEGA AQUÍ LA KEY QUE COPIaste)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### **3.2. Reemplaza los valores:**
- `tu_anon_public_key_aqui` → Tu anon public key (si la tienes)
- `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` → La service_role key que copiaste

### **3.3. Guarda el archivo**
Guarda el archivo `.env` (Ctrl+S o Cmd+S)

---

## 📋 **Paso 4: Verificar Configuración**

### **4.1. Verifica que el archivo existe:**
```bash
cd mercadopublico-scraper/agile-bidder
ls -la .env
# Deberías ver: .env
```

### **4.2. Verifica que tiene la key:**
```bash
cat .env | grep SUPABASE_SERVICE_ROLE_KEY
# Deberías ver: SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 📋 **Paso 5: Ejecutar Migraciones Automáticamente**

### **5.1. Ejecuta el script:**
```bash
cd mercadopublico-scraper/agile-bidder

deno run --allow-net --allow-env --allow-read scripts/ejecutar-migraciones-auto.ts
```

### **5.2. Qué deberías ver:**
```
🚀 EJECUTANDO MIGRACIONES
==========================

✅ Variables de entorno cargadas desde .env
✅ Supabase URL: https://euzqadopjvdszcdjegmo.supabase.co
✅ Service Role Key: eyJhbGciOiJIUzI1NiIs...

📂 Leyendo APLICAR_MIGRACIONES.sql...
✅ Archivo leído (12345 caracteres)

📝 EJECUTANDO MIGRACIONES
==========================
📝 Ejecutando 50 comandos SQL...
   ✅ [1/50] CREATE OR REPLACE VIEW compras_agiles_sospechosas...
   ✅ [2/50] CREATE OR REPLACE VIEW compras_agiles_sin_productos...
   ...

📊 RESUMEN
==========================
✅ ¡Todas las migraciones aplicadas exitosamente!
🎉 Tu base de datos está actualizada y lista para usar.
```

---

## ⚠️ **Seguridad**

### **IMPORTANTE:**
- ✅ El archivo `.env` está en `.gitignore` (no se subirá a GitHub)
- ⚠️ **NUNCA** compartas tu `SUPABASE_SERVICE_ROLE_KEY` públicamente
- ⚠️ **NUNCA** subas el archivo `.env` a GitHub
- ✅ La service_role key tiene permisos completos - úsala con cuidado

---

## 🔍 **Troubleshooting**

### **Error: "SUPABASE_SERVICE_ROLE_KEY no está configurada"**
- ✅ Verifica que agregaste la key al `.env`
- ✅ Verifica que el archivo `.env` está en `mercadopublico-scraper/agile-bidder/`
- ✅ Verifica que no hay espacios extra: `SUPABASE_SERVICE_ROLE_KEY=key` (sin espacios)

### **Error: "Invalid API key"**
- ✅ Verifica que copiaste la key completa (es muy larga, ~200 caracteres)
- ✅ Verifica que copiaste la key **"service_role"** (no la "anon")
- ✅ Verifica que no hay saltos de línea en la key

### **Error: "Permission denied"**
- ✅ Verifica que usaste la **service_role** key (no la anon key)
- ✅ La service_role key tiene permisos completos en la base de datos

---

## ✅ **Resumen**

1. ✅ Obtén la **service_role** key de Supabase Dashboard → Settings → API
2. ✅ Crea/edita el archivo `.env` en `mercadopublico-scraper/agile-bidder/`
3. ✅ Agrega `SUPABASE_SERVICE_ROLE_KEY=tu_key_aqui`
4. ✅ Ejecuta: `deno run --allow-net --allow-env --allow-read scripts/ejecutar-migraciones-auto.ts`
5. ✅ ¡Listo! Las migraciones se aplicarán automáticamente

---

**¿Necesitas ayuda?** Si tienes problemas, puedo ayudarte a verificar la configuración paso a paso.
