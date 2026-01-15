# 🚀 Instrucciones para Configurar Evaristo en la Nube

## ✅ Paso 1: Agregar Secret en GitHub (2 minutos)

1. Ve a tu repositorio en GitHub: `https://github.com/evarasvb/CompraAgil_VB`
2. Click en **Settings** (arriba a la derecha)
3. En el menú lateral, click en **Secrets and variables** → **Actions**
4. Click en **"New repository secret"**
5. Completa:
   - **Name**: `DEEPSEEK_API_KEY`
   - **Secret**: `sk-58fc334d3e4443c4a0fecf2bc8aaa178`
6. Click **"Add secret"**

✅ **Listo!** El secret está configurado.

## ✅ Paso 2: Hacer Commit y Push (1 minuto)

Ejecuta estos comandos en tu terminal:

```bash
cd /Users/marketingdiseno/CompraAgil_VB

# Agregar el workflow
git add .github/workflows/evaristo-autonomo.yml
git add CONFIGURACION_EVARISTO_NUBE.md
git add RECOMENDACION_EVARISTO.md

# Commit
git commit -m "🤖 Configurar Evaristo autónomo en GitHub Actions"

# Push
git push
```

✅ **Listo!** El workflow está en GitHub.

## ✅ Paso 3: Verificar que Funciona (2 minutos)

1. Ve a tu repositorio en GitHub
2. Click en la pestaña **Actions** (arriba)
3. Deberías ver el workflow **"Evaristo Autónomo - Mantenimiento Continuo"**
4. Para probarlo ahora:
   - Click en **"Evaristo Autónomo - Mantenimiento Continuo"**
   - Click en **"Run workflow"** (botón a la derecha)
   - Selecciona la rama (main/master)
   - Click **"Run workflow"**
5. Espera 5-10 minutos y verás los resultados

✅ **Listo!** Evaristo está configurado y funcionando.

## 📊 Cómo Ver los Resultados

### Después de cada ejecución:

1. Ve a **Actions** → **Evaristo Autónomo**
2. Click en la ejecución más reciente
3. Verás:
   - ✅ Logs completos de lo que hizo Evaristo
   - ✅ Resumen de misiones completadas
   - ✅ Si hubo cambios, verás un commit automático
   - ✅ Artefactos descargables con reportes

### Reportes Descargables:

En cada ejecución, puedes descargar:
- `resumen_latest.json` - Resumen de la ejecución
- `reporte_*.json` - Reportes detallados
- `evaristo.log` - Log completo

## ⏰ Horario de Ejecución

**Configurado para**: Cada día a las **2:00 AM UTC**

**En Chile**:
- **Verano (UTC-3)**: 23:00 (11 PM)
- **Invierno (UTC-4)**: 22:00 (10 PM)

**Para cambiar el horario**, edita `.github/workflows/evaristo-autonomo.yml` línea 6:
```yaml
- cron: '0 2 * * *'  # Cambia el 2 por la hora UTC que quieras
```

## 🔔 Notificaciones

### Email de GitHub:

1. Ve a **Settings** → **Notifications**
2. Activa:
   - ✅ **"Workflow runs"** → **"On success or failure"**
   - ✅ **"Workflow runs that require approval"**

Así recibirás email cada vez que Evaristo complete su trabajo.

## 🎯 Qué Hace Evaristo Cada Noche

Ejecuta automáticamente estas tareas:

1. ✅ Verificar compilación y tipos TypeScript
2. ✅ Revisar y optimizar hooks de datos
3. ✅ Optimizar servicios de matching
4. ✅ Revisar componentes del frontend
5. ✅ Verificar funciones Edge críticas
6. ✅ Mejorar diseño UI/UX
7. ✅ Verificar integraciones externas
8. ✅ Optimizar rendimiento
9. ✅ Revisar seguridad y validaciones
10. ✅ Actualizar documentación

Si encuentra mejoras, **modifica el código automáticamente** y hace commit.

## 💰 Costos

- **GitHub Actions**: $0 (dentro del plan gratuito)
- **DeepSeek API**: ~$0.001-0.01 por ejecución
- **Total estimado**: $0.03-0.30 por mes

## ✅ Checklist Final

- [ ] Secret `DEEPSEEK_API_KEY` agregado en GitHub
- [ ] Workflow commiteado y pusheado
- [ ] Workflow visible en Actions
- [ ] Ejecución manual de prueba exitosa
- [ ] Notificaciones de email configuradas

---

**¡Evaristo trabajará todas las noches mientras duermes!** 🤖✨
