interface BarDatum {
  label: string
  value: number
}

interface Props {
  title: string
  value: string | number
  subtitle?: string
  bars?: BarDatum[]
}

export default function StatCard({ title, value, subtitle, bars }: Props) {
  const max = bars ? Math.max(...bars.map((b) => b.value), 1) : 1
  const H = 40 // chart height px

  return (
    <div className="bg-gray-800 rounded-lg p-4 flex flex-col gap-2">
      <p className="text-xs text-gray-400 uppercase tracking-wide">{title}</p>
      <p className="text-3xl font-bold text-white">{value}</p>
      {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      {bars && bars.length > 0 && (
        <svg
          viewBox={`0 0 ${bars.length * 12} ${H}`}
          className="w-full mt-1"
          style={{ height: H }}
          aria-hidden
        >
          {bars.map((b, i) => {
            const barH = max === 0 ? 1 : Math.max(2, Math.round((b.value / max) * H))
            return (
              <rect
                key={i}
                x={i * 12 + 1}
                y={H - barH}
                width={10}
                height={barH}
                rx={2}
                fill="#6366f1"
                opacity={0.8}
              >
                <title>{`${b.label}: ${b.value}`}</title>
              </rect>
            )
          })}
        </svg>
      )}
    </div>
  )
}
