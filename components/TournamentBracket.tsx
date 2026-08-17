'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TournamentMatchWithPlayers } from '@/lib/database.types'

const useMeasureEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function depthsFromFinal(
  matches: TournamentMatchWithPlayers[],
  edges: Array<{ from: string; to: string }>
): Map<string, number> {
  const successor = new Map<string, string>()
  for (const e of edges) successor.set(e.from, e.to)

  const maxRound = Math.max(0, ...matches.map((m) => m.round))
  const byId = new Map(matches.map((m) => [m.id, m]))
  const depth = new Map<string, number>()

  const resolve = (id: string, guard: Set<string>): number => {
    const cached = depth.get(id)
    if (cached != null) return cached
    const next = successor.get(id)
    let d: number
    if (!next || guard.has(id)) d = maxRound - (byId.get(id)?.round ?? maxRound)
    else {
      guard.add(id)
      d = 1 + resolve(next, guard)
      guard.delete(id)
    }
    depth.set(id, d)
    return d
  }
  for (const m of matches) resolve(m.id, new Set())
  return depth
}

function columnHeading(
  depth: number,
  columnIndex: number,
  kind: string,
  inColumn: TournamentMatchWithPlayers[]
): string {
  const labels = new Set(inColumn.map((m) => m.label).filter(Boolean))
  if (labels.size === 1) return [...labels][0] as string
  if (kind === 'championship' || kind === 'consolation') {
    if (depth === 0) return 'Final'
    if (depth === 1) return 'Semifinals'
    if (depth === 2) return 'Quarterfinals'
  }
  return `Round ${columnIndex + 1}`
}

interface ByeSlot {
  key: string
  matchId: string
  colDepth: number
  row: number
  player: { display_name: string } | null
  seed: number | null
}

export interface PlayerStat { w: number; d: number; l: number }

function ByeCard({ player, seed }: { player: { display_name: string } | null; seed: number | null }) {
  return (
    <div className="border border-dashed border-gray-700 rounded text-sm w-44 max-w-full">
      <div className="flex items-center gap-2 px-2 py-0.5 text-gray-400">
        {seed != null && <span className="text-gray-600 tabular-nums mr-1">({seed})</span>}
        <span className="truncate">{player?.display_name ?? '?'}</span>
      </div>
      <div className="px-2 py-0.5 text-gray-600 text-xs italic">bye</div>
    </div>
  )
}

// src* identify where the player came FROM (so the drop handler can clear it).
export type SlotDropHandler = (
  destMatchId: string, destSide: 'a' | 'b', playerId: string,
  srcMatchId?: string, srcSide?: 'a' | 'b'
) => void

export type SlotClearHandler = (matchId: string, side: 'a' | 'b') => void

