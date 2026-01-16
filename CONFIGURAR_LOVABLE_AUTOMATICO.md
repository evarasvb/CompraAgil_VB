# 🔄 Configuración Automática: GitHub → Lovable

## 🎯 **Objetivo:**

Configurar la conexión automática de GitHub a Lovable para que **cada push** a GitHub dispare automáticamente un deployment en Lovable, igual que funciona Cursor → GitHub.

---

## ✅ **PASO 1: Verificar Repositorio en GitHub**

**Repositorio que Lovable debe monitorear:**
- ✅ **URL:** `https://github.com/evarasvb/agile-bidder`
- ✅ **Rama:** `main`
- ✅ **Carpeta:** Raíz del repositorio (no subcarpeta)

**Estado actual:**
- ✅ Repositorio existe
- ✅ Rama `main` activa
- ✅ Código sincronizado

---

## ✅ **PASO 2: Configurar Lovable Dashboard**

### **2.1. Conectar Repositorio (IMPORTANTE - Solo rama `main`):**

**⚠️ IMPORTANTE:** Lovable solo sincroniza la rama `main`. Los cambios en otras ramas no se reflejan hasta que se hagan merge a `main`.

1. **Abre Lovable Dashboard:**
   - Ve a: https://lovable.dev
   - Inicia sesión con tu cuenta

2. **Ve a Settings → Connectors / GitHub:**
   - ✅ Click en "Connect GitHub"
   - ✅ Autoriza vía OAuth (Lovable obtiene acceso a tu cuenta de GitHub)

3. **Instala la Lovable GitHub App:**
   - ✅ Instala la app de Lovable en tu organización/cuenta
   - ✅ Puedes dar acceso a todos los repos o solo a `agile-bidder`

4. **Conecta tu Proyecto:**
   - ✅ Selecciona org/cuenta: `evarasvb`
   - ✅ Selecciona repositorio: `agile-bidder`
   - ✅ Confirma la conexión
   - ✅ La sincronización comienza automáticamente (solo rama `main`)

### **2.2. Configurar Auto-Deploy (Lovable tiene su propio hosting):**

**Lovable tiene hosting integrado**, pero si quieres usar otro (Vercel, Netlify, etc.):

1. **Si usas hosting de Lovable:**
   - ✅ Los deployments son automáticos cuando haces push a `main`
   - ✅ No necesitas configuración adicional

2. **Si usas hosting externo (Vercel/Netlify):**
   - ✅ Conecta el repositorio `evarasvb/agile-bidder` en tu hosting
   - ✅ Configura para monitorear rama `main`
   - ✅ Build command: `npm run build`
   - ✅ Output directory: `dist`

3. **Settings → Environment Variables (en Lovable o tu hosting):**
   - ✅ `VITE_SUPABASE_URL` = `https://euzqadopjvdszcdjegmo.supabase.co`
   - ✅ `VITE_SUPABASE_PUBLISHABLE_KEY` = (tu clave anon de Supabase)

**⚠️ NOTA:** Lovable NO exporta archivos `.env` o credenciales. Debes configurar las variables de entorno manualmente en tu hosting.

---

## ✅ **PASO 3: Verificar Sincronización Bidireccional**

**Lovable sincroniza de forma bidireccional:**
- ✅ **Lovable → GitHub:** Cambios en Lovable se pushean a `main`
- ✅ **GitHub → Lovable:** Cambios en `main` se sincronizan a Lovable

**La Lovable GitHub App crea automáticamente:**
- ✅ Webhooks necesarios
- ✅ Permisos de lectura/escritura
- ✅ Sincronización automática

**Para verificar:**
1. Ve a: `https://github.com/evarasvb/agile-bidder/settings/installations`
2. Debe aparecer "Lovable" en las apps instaladas
3. Estado: ✅ Activo

**⚠️ IMPORTANTE:** 
- No renombres, muevas o elimines el repositorio - rompe la sincronización
- No uses `git push --force` - puede causar problemas de sincronización
- Solo la rama `main` se sincroniza automáticamente

---

## ✅ **PASO 4: Probar Sincronización Automática**

### **4.1. Hacer un cambio pequeño:**

```bash
cd mercadopublico-scraper/agile-bidder
# Hacer un cambio pequeño (ej: agregar un comentario)
git add .
git commit -m "test: Verificar auto-deploy en Lovable"
git push
```

### **4.2. Verificar en Lovable:**

