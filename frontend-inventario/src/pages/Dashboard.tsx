import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { supabase } from '../lib/supabase';

type OportunidadRow = {
  tipo_proceso: 'compra_agil' | 'licitacion';
  codigo: string;
  titulo: string | null;
  organismo: string | null;
  fecha_publicacion: string | null;
  fecha_cierre: string | null;
  presupuesto_estimado: number | null;
  estado: string | null;
  link_detalle: string | null;
  categoria_match: string | null;
  match_score: number | null;
  created_at: string | null;
};

export function Dashboard() {
  const [rows, setRows] = useState<OportunidadRow[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'compra_agil' | 'licitacion'>('all');

  const hasData = rows.length > 0;

  const stats = useMemo(() => {
    const total = count ?? rows.length;
    const conMatch = rows.filter((r) => (r.match_score ?? 0) > 0).length;
    return { total, conMatch };
  }, [rows, count]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const tId = toast.loading('Cargando licitaciones…');
      try {
        // Count total (sin traer filas)
        const countResp = await supabase
          .from('oportunidades_all')
          .select('codigo', { count: 'exact', head: true });
        if (countResp.error) throw countResp.error;

        let q = supabase
          .from('oportunidades_all')
          .select(
            'tipo_proceso,codigo,titulo,organismo,fecha_publicacion,fecha_cierre,presupuesto_estimado,estado,link_detalle,categoria_match,match_score,created_at',
          );

        if (filter !== 'all') q = q.eq('tipo_proceso', filter);

        const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);

        if (error) throw error;
        if (cancelled) return;
        setCount(countResp.count ?? null);
        setRows((data ?? []) as OportunidadRow[]);
        toast.success('Datos cargados', { id: tId });
      } catch (e) {
        if (!cancelled) {
          toast.error(`Error cargando licitaciones: ${String((e as Error)?.message || e)}`, { id: tId });
          setRows([]);
          setCount(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [limit, filter]);

  return (
    <div className="card">
      <div className="header" style={{ marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Dashboard</h1>
          <p>
            Total en Supabase: <strong>{stats.total}</strong> — Con match: <strong>{stats.conMatch}</strong>
          </p>
        </div>
        <div className="actions">
          <label className="muted">
            Tipo:
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as 'all' | 'compra_agil' | 'licitacion')}
              style={{ marginLeft: 8, padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}
              disabled={loading}
            >
              <option value="all">Todas</option>
              <option value="compra_agil">Compras Ágiles (&lt;100 UTM)</option>
              <option value="licitacion">Licitaciones (API ≥100 UTM)</option>
            </select>
          </label>
          <label className="muted">
            Mostrar:
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              style={{ marginLeft: 8, padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}
              disabled={loading}
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
            </select>
          </label>
        </div>
      </div>

      {!hasData ? (
        <div className="muted">No hay datos para mostrar (o falta acceso/RLS).</div>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Código</th>
                <th>Título</th>
                <th>Organismo</th>
                <th>Publicada</th>
                <th>Cierra</th>
                <th>Presupuesto</th>
                <th>Categoría</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.codigo}>
                  <td>{r.tipo_proceso}</td>
                  <td>
                    {r.link_detalle ? (
                      <a href={r.link_detalle} target="_blank" rel="noreferrer">
                        {r.codigo}
                      </a>
                    ) : (
                      r.codigo
                    )}
                  </td>
                  <td>{r.titulo ?? ''}</td>
                  <td>{r.organismo ?? ''}</td>
                  <td>{r.fecha_publicacion ?? ''}</td>
                  <td>{r.fecha_cierre ?? ''}</td>
                  <td>{r.presupuesto_estimado ?? ''}</td>
                  <td>{r.categoria_match ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

