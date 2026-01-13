function parseDateCL(dateStr) {
  // "08/01/2026 13:24" -> "2026-01-08T13:24:00"
  if (!dateStr) return null;
  const cleaned = String(dateStr).trim();
  const m = cleaned.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, HH, MM] = m;
  return `${yyyy}-${mm}-${dd}T${HH}:${MM}:00`;
}

function parseBudgetCLP(budgetStr) {
  // "$ 300.000" / "$300.000" -> 300000
  if (!budgetStr) return null;
  const digits = String(budgetStr).replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

function splitOrganismoDepartamento(raw) {
  if (!raw) return { organismo: '', departamento: '' };
  const cleaned = String(raw).trim().replace(/\s+/g, ' ');
  const parts = cleaned.split(' - ').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return {
      organismo: parts[0],
      departamento: parts.slice(1).join(' - ')
    };
  }
  return { organismo: cleaned, departamento: '' };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

async function sleepRandom(minMs, maxMs) {
  const ms = randomInt(minMs, maxMs);
  await sleep(ms);
}

function applyJitter(ms, jitterPct = 0.3) {
  const base = Number(ms);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const pct = Math.max(0, Math.min(1, Number(jitterPct)));
  const delta = base * pct;
  const jittered = base + (Math.random() * 2 - 1) * delta; // ±delta
  return Math.max(0, Math.round(jittered));
}

async function sleepRandomWithJitter(minMs, maxMs, jitterPct = 0.3) {
  const ms = randomInt(minMs, maxMs);
  await sleep(applyJitter(ms, jitterPct));
}

function toIsoNow() {
  return new Date().toISOString();
}

module.exports = {
  parseDateCL,
  parseBudgetCLP,
  splitOrganismoDepartamento,
  sleep,
  sleepRandom,
  applyJitter,
  sleepRandomWithJitter,
  toIsoNow
};

