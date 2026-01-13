import { useCallback, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';

import { clienteInventarioOnConflict, supabase } from '../lib/supabase';
import { downloadTemplateExcel, parseInventarioFile, validateRows, type InventarioRowDraft } from '../lib/inventarioBulk';

type PreviewRow = InventarioRowDraft & { __rowNumber: number; __errors?: string[] };

export function CargaInventario() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [draftRows, setDraftRows] = useState<InventarioRowDraft[]>([]);
  const [missingHeaders, setMissingHeaders] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const validation = useMemo(() => validateRows(draftRows), [draftRows]);

  const preview: PreviewRow[] = useMemo(() => {
    const issuesByRow = new Map<number, string[]>();
    for (const it of validation.issues) issuesByRow.set(it.rowNumber, it.issues);
    return draftRows.slice(0, 50).map((r, idx) => ({
      ...r,
      __rowNumber: idx + 1,
      __errors: issuesByRow.get(idx + 1)
    }));
  }, [draftRows, validation.issues]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    try {
      setIsUploading(false);
      setFileName(file.name);

      const { rows, missingHeaders: mh } = await parseInventarioFile(file);
      setDraftRows(rows);
      setMissingHeaders(mh);

      if (mh.length) {
        toast.error(`Faltan columnas en el archivo: ${mh.join(', ')}`);
      } else {
        toast.success(`Archivo cargado: ${rows.length} filas detectadas`);
      }
    } catch (e) {
      setFileName(null);
      setDraftRows([]);
      setMissingHeaders([]);
      toast.error(`No pude leer el archivo: ${String((e as Error)?.message || e)}`);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls']
    }
  });

  const canUpload = draftRows.length > 0 && missingHeaders.length === 0 && validation.issues.length === 0 && !isUploading;

  const handleUpload = useCallback(async () => {
    if (!canUpload) return;

    setIsUploading(true);
    const tId = toast.loading('Subiendo productos a inventario...');

    try {
      const { valid } = validation;
      const { data, error } = await supabase
        .from('cliente_inventario')
        .upsert(
          valid.map((r) => ({
            sku: r.sku,
            nombre: r.nombre,
            descripcion: r.descripcion,
            categoria: r.categoria,
            precio: r.precio,
            unidad: r.unidad,
            keywords: r.keywords
          })),
          { onConflict: clienteInventarioOnConflict },
        )
        .select('sku');

      if (error) throw error;

      toast.success(`Inventario actualizado: ${data?.length ?? valid.length} productos`, { id: tId });
    } catch (e) {
      toast.error(`Error al guardar: ${String((e as Error)?.message || e)}`, { id: tId });
    } finally {
      setIsUploading(false);
    }
  }, [canUpload, validation]);

  const reset = useCallback(() => {
    setFileName(null);
    setDraftRows([]);
    setMissingHeaders([]);
  }, []);

  return (
    <div className="card">
      <div className="header" style={{ marginBottom: '1rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>Carga masiva de inventario</h1>
          <p className="muted">Plantilla → carga Excel/CSV → preview + validación → upsert a cliente_inventario.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn-secondary" onClick={downloadTemplateExcel}>
            Descargar plantilla Excel
          </button>
          <button type="button" className="btn-secondary" onClick={reset} disabled={!draftRows.length && !fileName}>
            Limpiar
          </button>
          <button type="button" onClick={handleUpload} disabled={!canUpload}>
            {isUploading ? 'Guardando…' : 'Guardar en inventario'}
          </button>
        </div>
      </div>

      <div className="card">
        <div
          {...getRootProps({
            className: `dropzone ${isDragActive ? 'dropzoneActive' : ''}`
          })}
        >
          <input {...getInputProps()} />
          <strong>Arrastra y suelta</strong> tu archivo aquí, o haz click para seleccionarlo.
          <div className="muted">Formatos: .xlsx, .xls, .csv</div>
          {fileName ? <div className="muted">Archivo: {fileName}</div> : null}
        </div>

        {missingHeaders.length ? (
          <p className="error">
            Faltan columnas: <strong>{missingHeaders.join(', ')}</strong>
          </p>
        ) : null}

        {draftRows.length ? (
          <div className="muted">
            Filas detectadas: <strong>{draftRows.length}</strong>. Errores: <strong>{validation.issues.length}</strong>.
          </div>
        ) : (
          <div className="muted">Aún no has cargado un archivo.</div>
        )}
      </div>

      {draftRows.length ? (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>Preview (primeras {preview.length} filas)</h2>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU</th>
                  <th>Nombre</th>
                  <th>Categoría</th>
                  <th>Precio</th>
                  <th>Unidad</th>
                  <th>Keywords</th>
                  <th>Errores</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.__rowNumber} className={r.__errors?.length ? 'rowInvalid' : ''}>
                    <td>{r.__rowNumber}</td>
                    <td>{r.sku}</td>
                    <td>{r.nombre}</td>
                    <td>{r.categoria}</td>
                    <td>{r.precio}</td>
                    <td>{r.unidad}</td>
                    <td>{r.keywords}</td>
                    <td className="error">{r.__errors?.join(' ') ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {validation.issues.length ? (
            <p className="error" style={{ marginBottom: 0 }}>
              Corrige los errores antes de guardar.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

