import { NavLink, Route, Routes } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import './App.css';

import { Dashboard } from './pages/Dashboard';
import { Productos } from './pages/Productos';
import { Calendario } from './pages/Calendario';
import { CargaInventario } from './pages/CargaInventario';

function App() {
  return (
    <div className="page">
      <Toaster position="top-right" />

      <div className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>FirmaVB</div>
            <div className="muted">Dashboard + Productos + Calendario + Carga masiva</div>
          </div>
          <nav style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <NavLink to="/" end style={({ isActive }) => ({ fontWeight: isActive ? 800 : 600 })}>
              Dashboard
            </NavLink>
            <NavLink to="/productos" style={({ isActive }) => ({ fontWeight: isActive ? 800 : 600 })}>
              Productos
            </NavLink>
            <NavLink to="/calendario" style={({ isActive }) => ({ fontWeight: isActive ? 800 : 600 })}>
              Calendario
            </NavLink>
            <NavLink to="/carga" style={({ isActive }) => ({ fontWeight: isActive ? 800 : 600 })}>
              Carga masiva
            </NavLink>
          </nav>
        </div>
      </div>

      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/productos" element={<Productos />} />
        <Route path="/calendario" element={<Calendario />} />
        <Route path="/carga" element={<CargaInventario />} />
        <Route
          path="*"
          element={
            <div className="card">
              <h1 style={{ marginTop: 0 }}>Página no encontrada</h1>
              <button type="button" onClick={() => toast('Usa el menú para navegar.')}>
                OK
              </button>
            </div>
          }
        />
      </Routes>
    </div>
  );
}

export default App;