function Side({
  player,
  seed,
  score,
  isWinner,
  decided,
  stat,
  wide,
  isBye,
  matchId,
  side,
  onSlotDrop,
  onSlotClear,
}: {
  player: { id?: string; display_name: string } | null
  seed: number | null
  score: number | null
  isWinner: boolean
  decided: boolean
  stat?: PlayerStat
  wide?: boolean
  isBye?: boolean
  matchId?: string
  side?: 'a' | 'b'
  onSlotDrop?: SlotDropHandler
  onSlotClear?: SlotClearHandler
}) {
  const [dragOver, setDragOver] = useState(false)
  const isDropTarget = !!onSlotDrop && !!matchId && !!side
  const isDragSource = isDropTarget && !!player

  return (
    <div
      draggable={isDragSource}
      onDragStart={isDragSource ? (e) => {
        e.dataTransfer.setData('playerId', (player as { id?: string }).id ?? '')
        e.dataTransfer.setData('srcMatchId', matchId!)
        e.dataTransfer.setData('srcSide', side!)
        e.dataTransfer.effectAllowed = 'move'
      } : undefined}
      className={`flex items-center justify-between gap-2 px-2 py-0.5 transition-colors ${
        dragOver ? 'bg-blue-900/40' :
        isWinner ? 'text-white font-semibold' : decided ? 'text-gray-500' : 'text-gray-300'
      } ${isDragSource ? 'cursor-grab active:cursor-grabbing' : isDropTarget ? 'cursor-pointer' : ''}`}
      onDragOver={isDropTarget ? (e) => { e.preventDefault(); setDragOver(true) } : undefined}
      onDragLeave={isDropTarget ? () => setDragOver(false) : undefined}
      onDrop={isDropTarget ? (e) => {
        e.preventDefault()
        setDragOver(false)
        const pid = e.dataTransfer.getData('playerId')
        const srcMatchId = e.dataTransfer.getData('srcMatchId') || undefined
        const srcSideRaw = e.dataTransfer.getData('srcSide')
        const srcSide = (srcSideRaw === 'a' || srcSideRaw === 'b') ? srcSideRaw : undefined
        if (pid) onSlotDrop!(matchId!, side!, pid, srcMatchId, srcSide)
      } : undefined}
    >
      <span className={`truncate ${wide ? 'max-w-36' : ''}`}>
        {seed != null && <span className="text-gray-600 mr-1 tabular-nums">({seed})</span>}
        {player?.display_name ?? <span className="text-gray-700 italic">{isBye ? 'bye' : 'TBD'}</span>}
      </span>
      <span className="flex items-center gap-1 shrink-0">
        {stat && wide && (
          <span className="text-xs text-gray-600 tabular-nums">
            {stat.w}W {stat.d}D {stat.l}L
          </span>
        )}
        <span className="tabular-nums text-xs">{score ?? ''}</span>
        {onSlotClear && player && matchId && side && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onSlotClear(matchId, side) }}
            className="text-gray-700 hover:text-red-500 leading-none px-0.5 text-xs"
            title="Remove from slot"
          >×</button>
        )}
      </span>
    </div>
  )
}

function MatchCard({
  m,
  wide,
  isLeafCol,
  playerStats,
  onSlotDrop,
  onSlotClear,
}: {
  m: TournamentMatchWithPlayers
  wide?: boolean
  isLeafCol?: boolean
  playerStats?: Map<string, PlayerStat>
  onSlotDrop?: SlotDropHandler
  onSlotClear?: SlotClearHandler
}) {
  const decided = m.winner_id != null
  const w = wide ? 'w-64' : 'w-44'
  const playerA = m.player_a ? { ...m.player_a, id: m.player_a_id ?? undefined } : null
  const playerB = m.player_b ? { ...m.player_b, id: m.player_b_id ?? undefined } : null
  return (
    <div className={`border border-gray-800 rounded bg-gray-900 text-sm divide-y divide-gray-800 ${w} max-w-full`}>
      <Side
        player={playerA}
        seed={m.seed_a}
        score={m.score_a}
        isWinner={decided && m.winner_id === m.player_a_id}
        decided={decided}
        stat={m.player_a_id ? playerStats?.get(m.player_a_id) : undefined}
        wide={wide}
        isBye={isLeafCol && !m.player_a_id}
        matchId={m.id} side="a" onSlotDrop={onSlotDrop} onSlotClear={onSlotClear}
      />
      <Side
        player={playerB}
        seed={m.seed_b}
        score={m.score_b}
        isWinner={decided && m.winner_id === m.player_b_id}
        decided={decided}
        stat={m.player_b_id ? playerStats?.get(m.player_b_id) : undefined}
        wide={wide}
        isBye={isLeafCol && !m.player_b_id}
        matchId={m.id} side="b" onSlotDrop={onSlotDrop} onSlotClear={onSlotClear}
      />
    </div>
  )
}

/** Three strategies for deriving bracket edges, in priority order:
 *  1. next_match_id FK
 *  2. winner_id tracing (historic data)
 *  3. Slot arithmetic — ceil(S/2) in round R+1 (fallback for TBD brackets)
 */
