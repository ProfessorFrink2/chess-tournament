interface ColorOutcomes {
  white: { wins: number; draws: number; losses: number }
  black: { wins: number; draws: number; losses: number }
}

const WHITE_FILL = '#e5e7eb'
const BLACK_FILL = '#4b5563'
const WIN_FILL = '#22c55e'
const DRAW_FILL = '#eab308'
const LOSS_FILL = '#ef4444'

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

/** Path for one wedge/ring-segment: a full pie slice when rInner is 0, or an
 *  annular (donut-ring) segment otherwise. */
function sectorPath(cx: number, cy: number, rInner: number, rOuter: number, startAngle: number, endAngle: number): string {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  const outerStart = polarToCartesian(cx, cy, rOuter, startAngle)
  const outerEnd = polarToCartesian(cx, cy, rOuter, endAngle)

  if (rInner <= 0) {
    return [
      `M ${cx} ${cy}`,
      `L ${outerStart.x} ${outerStart.y}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
      'Z',
    ].join(' ')
  }

  const innerStart = polarToCartesian(cx, cy, rInner, startAngle)
  const innerEnd = polarToCartesian(cx, cy, rInner, endAngle)
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    'Z',
  ].join(' ')
}

export default function ColorOutcomeSunburst({ colorOutcomes }: { colorOutcomes: ColorOutcomes }) {
  const cx = 50
  const cy = 50
  const innerR = 26
  const outerR0 = 30
  const outerR1 = 46

  const groups = [
    { label: 'White', fill: WHITE_FILL, outcomes: colorOutcomes.white },
    { label: 'Black', fill: BLACK_FILL, outcomes: colorOutcomes.black },
  ].map((g) => ({ ...g, total: g.outcomes.wins + g.outcomes.draws + g.outcomes.losses }))

  const grandTotal = groups.reduce((sum, g) => sum + g.total, 0)

  if (grandTotal === 0) {
    return <p className="text-xs text-gray-500">No games yet.</p>
  }

  let angle = 0
  const innerSlices: { path: string; fill: string; label: string; total: number }[] = []
  const outerSlices: { path: string; fill: string; label: string; value: number }[] = []

  for (const g of groups) {
    if (g.total === 0) continue
    const sweep = (g.total / grandTotal) * 360
    const start = angle
    const end = angle + sweep
    innerSlices.push({ path: sectorPath(cx, cy, 0, innerR, start, end), fill: g.fill, label: g.label, total: g.total })

    let sub = start
    const outcomeParts: [string, number, string][] = [
      ['Win', g.outcomes.wins, WIN_FILL],
      ['Draw', g.outcomes.draws, DRAW_FILL],
      ['Loss', g.outcomes.losses, LOSS_FILL],
    ]
    for (const [label, value, fill] of outcomeParts) {
      if (value === 0) continue
      const subSweep = (value / g.total) * sweep
      outerSlices.push({
        path: sectorPath(cx, cy, outerR0, outerR1, sub, sub + subSweep),
        fill,
        label: `${g.label} ${label}`,
        value,
      })
      sub += subSweep
    }

    angle = end
  }

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="w-28 h-28 shrink-0" aria-hidden>
        {innerSlices.map((s, i) => (
          <path key={`inner-${i}`} d={s.path} fill={s.fill}>
            <title>{`${s.label}: ${s.total} games`}</title>
          </path>
        ))}
        {outerSlices.map((s, i) => (
          <path key={`outer-${i}`} d={s.path} fill={s.fill} opacity={0.9}>
            <title>{`${s.label}: ${s.value}`}</title>
          </path>
        ))}
      </svg>
      <div className="flex flex-col gap-1 text-xs text-gray-400">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: WHITE_FILL }} />
          White ({groups[0].total})
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BLACK_FILL }} />
          Black ({groups[1].total})
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: WIN_FILL }} />
          Win
          <span className="inline-block w-2.5 h-2.5 rounded-sm ml-2" style={{ backgroundColor: DRAW_FILL }} />
          Draw
          <span className="inline-block w-2.5 h-2.5 rounded-sm ml-2" style={{ backgroundColor: LOSS_FILL }} />
          Loss
        </div>
      </div>
    </div>
  )
}
