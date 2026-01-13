import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { supabase } from '../lib/supabase';

type LicitacionRow = {
  codigo: string;
  titulo: string | null;
  organismo: string | null;
  departamento: string | null;
  publicada_el: string | null;
  finaliza_el: string | null;
  presupuesto_estimado: number | null;
  estado: string | null;
  link_detalle: string | null;
  categoria_match: string | null;
  match_score: number | null;
  fecha_extraccion: string | null;
};

export function Dashboard() {
  const [rows, setRows] = useState<LicitacionRow[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);

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
          .from('licitaciones_all')
          .select('codigo', { count: 'exact', head: true });
        if (countResp.error) throw countResp.error;

        const { data, error } = await supabase
          .from('licitaciones_all')
          .select(
            'codigo,titulo,organismo,departamento,publicada_el,finaliza_el,presupuesto_estimado,estado,link_detalle,categoria_match,match_score,fecha_extraccion',
          )
          .order('fecha_extraccion', { ascending: false })
          .limit(limit);

        if (error) throw error;
        if (cancelled) return;
        setCount(countResp.count ?? null);
        setRows((data ?? []) as LicitacionRow[]);
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
  }, [limit]);

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
                  <td>{r.publicada_el ?? ''}</td>
                  <td>{r.finaliza_el ?? ''}</td>
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

