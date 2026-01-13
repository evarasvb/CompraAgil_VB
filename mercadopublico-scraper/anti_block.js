const config = require('./config');
const { sleep, sleepRandomWithJitter, applyJitter } = require('./utils');

// Puppeteer + stealth (mismo stack que scraper.js)
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// -----------------------------
// Estado global (por proceso)
// -----------------------------
const blockState = {
  // timestamps (ms) de bloqueos recientes (API + Puppeteer)
  recentBlockTs: [],
  // consecutive 429 detectados (para rate limiting)
  consecutive429: 0,
  // métricas acumuladas (se imprimen como JSON lines)
  metrics: {
    blocksTotal: 0,
    blocksByReason: {},
    blocksByKind: {},
    // YYYY-MM-DDTHH => count
    blocksByHour: {},
    // YYYY-MM-DD => count
    blocksByDay: {}
  },
  // circuito abierto hasta este timestamp (ms)
  circuitOpenUntilMs: 0
};

let stealthEnabled = false;
function ensureStealth() {
  if (stealthEnabled) return;
  puppeteer.use(StealthPlugin());
  stealthEnabled = true;
}

class BlockDetectedError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'BlockDetectedError';
    this.meta = meta;
  }
}

class TimeoutError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'TimeoutError';
    this.meta = meta;
  }
}

class CircuitBreakerOpenError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.meta = meta;
  }
}

function buildRealisticHeaders({ userAgent, accept = 'application/json' } = {}) {
  const ua = userAgent || config.getRandomUserAgent();
  return {
    accept,
    'accept-language': 'es-CL,es;q=0.9,en-US;q=0.8,en;q=0.7',
    // Nota: en Node no siempre se negocia br; pero declarar Accept-Encoding ayuda a parecer browser.
    'accept-encoding': 'gzip, deflate, br',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    dnt: '1',
    'user-agent': ua,
    referer: 'https://www.mercadopublico.cl/',
    origin: 'https://www.mercadopublico.cl',
    connection: 'keep-alive'
  };
}

function looksLikeHtml(text) {
  const s = String(text || '').trim().toLowerCase();
  return s.startsWith('<!doctype html') || s.startsWith('<html') || s.includes('<head') || s.includes('<body');
}

function looksLikeCaptchaOrWaf(text) {
  const s = String(text || '').toLowerCase();
  return (
    s.includes('captcha') ||
    s.includes('recaptcha') ||
    s.includes('hcaptcha') ||
    s.includes('cloudflare') ||
    s.includes('attention required') ||
    s.includes('access denied') ||
    s.includes('request blocked') ||
    s.includes('robot') ||
    s.includes('waf') ||
    s.includes('akamai') ||
    s.includes('incapsula')
  );
}

function detectBlock({ status, text, contentType } = {}) {
  const ct = String(contentType || '').toLowerCase();
  if ([403, 429, 504].includes(status)) return { blocked: true, reason: `http_${status}` };

  // Algunos WAF devuelven 200 con HTML de challenge/captcha
  if (ct.includes('text/html') || looksLikeHtml(text)) {
    if (looksLikeCaptchaOrWaf(text)) return { blocked: true, reason: 'captcha_or_waf_html' };
    // HTML inesperado en endpoint JSON lo tratamos como bloqueo blando
    return { blocked: true, reason: 'unexpected_html' };
  }

  return { blocked: false, reason: null };
}

function isRetryableForFallback(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  const status = err?.meta?.status;
  if (err?.name === 'TimeoutError') return true;
  if (err?.name === 'BlockDetectedError') return true;
  if (err?.name === 'CircuitBreakerOpenError') return true;
  if ([403, 429, 504].includes(status)) return true;
  if (msg.includes('timeout') || msg.includes('timed out')) return true;
  return false;
}

function logBlockEvent(event) {
  try {
    // JSON line para análisis posterior (CloudWatch/Actions logs)
    console.warn(
      `[anti-block] ${JSON.stringify({
        ts: new Date().toISOString(),
        ...event
      })}`
    );
  } catch (_) {
    console.warn('[anti-block] bloqueo detectado (no pude serializar evento)');
  }
}