1. **Espera 1-2 minutos** después del push
2. **Ve a Lovable → Deployments**
3. **Debe aparecer un nuevo deployment:**
   - ✅ Status: "Building" → "Deployed"
   - ✅ Commit: El último commit que hiciste
   - ✅ Tiempo: Reciente

### **4.3. Verificar en Producción:**

1. Abre la URL de producción de Lovable
2. Verifica que los cambios estén visibles
3. ✅ **Si funciona:** La sincronización automática está configurada

---

## 🔧 **CONFIGURACIÓN MANUAL (Si Auto-Deploy no funciona)**

### **Opción A: Webhook Manual de GitHub**

Si Lovable no crea el webhook automáticamente:

1. **Ve a GitHub:**
   - `https://github.com/evarasvb/agile-bidder/settings/hooks`
   - Click en "Add webhook"

2. **Configura el webhook:**
   - **Payload URL:** (URL del webhook de Lovable - obténla de Lovable Settings)
   - **Content type:** `application/json`
   - **Events:** Selecciona "Just the push event"
   - **Active:** ✅

3. **Guarda el webhook**

### **Opción B: GitHub Actions (Ya configurado)**

Ya creé un workflow en `.github/workflows/lovable-deploy.yml` que:
- ✅ Verifica que el build funcione
- ✅ Notifica cuando hay cambios listos para deploy
- ✅ Lovable puede detectar estos eventos

**Este workflow ya está activo** y se ejecuta en cada push a `main`.

---

## 📊 **FLUJO COMPLETO CONFIGURADO:**

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CURSOR (Local)                                          │
│    ✅ Haces cambios                                        │
│    ✅ git commit                                            │
│    ✅ git push                                              │
└─────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. GITHUB (Remoto)                                         │
│    ✅ Recibe el push                                        │
│    ✅ Webhook de Lovable se activa                         │
│    ✅ GitHub Actions se ejecuta (verificación)            │
└─────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. LOVABLE (Auto-Deploy)                                    │
│    ✅ Detecta el push (webhook)                             │
│    ✅ Inicia build automático                               │
│    ✅ Deploy a producción                                    │
└─────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. USUARIO FINAL (Producción)                               │
│    ✅ Ve los cambios automáticamente                        │
│    ✅ Todo sincronizado                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## ✅ **CHECKLIST DE CONFIGURACIÓN:**

### **GitHub:**
- [x] ✅ Repositorio: `evarasvb/agile-bidder`
- [x] ✅ Rama: `main`
- [x] ✅ Código sincronizado
- [x] ✅ GitHub Actions workflow creado

### **Lovable (VERIFICAR):**
- [ ] ⚠️ Repositorio conectado: `evarasvb/agile-bidder`
- [ ] ⚠️ Rama configurada: `main`
- [ ] ⚠️ Auto-Deploy activado
- [ ] ⚠️ Variables de entorno configuradas
- [ ] ⚠️ Webhook de GitHub activo

### **Prueba:**
- [ ] ⚠️ Hacer push de prueba
- [ ] ⚠️ Verificar deployment en Lovable
- [ ] ⚠️ Verificar cambios en producción

---

## 🎯 **RESUMEN:**

**Lo que YA está configurado:**
- ✅ GitHub Actions workflow para verificación
- ✅ Repositorio listo para Lovable
- ✅ Documentación completa

**Lo que DEBES hacer en Lovable:**
1. ⚠️ Conectar el repositorio `evarasvb/agile-bidder`
2. ⚠️ Activar Auto-Deploy
3. ⚠️ Configurar variables de entorno
4. ⚠️ Probar con un push

**Una vez configurado, cada push a GitHub disparará automáticamente un deployment en Lovable.** 🚀

---

## 🔧 **TROUBLESHOOTING:**

### **Lovable no detecta cambios:**
- Verifica que el webhook esté activo en GitHub
- Verifica que esté conectado a la rama `main`
- Haz un "Redeploy" manual en Lovable

### **Build falla en Lovable:**
- Verifica variables de entorno
- Revisa logs de build en Lovable
- Verifica que `package.json` tenga el script `build`

### **Deployment no se ejecuta:**
- Verifica que Auto-Deploy esté activado
- Verifica que el webhook esté funcionando
- Contacta soporte de Lovable si persiste

---

**Estado:** ✅ **Configuración lista**  
**Próximo paso:** Configurar en Lovable Dashboard
