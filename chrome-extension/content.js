function extractCodigoFromUrl(url) {
  try {
    const u = new URL(url);
    // buscador ficha: ?code=XXXX
    const code = u.searchParams.get('code');
    if (code && code.trim()) return code.trim();
    // algunos flujos pueden usar ?codigo=
    const codigo = u.searchParams.get('codigo');
    if (codigo && codigo.trim()) return codigo.trim();
    return null;
  } catch {
    return null;
  }
}

function extractCodigoFromText() {
  const text = (document.body && (document.body.innerText || document.body.textContent)) || '';
  // patrón típico licitaciones compra ágil: 1161266-3-COT26
  const m = String(text).match(/\b\d{6,}-\d+-[A-Z]{3}\d{2,}\b/);
  if (m) return m[0];
  // OC: 2080-56651-SE25 (no necesariamente es licitación)
  const m2 = String(text).match(/\b\d{3,}-\d{3,}-[A-Z]{2}\d{2,}\b/);
  if (m2) return m2[0];
  return null;
}

function detectCodigo() {
  return extractCodigoFromUrl(window.location.href) || extractCodigoFromText();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_CODIGO') {
    sendResponse({ codigo: detectCodigo() });
    return true;
  }
  return false;
});