function bumpBlockMetrics({ kind, reason } = {}) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH

  blockState.metrics.blocksTotal += 1;
  const r = String(reason || 'unknown');
  const k = String(kind || 'unknown');
  blockState.metrics.blocksByReason[r] = (blockState.metrics.blocksByReason[r] || 0) + 1;
  blockState.metrics.blocksByKind[k] = (blockState.metrics.blocksByKind[k] || 0) + 1;
  blockState.metrics.blocksByHour[hour] = (blockState.metrics.blocksByHour[hour] || 0) + 1;
  blockState.metrics.blocksByDay[day] = (blockState.metrics.blocksByDay[day] || 0) + 1;
}

function pruneRecentBlocks(nowMs) {
  const windowMs = config.antiBlock?.circuitBreaker?.windowMs ?? 5 * 60 * 1000;
  const cutoff = nowMs - windowMs;
  blockState.recentBlockTs = blockState.recentBlockTs.filter((t) => t >= cutoff);
}

function recordBlockForCircuitBreaker() {
  const nowMs = Date.now();
  blockState.recentBlockTs.push(nowMs);
  pruneRecentBlocks(nowMs);

  const threshold = config.antiBlock?.circuitBreaker?.threshold ?? 3;
  const openMs = config.antiBlock?.circuitBreaker?.openMs ?? 30 * 60 * 1000;
  if (blockState.recentBlockTs.length >= threshold) {
    const until = nowMs + openMs;
    if (until > blockState.circuitOpenUntilMs) {
      blockState.circuitOpenUntilMs = until;
      logBlockEvent({
        action: 'circuit_open',
        windowMs: config.antiBlock?.circuitBreaker?.windowMs ?? 5 * 60 * 1000,
        threshold,
        openMs,
        openUntil: new Date(until).toISOString()
      });
    }
  }
}

async function enforceCircuitBreaker({ kind, url, context } = {}) {
  const nowMs = Date.now();
  if (!blockState.circuitOpenUntilMs || nowMs >= blockState.circuitOpenUntilMs) return;

  const remainingMs = blockState.circuitOpenUntilMs - nowMs;
  const mode =
    (config.antiBlock?.circuitBreaker?.mode || '').trim() ||
    (process.env.GITHUB_ACTIONS ? 'failfast' : 'sleep');

  logBlockEvent({ action: 'circuit_open_block', mode, remainingMs, kind, url, context });
  if (mode === 'sleep') {
    await sleep(remainingMs);
    return;
  }
  throw new CircuitBreakerOpenError(`Circuit breaker abierto (${Math.round(remainingMs / 1000)}s restantes)`, {
    kind,
    url,
    remainingMs,
    context
  });
}

async function pauseOnBlock(attempt, meta) {
  // Requisito: pausar 5 minutos al detectar bloqueo, luego backoff exponencial
  const pauseBase = config.antiBlock?.blockPauseMs ?? 5 * 60 * 1000;
  const backoffBase = 30 * 1000;
  const backoff = attempt <= 1 ? pauseBase : backoffBase * Math.pow(2, attempt - 2); // 30s, 60s, 120s...
  const sleepMs = applyJitter(backoff, config.antiBlock?.jitterPct ?? 0.3);
  logBlockEvent({ action: 'pause', sleepMs, attempt, ...meta });
  await sleep(sleepMs);
}

