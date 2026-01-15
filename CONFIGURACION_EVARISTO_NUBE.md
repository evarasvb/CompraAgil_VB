# ☁️ Configuración de Evaristo en la Nube

## 🎯 Objetivo

Hacer que **Evaristo trabaje automáticamente mientras duermes** y tu computador está apagado, ejecutándose en la nube sin necesidad de mantener tu máquina encendida.

## ✅ Solución Recomendada: GitHub Actions

**Ventajas**:
- ✅ **100% Gratis** (hasta 2000 minutos/mes)
- ✅ **Ejecuta en la nube** (no necesitas tu computador)
- ✅ **Automático** (se ejecuta según cron schedule)
- ✅ **Ya lo tienes configurado** (solo agregar el workflow)
- ✅ **Notificaciones** (emails de GitHub cuando completa)
- ✅ **Reportes** (artefactos descargables)
- ✅ **Commits automáticos** (Evaristo puede hacer cambios y commitear)

## 🚀 Configuración Paso a Paso

### 1. Agregar Secrets en GitHub

Ve a tu repositorio en GitHub:
1. **Settings** → **Secrets and variables** → **Actions**
2. Agrega estos secrets:

```
DEEPSEEK_API_KEY = sk-58fc334d3e4443c4a0fecf2bc8aaa178
GEMINI_API_KEY = (opcional, si tienes)
```

### 2. Workflow Creado

Ya creé el workflow en:
```
.github/workflows/evaristo-autonomo.yml
```

Este workflow:
- ✅ Se ejecuta **cada día a las 2:00 AM UTC** (22:00-23:00 hora Chile)
- ✅ Ejecuta la misión `mantenimiento_automatico.json`
- ✅ Puede ejecutarse manualmente desde GitHub
- ✅ Hace commit automático si Evaristo modifica código
- ✅ Guarda reportes como artefactos

### 3. Activar el Workflow

El workflow se activará automáticamente. Para probarlo manualmente:

1. Ve a **Actions** en GitHub
2. Selecciona **"Evaristo Autónomo - Mantenimiento Continuo"**
3. Click en **"Run workflow"**
4. Selecciona la rama (main/master)
5. Opcional: cambia el archivo de misión
6. Click **"Run workflow"**

## 📊 Cómo Ver los Resultados

### En GitHub Actions:
1. Ve a **Actions** → **Evaristo Autónomo**
2. Click en la ejecución más reciente
3. Verás:
   - Logs completos de Evaristo
   - Resumen de misiones completadas
   - Artefactos con reportes descargables

### Reportes Descargables:
- Cada ejecución genera artefactos con:
  - `resumen_latest.json` - Resumen de la ejecución
  - `reporte_YYYYMMDD_HHMMSS.json` - Reportes detallados
  - `evaristo.log` - Log completo

### Commits Automáticos:
- Si Evaristo modifica código, hace commit automático
- Mensaje: `🤖 Evaristo: Mantenimiento automático YYYY-MM-DD HH:MM`
- Puedes revisar los cambios en el commit

## ⏰ Horario de Ejecución

**Configurado para**: Cada día a las **2:00 AM UTC**

**Hora en Chile**:
- **Verano (UTC-3)**: 23:00 (11 PM)
- **Invierno (UTC-4)**: 22:00 (10 PM)

**Para cambiar el horario**, edita el cron en `.github/workflows/evaristo-autonomo.yml`:

```yaml
schedule:
  - cron: '0 2 * * *'  # 2:00 AM UTC
```

Ejemplos:
- `'0 6 * * *'` = 6:00 AM UTC (3:00 AM Chile verano)
- `'0 0 * * *'` = Medianoche UTC (9 PM Chile verano)
- `'0 */6 * * *'` = Cada 6 horas

## 🔔 Notificaciones

### Email de GitHub:
1. Ve a **Settings** → **Notifications**
2. Activa notificaciones para:
   - Workflow runs (éxito/fallo)
   - Workflow runs que requieren acción

### Alternativa: Webhook a Slack/Discord
Puedes configurar un webhook para recibir notificaciones en tiempo real.

## 💰 Costos

**GitHub Actions**: 
- **Gratis** hasta 2000 minutos/mes
- Evaristo ejecuta ~5-10 minutos por día
- **Total**: ~150-300 minutos/mes
- **Costo**: $0 (dentro del plan gratuito)

**DeepSeek API**:
- Ya tienes $2 USD de crédito
- Costo por ejecución: ~$0.001-0.01 USD
- **Duración estimada**: 200-2000 ejecuciones

## 🔄 Alternativas (Si GitHub Actions no te convence)

### Opción 2: Railway.app (Recomendado si necesitas más control)
- **Costo**: ~$5/mes (plan hobby)
- **Ventaja**: Servidor siempre activo, puedes ejecutar Evaristo en loop
- **Setup**: Desplegar como servicio Python

### Opción 3: Render.com
- **Costo**: Gratis (con limitaciones) o $7/mes
- **Ventaja**: Similar a Railway
- **Setup**: Cron job o servicio web

### Opción 4: Supabase Edge Functions (Requiere adaptación)
- **Costo**: Gratis (hasta cierto límite)
- **Desventaja**: Necesitarías adaptar Evaristo a Deno/TypeScript
- **Ventaja**: Ya está en tu stack

## ✅ Checklist de Configuración

- [x] Workflow creado (`.github/workflows/evaristo-autonomo.yml`)
- [ ] Agregar `DEEPSEEK_API_KEY` a GitHub Secrets
- [ ] (Opcional) Agregar `GEMINI_API_KEY` a GitHub Secrets
- [ ] Hacer commit y push del workflow
- [ ] Verificar que el workflow aparezca en Actions
- [ ] Ejecutar manualmente una vez para probar
- [ ] Configurar notificaciones de email en GitHub

## 🎯 Próximos Pasos

1. **Haz commit y push** del workflow:
   ```bash
   git add .github/workflows/evaristo-autonomo.yml
   git commit -m "Agregar workflow de Evaristo autónomo"
   git push
   ```

2. **Agrega los secrets** en GitHub (Settings → Secrets)

3. **Prueba manualmente** desde GitHub Actions

4. **Verifica** que funcione correctamente

5. **Disfruta** - Evaristo trabajará automáticamente cada noche 🎉

---

**Con esta configuración, Evaristo trabajará todas las noches mientras duermes** 🤖✨
