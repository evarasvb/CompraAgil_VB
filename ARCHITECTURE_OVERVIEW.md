```mermaid
graph TD
    U[Usuario] -->|Solicita compra| FW[Frontend Web]
    FW -->|Envía datos| AB[API Backend]
    AB -->|Valida información| BD[Base de Datos]
    AB -->|Procesa pago| SP[Servicio de Pago]
    AB -->|Notifica| CE[Correo Electrónico]
    BD -->|Actualiza estado| AB
    SP -->|Confirma pago| AB
    CE -->|Envía confirmación| U
```