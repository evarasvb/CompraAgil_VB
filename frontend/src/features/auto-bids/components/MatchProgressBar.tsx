export function MatchProgressBar({
  percent,
  label,
}: {
  percent: number
  label?: string
}) {
  const p = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0
  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
        <span>{label ?? 'Match'}</span>
        <span className="tabular-nums">{p.toFixed(0)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-200">
        <div
          className="h-2 rounded-full bg-emerald-600"
          style={{ width: `${p}%` }}
          aria-label="Porcentaje de match"
        />
      </div>
    </div>
  )
}