function deriveEdges(matches: TournamentMatchWithPlayers[]): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = []
  const seen = new Set<string>()
  const add = (from: string, to: string) => {
    const key = `${from}->${to}`
    if (!seen.has(key)) { seen.add(key); edges.push({ from, to }) }
  }

  for (const m of matches) {
    if (m.next_match_id) add(m.id, m.next_match_id)
  }
  if (edges.length > 0) return edges

  const byRound = new Map<number, TournamentMatchWithPlayers[]>()
  for (const m of matches) {
    if (!byRound.has(m.round)) byRound.set(m.round, [])
    byRound.get(m.round)!.push(m)
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b)
  for (let i = 1; i < rounds.length; i++) {
    for (const m of byRound.get(rounds[i])!) {
      for (const playerId of [m.player_a_id, m.player_b_id]) {
        if (!playerId) continue
        let source: TournamentMatchWithPlayers | undefined
        for (let j = i - 1; j >= 0 && !source; j--)
          source = byRound.get(rounds[j])!.find((p) => p.winner_id === playerId)
        if (source) add(source.id, m.id)
      }
    }
  }
  if (edges.length > 0) return edges

  const bySlot = new Map<string, string>()
  for (const m of matches) bySlot.set(`${m.round}:${m.slot}`, m.id)
  for (const m of matches) {
    const nextId = bySlot.get(`${m.round + 1}:${Math.ceil(m.slot / 2)}`)
    if (nextId) add(m.id, nextId)
  }
  return edges
}

interface Line { key: string; d: string }

function layoutRows(
  matches: TournamentMatchWithPlayers[],
  edges: Array<{ from: string; to: string }>
): Map<string, number> {
  const byId = new Map(matches.map((m) => [m.id, m]))
  const children = new Map<string, string[]>()
  const hasParent = new Set<string>()
  for (const e of edges) {
    if (!children.has(e.to)) children.set(e.to, [])
    children.get(e.to)!.push(e.from)
    hasParent.add(e.from)
  }

  const byeSideCount = new Map<string, number>()
  for (const m of matches) {
    const feederCount = children.get(m.id)?.length ?? 0
    if (feederCount === 0) continue
    const playerCount = (m.player_a_id ? 1 : 0) + (m.player_b_id ? 1 : 0)
    if (feederCount < playerCount) byeSideCount.set(m.id, playerCount - feederCount)
  }

  const byeInputCount = new Map<string, number>()
  for (const m of matches) {
    let count = 0
    for (const pid of [m.player_a_id, m.player_b_id]) {
      if (!pid) continue
      const hadPrior = matches.some((p) => p.round < m.round && p.winner_id === pid)
      if (!hadPrior) count++
    }
    if (count > 0) byeInputCount.set(m.id, count)
  }

  const pos = new Map<string, number>()
  let nextLeafRow = 0

  const place = (id: string, seen: Set<string>): number => {
    const cached = pos.get(id)
    if (cached != null) return cached
    if (seen.has(id)) return nextLeafRow
    seen.add(id)

    const kids = (children.get(id) ?? [])
      .map((k) => byId.get(k))
      .filter((m): m is TournamentMatchWithPlayers => m != null)
      .sort((a, b) => a.round - b.round || a.slot - b.slot)

    let row: number
    if (kids.length === 0) {
      const byes = byeInputCount.get(id) ?? 0
      if (byes >= 2) {
        const byeRows: number[] = []
        for (let i = 0; i < byes; i++) byeRows.push(nextLeafRow++)
        row = byeRows.reduce((a, b) => a + b, 0) / byeRows.length
      } else {
        row = nextLeafRow++
      }
    } else {
      const rows = kids.map((k) => place(k.id, seen))
      for (let i = 0; i < (byeSideCount.get(id) ?? 0); i++) rows.push(nextLeafRow++)
      row = rows.reduce((a, b) => a + b, 0) / rows.length
    }
    seen.delete(id)
    pos.set(id, row)
    return row
  }

  const roots = matches
    .filter((m) => !hasParent.has(m.id))
    .sort((a, b) => b.round - a.round || a.slot - b.slot)
  for (const r of roots) place(r.id, new Set())
  for (const m of matches) if (!pos.has(m.id)) place(m.id, new Set())

  return pos
}

