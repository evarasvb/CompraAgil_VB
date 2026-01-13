import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { supabase } from '../lib/supabase';

type AnyRow = Record<string, unknown>;

type FieldMap = {
  institucion: string | null;
  proveedor: string | null;
  monto: string | null;
  fecha: string | null;
  categoria: string | null;
  producto: string | null;
  precioUnitario: string | null;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '');
}

function guessField(columns: string[], needles: string[]): string | null {
  const byNorm = new Map<string, string>();
  columns.forEach((c) => byNorm.set(norm(c), c));
  for (const n of needles) {
    const hit = columns.find((c) => norm(c).includes(n));
    if (hit) return hit;
  }
  // fallback exact normalized
  for (const n of needles) {
    for (const [k, v] of byNorm.entries()) {
      if (k === n) return v;
    }
  }
  return null;
}

function toStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v)
    .replace(/\$/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.')
    .replace(/[^\d.]/g, '')
    .trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function Analisis() {
  const [rows, setRows] = useState<AnyRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'institucion' | 'proveedor' | 'productos' | 'precios'>('institucion');

  const [map, setMap] = useState<FieldMap>({
    institucion: null,
    proveedor: null,
    monto: null,
    fecha: null,
    categoria: null,
    producto: null,
    precioUnitario: null
  });

  const [limit, setLimit] = useState(5000);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const tId = toast.loading('Cargando órdenes de compra…');
      try {
        const { data, error } = await supabase.from('ordenes_compra').select('*').limit(limit);
        if (error) throw error;
        if (cancelled) return;
        const arr = (data ?? []) as AnyRow[];
        setRows(arr);
        const cols = Array.from(new Set(arr.flatMap((r) => Object.keys(r)))).sort();
        setColumns(cols);

        // Heurísticas (no inventa datos; solo detecta columnas existentes)
        const guessed: FieldMap = {
          institucion: guessField(cols, ['organismo', 'institucion', 'comprador', 'entidad', 'unidad', 'nombreorganismo']),
          proveedor: guessField(cols, ['proveedor', 'razonsocial', 'razon_social', 'nombreproveedor', 'rutproveedor', 'rut_proveedor']),
          monto: guessField(cols, ['monto', 'total', 'monto_total', 'total_neto', 'total_bruto', 'monto_neto', 'monto_bruto']),
          fecha: guessField(cols, ['fecha', 'created_at', 'emision', 'fecha_emision', 'fecha_creacion']),
          categoria: guessField(cols, ['categoria', 'rubro', 'familia', 'segmento']),
          producto: guessField(cols, ['producto', 'nombre_producto', 'item', 'descripcion', 'nombre_item']),
          precioUnitario: guessField(cols, ['precio_unitario', 'precio', 'unitario', 'valor_unitario'])
        };
        setMap(guessed);
        toast.success(`Órdenes cargadas: ${arr.length}`, { id: tId });
      } catch (e) {
        if (!cancelled) {
          toast.error(`Error cargando ordenes_compra: ${String((e as Error)?.message || e)}`, { id: tId });
          setRows([]);
          setColumns([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  const negociosPorInstitucion = useMemo(() => {
    if (!map.institucion || !map.monto) return [];
    const m = new Map<string, { institucion: string; total: number; ordenes: number; proveedores: Set<string> }>();
    for (const r of rows) {
      const inst = toStr(r[map.institucion]);
      if (!inst) continue;
      const monto = toNum(r[map.monto]) ?? 0;
      const prov = map.proveedor ? toStr(r[map.proveedor]) : '';
      const cur = m.get(inst) ?? { institucion: inst, total: 0, ordenes: 0, proveedores: new Set<string>() };
      cur.total += monto;
      cur.ordenes += 1;
      if (prov) cur.proveedores.add(prov);
      m.set(inst, cur);
    }
    return Array.from(m.values())
      .map((x) => ({ ...x, proveedoresCount: x.proveedores.size }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 200);
  }, [rows, map]);

  const negociosPorProveedor = useMemo(() => {
    if (!map.proveedor || !map.monto) return [];
    const m = new Map<string, { proveedor: string; total: number; ordenes: number; instituciones: Map<string, number>; categorias: Map<string, number> }>();
    for (const r of rows) {
      const prov = toStr(r[map.proveedor]);
      if (!prov) continue;
      const monto = toNum(r[map.monto]) ?? 0;
      const inst = map.institucion ? toStr(r[map.institucion]) : '';
      const cat = map.categoria ? toStr(r[map.categoria]) : '';
      const cur =
        m.get(prov) ?? {
          proveedor: prov,
          total: 0,
          ordenes: 0,
          instituciones: new Map<string, number>(),
          categorias: new Map<string, number>()
        };
      cur.total = cur.total + monto;
      cur.ordenes = cur.ordenes + 1;
      if (inst) cur.instituciones.set(inst, (cur.instituciones.get(inst) ?? 0) + monto);
      if (cat) cur.categorias.set(cat, (cur.categorias.get(cat) ?? 0) + monto);
      m.set(prov, cur);
    }
    const topMap = (mm: Map<string, number>) =>
      Array.from(mm.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => `${k} ($${Math.round(v)})`)
        .join(' · ');
    return Array.from(m.values())
      .map((x) => ({
        proveedor: x.proveedor,
        total: x.total,
        ordenes: x.ordenes,
        topInstituciones: topMap(x.instituciones),
        topCategorias: topMap(x.categorias)
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 200);
  }, [rows, map]);

  const analisisProductos = useMemo(() => {
    if (!map.producto || !map.monto) return [];
    const m = new Map<string, { producto: string; ordenes: number; total: number; proveedores: Set<string>; precios: number[]; categoria: string }>();
    for (const r of rows) {
      const prod = toStr(r[map.producto]);
      if (!prod) continue;
      const monto = toNum(r[map.monto]) ?? 0;
      const prov = map.proveedor ? toStr(r[map.proveedor]) : '';
      const cat = map.categoria ? toStr(r[map.categoria]) : '';
      const pu = map.precioUnitario ? toNum(r[map.precioUnitario]) : null;
      const cur =
        m.get(prod) ?? { producto: prod, ordenes: 0, total: 0, proveedores: new Set<string>(), precios: [], categoria: cat };
      cur.ordenes += 1;
      cur.total += monto;
      if (prov) cur.proveedores.add(prov);
      if (cat && !cur.categoria) cur.categoria = cat;
      if (pu != null) cur.precios.push(pu);
      m.set(prod, cur);
    }
    return Array.from(m.values())
      .map((x) => {
        const min = x.precios.length ? Math.min(...x.precios) : null;
        const max = x.precios.length ? Math.max(...x.precios) : null;
        const avg = x.precios.length ? x.precios.reduce((a, b) => a + b, 0) / x.precios.length : null;
        const variacion = min != null && max != null && min > 0 ? ((max - min) / min) * 100 : null;
        return {
          producto: x.producto,
          categoria: x.categoria,
          ordenes: x.ordenes,
          total: x.total,
          proveedores: x.proveedores.size,
          precio_min: min,
          precio_prom: avg,
          precio_max: max,
          variacion_pct: variacion
        };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 200);
  }, [rows, map]);

  const [selectedProducto, setSelectedProducto] = useState<string>('');
  const productosDisponibles = useMemo(() => analisisProductos.map((p) => p.producto).slice(0, 200), [analisisProductos]);

  const analisisPrecios = useMemo(() => {
    if (!selectedProducto || !map.producto || !map.precioUnitario) return [];
    const m = new Map<string, { proveedor: string; muestras: number; min: number; max: number; sum: number }>();
    for (const r of rows) {
      const prod = toStr(r[map.producto]);
      if (prod !== selectedProducto) continue;
      const pu = toNum(r[map.precioUnitario]);
      if (pu == null) continue;
      const prov = map.proveedor ? toStr(r[map.proveedor]) : '(sin proveedor)';
      const cur = m.get(prov) ?? { proveedor: prov, muestras: 0, min: pu, max: pu, sum: 0 };
      cur.muestras += 1;
      cur.sum += pu;
      cur.min = Math.min(cur.min, pu);
      cur.max = Math.max(cur.max, pu);
      m.set(prov, cur);
    }
    return Array.from(m.values())
      .map((x) => ({ ...x, avg: x.muestras ? x.sum / x.muestras : null }))
      .sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))
      .slice(0, 200);
  }, [rows, map, selectedProducto]);

  const mappingOk = useMemo(() => {
    const must: Array<keyof FieldMap> = ['institucion', 'proveedor', 'monto'];
    return must.every((k) => map[k]);
  }, [map]);

  const colSelect = (label: string, key: keyof FieldMap) => (
    <label className="muted" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label}
      <select
        value={map[key] ?? ''}
        onChange={(e) => setMap((p) => ({ ...p, [key]: e.target.value || null }))}
        style={{ padding: 10, borderRadius: 10, border: '1px solid #cbd5e1' }}
      >
        <option value="">(no usar)</option>
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="card">
      <div className="header" style={{ marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Módulo de Análisis</h1>
          <p className="muted">
            Basado en datos reales de <code>ordenes_compra</code>. No genera datos. Si tu tabla usa otros nombres de columnas,
            ajusta el mapeo aquí.
          </p>
        </div>
        <div className="actions">
          <label className="muted">
            Límite filas:
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              style={{ marginLeft: 8, padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}
              disabled={loading}
            >
              <option value={1000}>1.000</option>
              <option value={5000}>5.000</option>
              <option value={10000}>10.000</option>
            </select>
          </label>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          {colSelect('Institución/Organismo', 'institucion')}
          {colSelect('Proveedor', 'proveedor')}
          {colSelect('Monto total', 'monto')}
          {colSelect('Fecha', 'fecha')}
          {colSelect('Categoría', 'categoria')}
          {colSelect('Producto/Ítem', 'producto')}
          {colSelect('Precio unitario', 'precioUnitario')}
        </div>
        {!mappingOk ? <div className="error" style={{ marginTop: 10 }}>Falta mapear al menos Institución/Proveedor/Monto.</div> : null}
        <div className="muted" style={{ marginTop: 10 }}>
          Columnas detectadas: <strong>{columns.length}</strong> — Filas cargadas: <strong>{rows.length}</strong>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="actions">
          <button type="button" className={tab === 'institucion' ? '' : 'btn-secondary'} onClick={() => setTab('institucion')}>
            Negocios por Institución
          </button>
          <button type="button" className={tab === 'proveedor' ? '' : 'btn-secondary'} onClick={() => setTab('proveedor')}>
            Negocios por Proveedor
          </button>
          <button type="button" className={tab === 'productos' ? '' : 'btn-secondary'} onClick={() => setTab('productos')}>
            Análisis de Productos
          </button>
          <button type="button" className={tab === 'precios' ? '' : 'btn-secondary'} onClick={() => setTab('precios')}>
            Análisis de Precios
          </button>
        </div>
      </div>

      {tab === 'institucion' ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Negocios por Institución</h2>
          {!map.institucion || !map.monto ? (
            <div className="muted">Mapea Institución y Monto para ver este reporte.</div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Institución</th>
                    <th>Monto total</th>
                    <th>Órdenes</th>
                    <th>Proveedores</th>
                  </tr>
                </thead>
                <tbody>
                  {negociosPorInstitucion.map((r) => (
                    <tr key={r.institucion}>
                      <td>{r.institucion}</td>
                      <td>${Math.round(r.total).toLocaleString('es-CL')}</td>
                      <td>{r.ordenes}</td>
                      <td>{r.proveedoresCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'proveedor' ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Negocios por Proveedor</h2>
          {!map.proveedor || !map.monto ? (
            <div className="muted">Mapea Proveedor y Monto para ver este reporte.</div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th>Monto total</th>
                    <th>Órdenes</th>
                    <th>Top instituciones</th>
                    <th>Top categorías</th>
                  </tr>
                </thead>
                <tbody>
                  {negociosPorProveedor.map((r) => (
                    <tr key={r.proveedor}>
                      <td>{r.proveedor}</td>
                      <td>${Math.round(r.total).toLocaleString('es-CL')}</td>
                      <td>{r.ordenes}</td>
                      <td>{r.topInstituciones}</td>
                      <td>{r.topCategorias}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'productos' ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Análisis de Productos</h2>
          {!map.producto ? (
            <div className="muted">Mapea Producto/Ítem para ver este reporte.</div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Categoría</th>
                    <th>Órdenes</th>
                    <th>Monto total</th>
                    <th>Proveedores</th>
                    <th>Precio min</th>
                    <th>Precio prom</th>
                    <th>Precio max</th>
                    <th>Variación %</th>
                  </tr>
                </thead>
                <tbody>
                  {analisisProductos.map((r) => (
                    <tr key={r.producto}>
                      <td>{r.producto}</td>
                      <td>{r.categoria ?? ''}</td>
                      <td>{r.ordenes}</td>
                      <td>${Math.round(r.total).toLocaleString('es-CL')}</td>
                      <td>{r.proveedores}</td>
                      <td>{r.precio_min != null ? `$${Math.round(r.precio_min).toLocaleString('es-CL')}` : ''}</td>
                      <td>{r.precio_prom != null ? `$${Math.round(r.precio_prom).toLocaleString('es-CL')}` : ''}</td>
                      <td>{r.precio_max != null ? `$${Math.round(r.precio_max).toLocaleString('es-CL')}` : ''}</td>
                      <td>{r.variacion_pct != null ? `${Math.round(r.variacion_pct)}%` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'precios' ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Análisis de Precios</h2>
          {!map.producto || !map.precioUnitario ? (
            <div className="muted">Mapea Producto/Ítem y Precio unitario para comparar precios.</div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 12 }}>
                <label className="muted">
                  Producto:
                  <select
                    value={selectedProducto}
                    onChange={(e) => setSelectedProducto(e.target.value)}
                    style={{ marginLeft: 8, padding: 10, borderRadius: 10, border: '1px solid #cbd5e1', minWidth: 420 }}
                  >
                    <option value="">(selecciona)</option>
                    {productosDisponibles.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {!selectedProducto ? (
                <div className="muted">Selecciona un producto para ver el ranking de precios por proveedor.</div>
              ) : (
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Proveedor</th>
                        <th>Precio prom</th>
                        <th>Precio min</th>
                        <th>Precio max</th>
                        <th>Muestras</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analisisPrecios.map((r) => (
                        <tr key={r.proveedor}>
                          <td>{r.proveedor}</td>
                          <td>{r.avg != null ? `$${Math.round(r.avg).toLocaleString('es-CL')}` : ''}</td>
                          <td>${Math.round(r.min).toLocaleString('es-CL')}</td>
                          <td>${Math.round(r.max).toLocaleString('es-CL')}</td>
                          <td>{r.muestras}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

