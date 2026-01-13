function todayYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const calculateMaxPages = () => {
  const raw = process.env.MAX_PAGES;
  if (raw == null || String(raw).trim() === '') return 1;
  if (String(raw).trim().toLowerCase() === 'auto') return null;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : 1;
};

/**
 * Pool de User-Agents reales (Chrome/Firefox/Safari) para rotación aleatoria.
 * Nota: mantenerlos “plausibles” y relativamente recientes para reducir flags anti-bot.
 */
const USER_AGENTS = [
  // Chrome (Windows)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Chrome (Windows 11)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
  // Chrome (macOS)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  // Chrome (Linux)
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  // Firefox (Windows)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
  // Firefox (macOS)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.2; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.3; rv:123.0) Gecko/20100101 Firefox/123.0',
  // Firefox (Linux)
  'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0',
  // Safari (macOS)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  // Mobile (para variar fingerprints; usar con moderación)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36'
];

function pickRandom(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomUserAgent() {
  return pickRandom(USER_AGENTS) || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
}

/**
 * Parámetros de resiliencia/anti-bloqueo (delays con jitter).
 * - entre requests (API/detalle): 2–5s
 * - entre “páginas” (listado por fecha): 5–15s
 * - jitter: ±30% aplicado al delay seleccionado
 * - pausa por bloqueo: 5 min, luego backoff exponencial en reintentos
 */
const antiBlock = {
  requestDelayMs: { min: 2000, max: 5000 },
  pageDelayMs: { min: 5000, max: 15000 },
  jitterPct: 0.3,
  blockPauseMs: 5 * 60 * 1000,
  maxAttempts: 5,
  apiTimeoutMs: 30 * 1000,
  puppeteerTimeoutMs: 60 * 1000
};

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
  maxPages: calculateMaxPages(),
  maxRetries: 3,
  navigationTimeoutMs: 180000,
  resultsTimeoutMs: 150000,
  delayBetweenPagesMs: {
    min: 2000,
    max: 5000
  },
  // Guardar progreso local cada N páginas (si aplica)
  saveEveryPages: 50,
  outputDir: './output',
  outputPath: './output/compras_agiles.json',
  progressPath: './output/progress_compras.json',
  /**
   * Headless recomendado en entornos sin display (CI/servidor).
   * Puedes desactivar con --headed.
   */
  headless: true,
  // Anti-bloqueo: UA rotatorios + tiempos
  USER_AGENTS,
  getRandomUserAgent,
  antiBlock
};
