interface ColorOutcomes {
  white: { wins: number; draws: number; losses: number }
  black: { wins: number; draws: number; losses: number }
}

const WHITE_FILL = '#e5e7eb'
const BLACK_FILL = '#4b5563'
const WIN_FILL = '#22c55e'
const DRAW_FILL = '#eab308'
const LOSS_FILL = '#ef4444'

const CX = 150
const CY = 150
const CENTER_HOLE_R = 42
const RING1_R0 = 46
const RING1_R1 = 112
const RING2_R0 = 116
const RING2_R1 = 150

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

function sectorPath(rInner: number, rOuter: number, startAngle: number, endAngle: number): string {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  const outerStart = polarToCartesian(CX, CY, rOuter, startAngle)
  const outerEnd = polarToCartesian(CX, CY, rOuter, endAngle)
  const innerStart = polarToCartesian(CX, CY, rInner, startAngle)
  const innerEnd = polarToCartesian(CX, CY, rInner, endAngle)
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ')
}

interface Slice {
  path: string
  fill: string
  label: string
  pct: number
  labelX: number
  labelY: number
}

export default function ColorOutcomeSunburst({ colorOutcomes }: { colorOutcomes: ColorOutcomes }) {
  const groups = [
    { label: 'White', fill: WHITE_FILL, textFill: '#111827', outcomes: colorOutcomes.white },
    { label: 'Black', fill: BLACK_FILL, textFill: '#f9fafb', outcomes: colorOutcomes.black },
  ].map((g) => ({ ...g, total: g.outcomes.wins + g.outcomes.draws + g.outcomes.losses }))

  const grandTotal = groups.reduce((sum, g) => sum + g.total, 0)

  if (grandTotal === 0) {
    return <p className="text-xs text-gray-500">No games yet.</p>
  }

  let angle = 0
  const ring1: Slice[] = []
  const ring2: Slice[] = []

  for (const g of groups) {
    if (g.total === 0) continue
    const sweep = (g.total / grandTotal) * 360
    const start = angle
    const end = angle + sweep
    const mid = (start + end) / 2
    const labelPos = polarToCartesian(CX, CY, (RING1_R0 + RING1_R1) / 2, mid)
    ring1.push({
      path: sectorPath(RING1_R0, RING1_R1, start, end),
      fill: g.fill,
      label: g.label,
      pct: (g.total / grandTotal) * 100,
      labelX: labelPos.x,
      labelY: labelPos.y,
    })

    let sub = start
    const outcomeParts: [string, number, string][] = [
      ['Win', g.outcomes.wins, WIN_FILL],
      ['Draw', g.outcomes.draws, DRAW_FILL],
      ['Loss', g.outcomes.losses, LOSS_FILL],
    ]
    for (const [label, value, fill] of outcomeParts) {
      if (value === 0) continue
      const subSweep = (value / g.total) * sweep
      const subMid = sub + subSweep / 2
      const pos = polarToCartesian(CX, CY, (RING2_R0 + RING2_R1) / 2, subMid)
      ring2.push({
        path: sectorPath(RING2_R0, RING2_R1, sub, sub + subSweep),
        fill,
        label,
        pct: (value / grandTotal) * 100,
        labelX: pos.x,
        labelY: pos.y,
      })
      sub += subSweep
    }

    angle = end
  }

  return (
    <svg viewBox="0 0 300 300" className="w-full max-w-[300px] mx-auto" aria-hidden>
      {ring1.map((s, i) => (
        <path key={`r1-${i}`} d={s.path} fill={s.fill} stroke="#1f2937" strokeWidth={2} />
      ))}
      {ring2.map((s, i) => (
        <path key={`r2-${i}`} d={s.path} fill={s.fill} opacity={0.85} stroke="#1f2937" strokeWidth={2} />
      ))}
      {ring1.map((s, i) => (
        <text
          key={`r1t-${i}`}
          x={s.labelX}
          y={s.labelY}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={13}
          fontWeight={600}
          fill="white"
          stroke="rgba(0,0,0,0.55)"
          strokeWidth={3}
          paintOrder="stroke"
        >
          <tspan x={s.labelX} dy="-0.3em">{s.label}</tspan>
          <tspan x={s.labelX} dy="1.2em">{`${s.pct.toFixed(0)}%`}</tspan>
        </text>
      ))}
      {ring2.map((s, i) => (
        <text
          key={`r2t-${i}`}
          x={s.labelX}
          y={s.labelY}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={11}
          fontWeight={600}
          fill="white"
          stroke="rgba(0,0,0,0.55)"
          strokeWidth={2.5}
          paintOrder="stroke"
        >
          <tspan x={s.labelX} dy="-0.2em">{s.label}</tspan>
          <tspan x={s.labelX} dy="1.1em">{`${s.pct.toFixed(1)}%`}</tspan>
        </text>
      ))}
      <circle cx={CX} cy={CY} r={CENTER_HOLE_R} fill="#1f2937" />
      <text x={CX} y={CY - 4} textAnchor="middle" fontSize={12} fill="#9ca3af">
        games
      </text>
      <text x={CX} y={CY + 14} textAnchor="middle" fontSize={18} fontWeight={700} fill="white">
        {grandTotal}
      </text>
    </svg>
  )
}
