const config = require('./config');
const { sleep, sleepRandomWithJitter, applyJitter } = require('./utils');

// Puppeteer + stealth (mismo stack que scraper.js)
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

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

  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ua = config.getRandomUserAgent();
    const headers = buildRealisticHeaders({ userAgent: ua, accept: 'application/json' });

    try {
      const { res, text } = await fetchTextWithTimeout(url, { headers, timeoutMs });
      const contentType = res.headers.get('content-type') || '';

      const block = detectBlock({ status: res.status, text, contentType });
      if (block.blocked) {
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
  const browser = await puppeteer.launch({
    headless: headless === false ? false : 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage']
  });
  return browser;
}

async function fetchJsonViaPuppeteer(browser, url, { context, timeoutMs } = {}) {
  const page = await browser.newPage();
  const ua = config.getRandomUserAgent();
  try {
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
    });
    await page.setViewport({ width: 1440, height: 900 });
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

module.exports = {
  BlockDetectedError,
  TimeoutError,
  buildRealisticHeaders,
  detectBlock,
  isRetryableForFallback,
  fetchJsonResilient,
  createStealthBrowser,
  fetchJsonViaPuppeteer
};

