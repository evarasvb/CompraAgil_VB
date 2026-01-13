# Extensión Chrome: FirmaVB Postulador

Esta extensión ejecuta la “postulación” **desde el navegador** (con el usuario logueado en MercadoPúblico) y sincroniza estados con Supabase.

## Qué hace

- Detecta el **código** (licitación/compra ágil) en la pestaña actual de MercadoPúblico.
- Consulta en Supabase `cliente_ofertas` con `estado='aprobada'` para ese código.
- Permite marcar el resultado en Supabase:
  - `estado='enviada'`
  - `estado='fallida'`
- Guarda trazabilidad en `respuesta_mp` (timestamp + URL + acción).

> Nota: La automatización “real” de completar formularios (autofill/clicks) depende del DOM de MercadoPúblico. Aquí dejamos el esqueleto de sincronización + tracking. El siguiente paso es agregar los selectores y el flujo exacto por pantalla.

## Requisitos

- Tener un `cliente_id` existente en Supabase.
- Tener políticas/RLS que permitan al `anon key` leer/actualizar `cliente_ofertas` **o** usar una capa intermedia (Edge Function) para la extensión.

## Instalación

1) Chrome → `chrome://extensions`
2) Activar “Developer mode”
3) “Load unpacked” → seleccionar la carpeta `chrome-extension/`

## Configuración

En el popup:
- **Supabase URL**: `https://xxxx.supabase.co`
- **Supabase anon key**
- **Cliente ID** (UUID)

## Seguridad (importante)

- No pegues `SUPABASE_SERVICE_KEY` en la extensión.
- Lo recomendado es:
  - `anon key` + RLS estricto, o
  - Edge Function “proxy” con API key propia de extensión.

