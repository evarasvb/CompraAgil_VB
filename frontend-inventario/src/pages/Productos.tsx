import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { supabase } from '../lib/supabase';

type Producto = {
  cliente_id: string;
  sku: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  precio: number | null;
  unidad: string | null;
  keywords: string | null;
  activo: boolean | null;
};

function getClienteIdFromStorage(): string {
  return localStorage.getItem('firmavb_cliente_id') ?? '';
}

export function Productos() {
  const [clienteId, setClienteId] = useState(getClienteIdFromStorage());
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => {
      const haystack = `${p.sku} ${p.nombre} ${p.descripcion ?? ''} ${p.categoria ?? ''} ${p.keywords ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, query]);

  useEffect(() => {
    localStorage.setItem('firmavb_cliente_id', clienteId);
  }, [clienteId]);

  async function load() {
    if (!clienteId.trim()) {
      setRows([]);
      return;
    }

    setLoading(true);
    const tId = toast.loading('Cargando inventario…');
    try {
      const { data, error } = await supabase
        .from('cliente_inventario')
        .select('cliente_id,sku,nombre,descripcion,categoria,precio,unidad,keywords,activo')
        .eq('cliente_id', clienteId.trim())
        .order('nombre', { ascending: true })
        .limit(5000);

      if (error) throw error;
      setRows((data ?? []) as Producto[]);
      toast.success(`Productos cargados: ${data?.length ?? 0}`, { id: tId });
    } catch (e) {
      toast.error(`Error cargando inventario: ${String((e as Error)?.message || e)}`, { id: tId });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card">
      <div className="header" style={{ marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Productos</h1>
          <p className="muted">Catálogo del inventario del cliente (estilo “company/products”).</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <label className="muted">
            Cliente ID:
            <input
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
              placeholder="UUID del cliente (clientes.id)"
              style={{
                marginLeft: 8,
                padding: 10,
                borderRadius: 10,
                border: '1px solid #cbd5e1',
                minWidth: 340
              }}
            />
          </label>
          <div className="actions">
            <button type="button" className="btn-secondary" onClick={() => void load()} disabled={loading}>
              Recargar
            </button>
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por SKU, nombre, categoría, keywords…"
            style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid #cbd5e1' }}
          />
        </div>
      </div>

      {!clienteId.trim() ? (
        <div className="muted">Ingresa un Cliente ID para ver productos.</div>
      ) : filtered.length === 0 ? (
        <div className="muted">No hay productos para este cliente (o falta acceso/RLS).</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 12
          }}
        >
          {filtered.map((p) => (
            <div
              key={`${p.cliente_id}:${p.sku}`}
              className="card"
              style={{
                padding: 14,
                borderRadius: 14,
                border: '1px solid #e2e8f0',
                background: '#ffffff'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 800 }}>{p.nombre}</div>
                <div className="muted" style={{ whiteSpace: 'nowrap' }}>
                  {p.precio != null ? `$${p.precio}` : ''}
                </div>
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                <strong>SKU:</strong> {p.sku}
              </div>
              {p.categoria ? (
                <div className="muted" style={{ marginTop: 4 }}>
                  <strong>Categoría:</strong> {p.categoria}
                </div>
              ) : null}
              {p.unidad ? (
                <div className="muted" style={{ marginTop: 4 }}>
                  <strong>Unidad:</strong> {p.unidad}
                </div>
              ) : null}
              {p.descripcion ? <div style={{ marginTop: 10 }}>{p.descripcion}</div> : null}
              {p.keywords ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  <strong>Keywords:</strong> {p.keywords}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

