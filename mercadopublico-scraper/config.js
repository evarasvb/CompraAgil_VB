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

module.exports = {
  baseUrl: 'https://buscador.mercadopublico.cl/compra-agil',
  params: {
    date_from: todayYYYYMMDD(),
    date_to: todayYYYYMMDD(),
    order_by: 'recent',
    region: 'all',
    status: '2'
  },
  maxPages: calculateMaxPages()
};
