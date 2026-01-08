module.exports = {
  baseUrl: 'https://buscador.mercadopublico.cl/compra-agil',
  params: {
    date_from: '2025-12-09',
    date_to: '2026-01-08',
    order_by: 'recent',
    region: 'all',
    status: '2'
  },
  /**
   * Si `maxPages` es null, se intentará calcular con el total de resultados / 15.
   * Puedes fijarlo manualmente (ej. 314) si el sitio no entrega el total de forma confiable.
   */
  maxPages: null,
  maxRetries: 3,
  navigationTimeoutMs: 60000,
  resultsTimeoutMs: 45000,
  delayBetweenPagesMs: {
    min: 2000,
    max: 5000
  },
  saveEveryPages: 10,
  outputDir: './output',
  outputPath: './output/compras_agiles.json',
  progressPath: './output/progress_compras.json',
  /**
   * Headless recomendado en entornos sin display (CI/servidor).
   * Puedes desactivar con --headed.
   */
  headless: true
};