async function fetchTextWithTimeout(url, { headers, timeoutMs } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs || config.antiBlock.apiTimeoutMs || 30000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.toLowerCase().includes('aborted') || msg.toLowerCase().includes('abort')) {
      throw new TimeoutError(`Timeout al pedir ${url}`, { url });
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function fetchJsonResilient(url, { context, timeoutMs, maxAttempts } = {}) {
  const attempts = maxAttempts ?? config.antiBlock?.maxAttempts ?? 5;

  // Si el circuito está abierto, aplica política (sleep o failfast)
  await enforceCircuitBreaker({ kind: 'api', url, context });

  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ua = config.getRandomUserAgent();
    const headers = buildRealisticHeaders({ userAgent: ua, accept: 'application/json' });

    try {
      const { res, text } = await fetchTextWithTimeout(url, { headers, timeoutMs });
      const contentType = res.headers.get('content-type') || '';

      const block = detectBlock({ status: res.status, text, contentType });
      if (block.blocked) {
        // Rate limit heurística: 429 consecutivos
        if (res.status === 429) blockState.consecutive429 += 1;
        else blockState.consecutive429 = 0;

        bumpBlockMetrics({ kind: 'api', reason: block.reason });
        recordBlockForCircuitBreaker();
        logBlockEvent({ kind: 'api', url, status: res.status, reason: block.reason, attempt, context });
        throw new BlockDetectedError(`Bloqueo detectado (API): ${block.reason}`, {
          url,
          status: res.status,
          reason: block.reason,
          context
        });
      }

      if (!res.ok) {
        // Error no-clasificado como bloqueo (ej. 400/404/500)
        const err = new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
        err.meta = { url, status: res.status, context };
        throw err;
      }

      try {
        return JSON.parse(text);
      } catch (e) {
        // Si no es JSON, probablemente es HTML/otro payload
        const block2 = detectBlock({ status: res.status, text, contentType: contentType || 'unknown' });
        if (block2.blocked) {
          bumpBlockMetrics({ kind: 'api', reason: block2.reason });
          recordBlockForCircuitBreaker();
          logBlockEvent({ kind: 'api', url, status: res.status, reason: block2.reason, attempt, context });
          throw new BlockDetectedError(`Bloqueo detectado (API parse): ${block2.reason}`, {
            url,
            status: res.status,
            reason: block2.reason,
            context
          });
        }
        throw new Error(`Respuesta no-JSON inesperada: ${String(e?.message || e)}`);
      }
    } catch (err) {
      lastErr = err;
      const retryable = err?.name === 'BlockDetectedError' || err?.name === 'TimeoutError';
      if (retryable && attempt < attempts) {
        // En caso de muchos 429 consecutivos, abrimos circuito agresivamente (evita martillar)
        const limitN = config.antiBlock?.rateLimit429?.threshold ?? 3;
        if (blockState.consecutive429 >= limitN) {
          recordBlockForCircuitBreaker();
        }
        await pauseOnBlock(attempt, {
          kind: 'api',
          url,
          status: err?.meta?.status,
          reason: err?.meta?.reason || err?.name || 'error',
          context
        });
        continue;
      }
      break;
    } finally {
      // Entre requests: 2–5s con jitter (siempre que no estemos en pausa larga)
      await sleepRandomWithJitter(
        config.antiBlock.requestDelayMs.min,
        config.antiBlock.requestDelayMs.max,
        config.antiBlock.jitterPct
      );
    }
  }

  throw lastErr;
}

async function createStealthBrowser({ headless } = {}) {
  ensureStealth();
  const proxy = config.getRandomProxy?.() || null;
  const browser = await puppeteer.launch({
    headless: headless === false ? false : 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      ...(proxy ? [`--proxy-server=${proxy}`] : [])
    ]
  });
  return browser;
}

