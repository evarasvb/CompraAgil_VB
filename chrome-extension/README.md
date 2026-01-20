# CompraAgil VB - Extension Chrome

Extension de Chrome para sincronizar automaticamente las Compras Agiles de Mercado Publico con Supabase.

## Instalacion

### Opcion 1: Descarga directa

1. **Descargar el repositorio**
   - Click en el boton verde "Code" arriba
   - Seleccionar "Download ZIP"
   - Descomprimir el archivo

2. **Instalar en Chrome**
   - Abrir Chrome y navegar a `chrome://extensions/`
   - Activar "Modo desarrollador" (esquina superior derecha)
   - Click en "Cargar extension sin empaquetar"
   - Seleccionar la carpeta `chrome-extension` del repositorio descargado

### Opcion 2: Clonar con Git

```bash
git clone https://github.com/evarasvb/CompraAgil_VB.git
cd CompraAgil_VB/chrome-extension
```

Luego seguir el paso 2 de la Opcion 1.

## Uso

1. Una vez instalada, navegar a [Mercado Publico - Compra Agil](https://buscador.mercadopublico.cl/compra-agil)
2. La extension detectara automaticamente las compras agiles en la pagina
3. Los datos se sincronizaran automaticamente con Supabase
4. Puedes hacer click en el icono de la extension para ver el estado y sincronizar manualmente

## Funcionalidades

- Extraccion automatica de datos del listado de compras agiles
- Extraccion de detalles completos desde fichas individuales
- Sincronizacion en tiempo real con Supabase
- Indicador visual de estado de sincronizacion
- Sincronizacion manual desde el popup

## Datos extraidos

- Codigo de compra agil
- Nombre/descripcion
- Organismo comprador
- Region
- Fecha de publicacion
- Monto estimado
- Estado
- Detalle de productos (desde ficha)

## Configuracion

La extension viene preconfigurada con las credenciales de Supabase de FirmaVB.

## Soporte

Contactar a [FirmaVB](https://firmavb.cl) para soporte tecnico.
