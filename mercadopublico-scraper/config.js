function todayYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

module.exports = {
  baseUrl: 'https://buscador.mercadopublico.cl/compra-agil',
  params: {
    // Por defecto: HOY (se puede override con --from/--to)
    date_from: todayYYYYMMDD(),
    date_to: todayYYYYMMDD(),
    order_by: 'recent',
    region: 'all',
    status: '2'
  },
  /**
   * Si `maxPages` es null, se intentará calcular con el total de resultados / 15.
   * Puedes fijarlo manualmente (ej. 314) si el sitio no entrega el total de forma confiable.
   */
  maxPages: (() => {
    // Por defecto 1 para testing (override con env MAX_PAGES)
    const raw = process.env.MAX_PAGES;
    if (raw == null || String(raw).trim() === '') return 1;
    if (String(raw).trim().toLowerCase() === 'auto') return null;
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : 1;
  })(),
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

