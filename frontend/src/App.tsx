import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { AutoBidDetailPage } from './features/auto-bids/pages/AutoBidDetailPage'
import { AutoBidsDashboardPage } from './features/auto-bids/pages/AutoBidsDashboardPage'

export default function App() {
  return (
    <div className="min-h-full">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-6">
            <Link to="/" className="text-sm font-semibold text-slate-900">
              FirmaVB
            </Link>
            <nav className="flex items-center gap-3 text-sm">
              <Link to="/auto-bids" className="text-slate-700 hover:text-slate-900">
                Ofertas Automáticas
              </Link>
            </nav>
          </div>
          <div className="text-xs text-slate-500">CompraAgil_VB</div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/auto-bids" replace />} />
          <Route path="/auto-bids" element={<AutoBidsDashboardPage />} />
          <Route path="/auto-bids/:id" element={<AutoBidDetailPage />} />
        </Routes>
      </main>
    </div>
  )
}
