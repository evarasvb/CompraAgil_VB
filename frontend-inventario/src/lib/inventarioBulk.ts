import * as XLSX from 'xlsx';

export type InventarioRow = {
  sku: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  precio: number;
  unidad: string;
  keywords: string; // texto libre (ej: "papel,resma,a4")
};

export type InventarioRowDraft = Omit<InventarioRow, 'precio'> & { precio: string };

export type RowIssue = {
  rowNumber: number; // 1-based en el archivo (sin contar headers)
  sku?: string;
  issues: string[];
};

const REQUIRED_HEADERS = ['SKU', 'Nombre', 'Descripción', 'Categoría', 'Precio', 'Unidad', 'Keywords'] as const;

function normalizeHeader(h: string): string {
  return String(h || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // sin tildes
}

function getCellString(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function parsePrecio(raw: string): number | null {
  const cleaned = raw
    .replace(/\$/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.]/g, '')
    .trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function buildTemplateWorkbook(): XLSX.WorkBook {
  const rows = [
    {
      SKU: 'SKU-001',
      Nombre: 'Papel Fotocopia A4 75gr',
      Descripción: 'Resma 500 hojas tamaño A4, 75 gramos.',
      Categoría: 'Papelería',
      Precio: 3990,
      Unidad: 'resma',
      Keywords: 'papel,resma,a4,fotocopia'
    }
  ];
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...REQUIRED_HEADERS] });
  ws['!cols'] = [
    { wch: 16 }, // SKU
    { wch: 32 }, // Nombre
    { wch: 50 }, // Descripción
    { wch: 22 }, // Categoría
    { wch: 10 }, // Precio
    { wch: 12 }, // Unidad
    { wch: 36 } // Keywords
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  return wb;
}

export function downloadTemplateExcel() {
  const wb = buildTemplateWorkbook();
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla_inventario.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type RawRow = Record<string, unknown>;

function mapRow(raw: RawRow): InventarioRowDraft {
  // Acepta variaciones comunes en headers
  const byNorm: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) byNorm[normalizeHeader(k)] = v;

  const sku = getCellString(byNorm['sku']);
  const nombre = getCellString(byNorm['nombre']);
  const descripcion = getCellString(byNorm['descripcion'] ?? byNorm['descripción']);
  const categoria = getCellString(byNorm['categoria'] ?? byNorm['categoría']);
  const precio = getCellString(byNorm['precio']);
  const unidad = getCellString(byNorm['unidad']);
  const keywords = getCellString(byNorm['keywords'] ?? byNorm['palabras clave'] ?? byNorm['palabras_clave']);

  return { sku, nombre, descripcion, categoria, precio, unidad, keywords };
}

export async function parseInventarioFile(file: File): Promise<{
  rows: InventarioRowDraft[];
  missingHeaders: string[];
}> {
  const buf = await file.arrayBuffer();

  // XLSX puede leer CSV desde arrayBuffer igual; si falla, tratamos como texto.
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array' });
  } catch {
    const text = new TextDecoder('utf-8').decode(buf);
    wb = XLSX.read(text, { type: 'string' });
  }

  const firstSheetName = wb.SheetNames[0];
  const ws = firstSheetName ? wb.Sheets[firstSheetName] : undefined;
  if (!ws) return { rows: [], missingHeaders: [...REQUIRED_HEADERS] };

  const json = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: '' });

  // Detectar headers presentes según la primera fila/keys
  const present = new Set<string>();
  const first = json[0] ?? {};
  Object.keys(first).forEach((k) => present.add(normalizeHeader(k)));

  const requiredNorm = REQUIRED_HEADERS.map(normalizeHeader);
  const missingHeaders = requiredNorm
    .filter((h) => !present.has(h))
    .map((h) => {
      // volver a label “bonito”
      const idx = requiredNorm.indexOf(h);
      return idx >= 0 ? REQUIRED_HEADERS[idx] : h;
    });

  const rows = json.map(mapRow);
  return { rows, missingHeaders };
}

export function validateRows(rows: InventarioRowDraft[]): {
  valid: InventarioRow[];
  issues: RowIssue[];
} {
  const issues: RowIssue[] = [];
  const valid: InventarioRow[] = [];

  rows.forEach((r, idx) => {
    const rowIssues: string[] = [];

    const sku = r.sku.trim();
    const nombre = r.nombre.trim();
    const descripcion = r.descripcion.trim();
    const categoria = r.categoria.trim();
    const unidad = r.unidad.trim();
    const keywords = r.keywords.trim();

    if (!sku) rowIssues.push('SKU es obligatorio.');
    if (!nombre) rowIssues.push('Nombre es obligatorio.');

    const precio = parsePrecio(r.precio);
    if (precio == null) rowIssues.push('Precio inválido (debe ser numérico).');
    else if (precio < 0) rowIssues.push('Precio no puede ser negativo.');

    if (rowIssues.length) {
      issues.push({ rowNumber: idx + 1, sku: sku || undefined, issues: rowIssues });
      return;
    }

    valid.push({
      sku,
      nombre,
      descripcion,
      categoria,
      precio: precio ?? 0,
      unidad,
      keywords
    });
  });

  return { valid, issues };
}