function pickRandom(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomViewport() {
  const vp = pickRandom([
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
    { width: 1600, height: 900 },
    { width: 1920, height: 1080 }
  ]);
  return vp || { width: 1440, height: 900 };
}

function randomTimezone() {
  // Mantener cerca de Chile para coherencia, pero variar un poco el fingerprint.
  return (
    pickRandom(['America/Santiago', 'America/Lima', 'America/Argentina/Buenos_Aires', 'America/Bogota']) || 'America/Santiago'
  );
}

async function simulateHumanBehavior(page) {
  try {
    const vp = page.viewport();
    const w = vp?.width || 1200;
    const h = vp?.height || 800;
    // pequeños movimientos de mouse + pausas
    const steps = 6 + Math.floor(Math.random() * 6);
    for (let i = 0; i < steps; i++) {
      const x = 10 + Math.floor(Math.random() * (w - 20));
      const y = 10 + Math.floor(Math.random() * (h - 20));
      await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 10) });
      await sleep(60 + Math.floor(Math.random() * 180));
    }
    // scroll leve (solo si hay DOM)
    await page.evaluate(() => {
      try {
        window.scrollBy(0, Math.floor(100 + Math.random() * 300));
      } catch (_) {}
    });
  } catch (_) {
    // best-effort
  }
}

async function fetchJsonViaPuppeteer(browser, url, { context, timeoutMs } = {}) {
  await enforceCircuitBreaker({ kind: 'puppeteer', url, context });
  const page = await browser.newPage();
  const ua = config.getRandomUserAgent();
  try {
    const tz = randomTimezone();
    await page.evaluateOnNewDocument(() => {
      // hardening similar a scraper.js
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      } catch (_) {}
      try {
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      } catch (_) {}
      try {
        Object.defineProperty(navigator, 'languages', { get: () => ['es-CL', 'es', 'en'] });
      } catch (_) {}
      try {
        window.chrome = window.chrome || { runtime: {} };
      } catch (_) {}
      // WebGL fingerprint (simple, best-effort)
      try {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (p) {
          // UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL
          if (p === 37445) return 'Google Inc.';
          if (p === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
          return getParameter.call(this, p);
        };
      } catch (_) {}
    });
    try {
      await page.emulateTimezone(tz);
    } catch (_) {}
    await page.setViewport(randomViewport());
    await page.setUserAgent(ua);
    await page.setExtraHTTPHeaders({
      'accept-language': 'es-CL,es;q=0.9,en-US;q=0.8,en;q=0.7',
      accept: 'application/json, text/plain, */*',
      pragma: 'no-cache',
      'cache-control': 'no-cache'
    });
    page.setDefaultNavigationTimeout(timeoutMs || config.antiBlock.puppeteerTimeoutMs || 60000);

    const resp = await page.goto(url, { waitUntil: 'networkidle2' });
    if (!resp) throw new Error('Puppeteer: sin response (resp=null)');
    const status = resp.status();
    const headers = resp.headers();
    const text = await resp.text();
    const block = detectBlock({ status, text, contentType: headers['content-type'] || '' });
    if (block.blocked) {
      bumpBlockMetrics({ kind: 'puppeteer', reason: block.reason });
      recordBlockForCircuitBreaker();
      logBlockEvent({ kind: 'puppeteer', url, status, reason: block.reason, attempt: 1, context });
      throw new BlockDetectedError(`Bloqueo detectado (Puppeteer): ${block.reason}`, {
        url,
        status,
        reason: block.reason,
        context
      });
    }
    if (status >= 400) {
      const err = new Error(`HTTP ${status}: ${text.slice(0, 500)}`);
      err.meta = { url, status, context };
      throw err;
    }

    await simulateHumanBehavior(page);
    return JSON.parse(text);
  } finally {
    await page.close();
    await sleepRandomWithJitter(
      config.antiBlock.requestDelayMs.min,
      config.antiBlock.requestDelayMs.max,
      config.antiBlock.jitterPct
    );
  }
}

function getBlockMetricsSnapshot() {
  return {
    ...blockState.metrics,
    circuitOpenUntil: blockState.circuitOpenUntilMs ? new Date(blockState.circuitOpenUntilMs).toISOString() : null,
    consecutive429: blockState.consecutive429
  };
}

module.exports = {
  BlockDetectedError,
  TimeoutError,
  CircuitBreakerOpenError,
  buildRealisticHeaders,
  detectBlock,
  isRetryableForFallback,
  fetchJsonResilient,
  createStealthBrowser,
  fetchJsonViaPuppeteer,
  getBlockMetricsSnapshot
};

