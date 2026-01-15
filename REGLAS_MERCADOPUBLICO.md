# 📚 Reglas de Negocio de MercadoPúblico - Documento Completo

## 🎯 Clasificación por Monto (UTM)

### Regla Fundamental

**COMPRAS ÁGILES**: Monto **<= 100 UTM**
- **L1 - Licitación Pública Menor**: < 100 UTM
- Plazo mínimo: 5 días corridos
- Generalmente NO exigen Garantía de Seriedad
- Ideal para venta masiva de certificados

**LICITACIONES**: Monto **> 100 UTM**
- **LE - Licitación Pública Intermedia**: 100 a 1.000 UTM
  - Plazo mínimo: 10 días corridos (rebajable a 5 si son bienes simples)
  - Garantía de Seriedad: Discrecional
- **LP - Licitación Pública Mayor**: 1.000 a 5.000 UTM
  - Plazo mínimo: 20 días corridos
  - Exige Garantía de Fiel Cumplimiento (5% del contrato)
  - Firma Electrónica Avanzada (FEA) a menudo obligatoria
- **LR - Licitación Pública de Gran Compra**: > 5.000 UTM
  - Plazo mínimo: 30 días corridos
  - Máxima rigurosidad formal
  - Requiere UTP (Uniones Temporales) a menudo

## 📊 Valores UTM

- **UTM Enero 2026**: $69.751 CLP
- **Umbral Compra Ágil**: 100 UTM = **$6.975.100 CLP**

## 🔧 Implementación Técnica

### Función de Clasificación

```typescript
function clasificarProceso(monto: number): {
  tipo: 'compra_agil' | 'licitacion',
  categoria: 'L1' | 'LE' | 'LP' | 'LR',
  requiereFEA: boolean,
  requiereGarantia: boolean
} {
  const montoUTM = monto / 69751;
  
  if (montoUTM <= 100) {
    return {
      tipo: 'compra_agil',
      categoria: 'L1',
      requiereFEA: false,
      requiereGarantia: false
    };
  } else if (montoUTM <= 1000) {
    return {
      tipo: 'licitacion',
      categoria: 'LE',
      requiereFEA: false,
      requiereGarantia: false // Discrecional
    };
  } else if (montoUTM <= 5000) {
    return {
      tipo: 'licitacion',
      categoria: 'LP',
      requiereFEA: true, // A menudo obligatoria
      requiereGarantia: true // 5% del contrato
    };
  } else {
    return {
      tipo: 'licitacion',
      categoria: 'LR',
      requiereFEA: true,
      requiereGarantia: true
    };
  }
}
```

## ⚠️ Cambios Normativos 2024-2025

- **LQ eliminada**: Ya no existe, absorbida por L1/LE
- **Nueva Ley N° 21.634**: Modernización de compras públicas
- **Principio de Combinación Más Ventajosa**: No solo precio, también sustentabilidad, ciclo de vida, etc.

## 🔐 Firma Electrónica

- **Firma Simple**: Para L1 (compras ágiles)
- **FEA (Firma Electrónica Avanzada)**: Obligatoria para LP, LR, y a menudo para LE

## 💰 Garantías

- **Seriedad de Oferta**: Obligatoria sobre 2.000 UTM
- **Fiel Cumplimiento**: 5-30% del contrato, obligatoria > 1.000 UTM

## 📡 API MercadoPúblico

- **Endpoint**: `http://api.mercadopublico.cl/servicios/v1/publico/`
- **Horario Masivo**: 22:00 - 07:00 hrs
- **Horario Transaccional**: 07:01 - 21:59 hrs
- **Formato**: JSON recomendado

## 🏷️ Códigos de Estado

- **5**: Publicada (activa)
- **6**: Cerrada (en evaluación)
- **7**: Desierta (sin ofertas)
- **8**: Adjudicada (finalizada)
- **18**: Revocada (cancelada)
- **19**: Suspendida (pausada)

## 📦 UNSPSC

Estructura jerárquica:
- Segmento (XX.00.00.00)
- Familia (XX.XX.00.00)
- Clase (XX.XX.XX.00)
- Producto (XX.XX.XX.XX)

---

**Fuente**: Informe de Inteligencia Técnica y Estratégica - Ecosistema de Compras Públicas
**Última actualización**: Enero 2026