const ROW_H = 58

export default function TournamentBracket({
  matches,
  bracketKind = 'championship',
  playerStats,
  onSlotDrop,
  onSlotClear,
}: {
  matches: TournamentMatchWithPlayers[]
  bracketKind?: string
  playerStats?: Map<string, PlayerStat>
  onSlotDrop?: SlotDropHandler
  onSlotClear?: SlotClearHandler
}) {
  const medalGames = useMemo(() => matches.filter((m) => m.is_medal_game), [matches])
  const bracketMatches = useMemo(() => matches.filter((m) => !m.is_medal_game), [matches])
  const edges = useMemo(() => deriveEdges(bracketMatches), [bracketMatches])
  const depth = useMemo(() => depthsFromFinal(bracketMatches, edges), [bracketMatches, edges])
  const rowOf = useMemo(() => layoutRows(bracketMatches, edges), [bracketMatches, edges])

  const columns = useMemo(
    () => [...new Set(bracketMatches.map((m) => depth.get(m.id) ?? 0))].sort((a, b) => b - a),
    [bracketMatches, depth]
  )

  // The leftmost column is the one with the highest depth value.
  const firstColDepth = columns[0] ?? -1

  const byeSlots = useMemo((): ByeSlot[] => {
    const feeders = new Map<string, string[]>()
    for (const e of edges) {
      if (!feeders.has(e.to)) feeders.set(e.to, [])
      feeders.get(e.to)!.push(e.from)
    }

    const slots: ByeSlot[] = []
    for (const m of bracketMatches) {
      const sides = [
        { side: 'a' as const, playerId: m.player_a_id, player: m.player_a, seed: m.seed_a },
        { side: 'b' as const, playerId: m.player_b_id, player: m.player_b, seed: m.seed_b },
      ]

      const bothByes =
        sides.every(({ playerId }) =>
          !playerId || !bracketMatches.some((prev) => prev.round < m.round && prev.winner_id === playerId)
        ) && (feeders.get(m.id) ?? []).length === 0

      for (const { side, playerId, player, seed } of sides) {
        if (!playerId) continue
        const hadPriorMatch = bracketMatches.some(
          (prev) => prev.round < m.round && prev.winner_id === playerId
        )
        if (hadPriorMatch) continue
        if (bothByes) continue

        const matchDepth = depth.get(m.id) ?? 0
        const byeDepth = matchDepth + 1
        if (!columns.includes(byeDepth)) continue

        const otherFeederIds = feeders.get(m.id) ?? []
        const matchRow = rowOf.get(m.id) ?? 0
        let row: number
        if (otherFeederIds.length > 0) {
          const otherRow =
            otherFeederIds.reduce((sum, id) => sum + (rowOf.get(id) ?? matchRow), 0) /
            otherFeederIds.length
          row = 2 * matchRow - otherRow
        } else {
          row = side === 'a' ? Math.floor(matchRow) : Math.ceil(matchRow)
        }

        slots.push({ key: `bye-${m.id}-${side}`, matchId: m.id, colDepth: byeDepth, row, player, seed })
      }
    }
    return slots
  }, [bracketMatches, edges, depth, rowOf, columns])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const byeRefs = useRef(new Map<string, HTMLDivElement>())
  const [lines, setLines] = useState<Line[]>([])

  const setCardRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el)
    else cardRefs.current.delete(id)
  }, [])

  const setByeRef = useCallback((key: string) => (el: HTMLDivElement | null) => {
    if (el) byeRefs.current.set(key, el)
    else byeRefs.current.delete(key)
  }, [])

  const recompute = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const base = container.getBoundingClientRect()
    const next: Line[] = []

    for (const edge of edges) {
      const from = cardRefs.current.get(edge.from)
      const to = cardRefs.current.get(edge.to)
      if (!from || !to) continue
      const a = from.getBoundingClientRect()
      const b = to.getBoundingClientRect()
      const x1 = a.right - base.left
      const y1 = a.top + a.height / 2 - base.top
      const x2 = b.left - base.left
      const y2 = b.top + b.height / 2 - base.top
      const mid = x1 + (x2 - x1) / 2
      next.push({ key: `${edge.from}->${edge.to}`, d: `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}` })
    }

    for (const [key, byeEl] of byeRefs.current) {
      const slot = byeSlots.find((b) => b.key === key)
      if (!slot) continue
      const to = cardRefs.current.get(slot.matchId)
      if (!to) continue
      const a = byeEl.getBoundingClientRect()
      const b = to.getBoundingClientRect()
      const x1 = a.right - base.left
      const y1 = a.top + a.height / 2 - base.top
      const x2 = b.left - base.left
      const y2 = b.top + b.height / 2 - base.top
      const mid = x1 + (x2 - x1) / 2
      next.push({ key: `bye-${key}->match`, d: `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}` })
    }

    setLines((prev) =>
      prev.length === next.length && prev.every((l, i) => l.key === next[i].key && l.d === next[i].d)
        ? prev : next
    )
  }, [edges, byeSlots])

  useMeasureEffect(() => { recompute() }, [recompute])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(recompute)
    observer.observe(container)
    for (const el of cardRefs.current.values()) observer.observe(el)
    for (const el of byeRefs.current.values()) observer.observe(el)
    window.addEventListener('resize', recompute)
    return () => { observer.disconnect(); window.removeEventListener('resize', recompute) }
  }, [recompute])

  if (matches.length === 0) {
    return <p className="text-gray-500 text-sm">No match data recorded for this bracket.</p>
  }

  const gridHeight =
    (Math.max(0, ...rowOf.values(), ...byeSlots.map((b) => b.row)) + 1) * ROW_H

  return (
    <div className="space-y-6">
      {columns.length > 0 && (
        <div className="overflow-x-auto pb-2">
          <div ref={containerRef} className="relative flex gap-6 items-stretch min-w-max">
            <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
              {lines.map((l) => (
                <path key={l.key} d={l.d} fill="none" stroke="currentColor" strokeWidth="1" className="text-gray-700" />
              ))}
            </svg>

            {columns.map((col, colIndex) => {
              const isFirst = col === firstColDepth
              const inRound = bracketMatches
                .filter((m) => (depth.get(m.id) ?? 0) === col)
                .sort((a, b) => a.round - b.round || a.slot - b.slot)
              const colW = isFirst ? 'w-64' : 'w-44'
              return (
                <div key={col} className="flex flex-col relative">
                  <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-1.5">
                    {columnHeading(col, colIndex, bracketKind, inRound)}
                  </h4>
                  <div className={`relative ${colW}`} style={{ height: gridHeight }}>
                    {inRound.map((m) => (
                      <div key={m.id} className="absolute left-0" style={{ top: (rowOf.get(m.id) ?? 0) * ROW_H }}>
                        <div ref={setCardRef(m.id)}>
                          <MatchCard m={m} wide={isFirst} isLeafCol={isFirst} playerStats={isFirst ? playerStats : undefined} onSlotDrop={onSlotDrop} onSlotClear={onSlotClear} />
                        </div>
                      </div>
                    ))}
                    {byeSlots
                      .filter((b) => b.colDepth === col)
                      .map((b) => (
                        <div key={b.key} className="absolute left-0" style={{ top: b.row * ROW_H }} ref={setByeRef(b.key)}>
                          <ByeCard player={b.player} seed={b.seed} />
                        </div>
                      ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {medalGames.map((m) => (
        <div key={m.id} className="space-y-2">
          <h4 className="text-xs uppercase tracking-wide text-gray-500">{m.label ?? 'Medal game'}</h4>
          <MatchCard m={m} onSlotDrop={onSlotDrop} />
        </div>
      ))}
    </div>
  )
}
