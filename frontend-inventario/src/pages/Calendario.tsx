import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { supabase } from '../lib/supabase';

type Evento = {
  licitacion_codigo: string;
  titulo: string | null;
  tipo: 'apertura' | 'cierre';
  fecha: string; // timestamp (devuelto por vista)
  link_detalle: string | null;
};

function toDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function Calendario() {
  const [rows, setRows] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(false);
  const [daysAhead, setDaysAhead] = useState(30);

  const grouped = useMemo(() => {
    const now = new Date();
    const end = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const out = new Map<string, Evento[]>();

    for (const e of rows) {
      const d = new Date(e.fecha);
      if (!Number.isFinite(d.getTime())) continue;
      if (d < now || d > end) continue;
      const k = toDateKey(d);
      const arr = out.get(k) ?? [];
      arr.push(e);
      out.set(k, arr);
    }

    // ordenar eventos dentro del día
    for (const [k, arr] of out.entries()) {
      arr.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
      out.set(k, arr);
    }

    // ordenar keys
    const keys = Array.from(out.keys()).sort();
    return keys.map((k) => ({ dateKey: k, events: out.get(k) ?? [] }));
  }, [rows, daysAhead]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const tId = toast.loading('Cargando eventos…');
      try {
        const { data, error } = await supabase
          .from('calendario_eventos')
          .select('licitacion_codigo,titulo,tipo,fecha,link_detalle')
          .order('fecha', { ascending: true })
          .limit(5000);

        if (error) throw error;
        if (cancelled) return;
        setRows((data ?? []) as Evento[]);
        toast.success('Calendario listo', { id: tId });
      } catch (e) {
        if (!cancelled) {
          toast.error(`Error cargando calendario: ${String((e as Error)?.message || e)}`, { id: tId });
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="card">
      <div className="header" style={{ marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Calendario</h1>
          <p className="muted">Fechas importantes (apertura/cierre) de licitaciones.</p>
        </div>
        <div className="actions">
          <label className="muted">
            Próximos:
            <select
              value={daysAhead}
              onChange={(e) => setDaysAhead(Number(e.target.value))}
              style={{ marginLeft: 8, padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}
              disabled={loading}
            >
              <option value={7}>7 días</option>
              <option value={14}>14 días</option>
              <option value={30}>30 días</option>
              <option value={60}>60 días</option>
            </select>
          </label>
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="muted">
          No hay eventos próximos (o falta acceso/RLS). La fuente es la vista <code>calendario_eventos</code>.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {grouped.map((g) => (
            <div key={g.dateKey} className="card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>{g.dateKey}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {g.events.map((e) => (
                  <div key={`${e.licitacion_codigo}:${e.tipo}:${e.fecha}`} style={{ display: 'flex', gap: 10 }}>
                    <div
                      style={{
                        width: 72,
                        fontWeight: 800,
                        color: e.tipo === 'cierre' ? '#b91c1c' : '#0f172a'
                      }}
                    >
                      {e.tipo.toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {new Date(e.fecha).toLocaleString()}
                      </div>
                      <div>
                        {e.link_detalle ? (
                          <a href={e.link_detalle} target="_blank" rel="noreferrer">
                            {e.titulo ?? e.licitacion_codigo}
                          </a>
                        ) : (
                          e.titulo ?? e.licitacion_codigo
                        )}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {e.licitacion_codigo}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

