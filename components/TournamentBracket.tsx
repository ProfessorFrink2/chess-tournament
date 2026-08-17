'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TournamentMatchWithPlayers } from '@/lib/database.types'

// useLayoutEffect warns when this component is server-rendered; measuring only
// matters in the browser, where it avoids a frame of unpositioned lines.
const useMeasureEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** How many matches remain between this one and the final.
 *
 *  0 is the final, 1 a semifinal, 2 a quarterfinal. Derived by walking the
 *  advancement graph, NOT from the round number printed on the source sheet.
 *  In an irregular draw the two differ: tournament 14's A division sent the
 *  winner of Alicia vs Nathan (sheet round 2) straight to a semifinal, so that
 *  match is a quarterfinal even though two other quarterfinals were played a
 *  round later. Grouping by depth puts all four in one column.
 */
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
    // A match with no successor is the final. Anything else without one is a
    // gap in the data; fall back to its position among the rounds.
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

/** Heading for a column of matches at the same depth.
 *
 *  Prefers an explicit label when every match in the column shares one
 *  ("Losers final", "Grand final"). Final/Semifinals/Quarterfinals naming only
 *  applies to a knockout draw -- on the losers side of a double elimination the
 *  last round is not a "final", so those names would be wrong there. */
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

type SlotDropHandler = (matchId: string, side: 'a' | 'b', playerId: string) => void

function Side({
  player,
  seed,
  score,
  isWinner,
  decided,
  matchId,
  side,
  onSlotDrop,
}: {
  player: { display_name: string } | null
  seed: number | null
  score: number | null
  isWinner: boolean
  decided: boolean
  matchId?: string
  side?: 'a' | 'b'
  onSlotDrop?: SlotDropHandler
}) {
  const [dragOver, setDragOver] = useState(false)
  const isDropTarget = !!onSlotDrop && !!matchId && !!side

  return (
    <div
      className={`flex items-center justify-between gap-2 px-2 py-0.5 transition-colors ${
        dragOver ? 'bg-blue-900/40' :
        isWinner ? 'text-white font-semibold' : decided ? 'text-gray-500' : 'text-gray-300'
      } ${isDropTarget ? 'cursor-pointer' : ''}`}
      onDragOver={isDropTarget ? (e) => { e.preventDefault(); setDragOver(true) } : undefined}
      onDragLeave={isDropTarget ? () => setDragOver(false) : undefined}
      onDrop={isDropTarget ? (e) => {
        e.preventDefault()
        setDragOver(false)
        const pid = e.dataTransfer.getData('playerId')
        if (pid) onSlotDrop!(matchId!, side!, pid)
      } : undefined}
    >
      <span className="truncate">
        {seed != null && <span className="text-gray-600 mr-1 tabular-nums">({seed})</span>}
        {player?.display_name ?? <span className="text-gray-700 italic">TBD</span>}
      </span>
      <span className="tabular-nums text-xs shrink-0">{score ?? ''}</span>
    </div>
  )
}

function MatchCard({
  m,
  onSlotDrop,
}: {
  m: TournamentMatchWithPlayers
  onSlotDrop?: SlotDropHandler
}) {
  const decided = m.winner_id != null
  return (
    <div className="border border-gray-800 rounded bg-gray-900 text-sm divide-y divide-gray-800 w-44 max-w-full">
      <Side
        player={m.player_a}
        seed={m.seed_a}
        score={m.score_a}
        isWinner={decided && m.winner_id === m.player_a_id}
        decided={decided}
        matchId={m.id} side="a" onSlotDrop={onSlotDrop}
      />
      <Side
        player={m.player_b}
        seed={m.seed_b}
        score={m.score_b}
        isWinner={decided && m.winner_id === m.player_b_id}
        decided={decided}
        matchId={m.id} side="b" onSlotDrop={onSlotDrop}
      />
    </div>
  )
}

/** Work out which earlier match each player arrived from.
 *
 *  Deliberately derived from results rather than from slot arithmetic. Several
 *  of these brackets are irregular — tournament 14's A division has rounds of
 *  4, 4, 2, 2, 2 because byes are staggered — so the usual "match s feeds
 *  match ceil(s/2)" rule would draw the wrong lines. A player with a bye simply
 *  has no source match, and correctly gets no line.
 */
function deriveEdges(matches: TournamentMatchWithPlayers[]): Array<{ from: string; to: string }> {
  const byRound = new Map<number, TournamentMatchWithPlayers[]>()
  for (const m of matches) {
    if (!byRound.has(m.round)) byRound.set(m.round, [])
    byRound.get(m.round)!.push(m)
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b)
  const edges: Array<{ from: string; to: string }> = []

  for (let i = 1; i < rounds.length; i++) {
    const target = byRound.get(rounds[i])!
    for (const m of target) {
      for (const playerId of [m.player_a_id, m.player_b_id]) {
        if (!playerId) continue
        // Nearest earlier round in which this player won something.
        let source: TournamentMatchWithPlayers | undefined
        for (let j = i - 1; j >= 0 && !source; j--) {
          source = byRound.get(rounds[j])!.find((p) => p.winner_id === playerId)
        }
        if (source) edges.push({ from: source.id, to: m.id })
      }
    }
  }
  return edges
}

interface Line {
  key: string
  d: string
}

/** Vertical row index for every match, so the bracket reads as a tree.
 *
 *  Laid out from the final backwards, the way a bracket is actually drawn:
 *  walk the advancement graph depth-first, give each leaf the next free row,
 *  and sit every other match at the average row of the matches that fed it.
 *  A player who entered on a bye contributes no feeder, so the match aligns
 *  with the side that did play and leaves a gap where the bye was.
 *
 *  Working backwards from the root is what guarantees no two matches land on
 *  the same row -- laying out left to right and interpolating does not.
 */
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

  // A match has "bye sides" when it has real players but fewer feeder matches —
  // meaning some players entered directly without winning a prior match. Each bye
  // side needs its own leaf row so the match is centred between the real feeder
  // and the gap, rather than sitting on top of the feeder.
  const byeSideCount = new Map<string, number>()
  for (const m of matches) {
    const feederCount = children.get(m.id)?.length ?? 0
    if (feederCount === 0) continue // true leaf — no byes, just first-round players
    const playerCount = (m.player_a_id ? 1 : 0) + (m.player_b_id ? 1 : 0)
    if (feederCount < playerCount) byeSideCount.set(m.id, playerCount - feederCount)
  }

  // Pre-compute, for each match, how many of its players entered without
  // winning a prior match (i.e. had a bye). Each such player needs its own
  // leaf-row slot so bye cards don't collapse on top of each other.
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
    if (seen.has(id)) return nextLeafRow // cycle guard; cannot happen in a valid draw
    seen.add(id)

    const kids = (children.get(id) ?? [])
      .map((k) => byId.get(k))
      .filter((m): m is TournamentMatchWithPlayers => m != null)
      .sort((a, b) => a.round - b.round || a.slot - b.slot)

    let row: number
    if (kids.length === 0) {
      const byes = byeInputCount.get(id) ?? 0
      if (byes >= 2) {
        // Both players entered on a bye — allocate one leaf row per bye so
        // their placeholder cards don't collapse onto each other.
        const byeRows: number[] = []
        for (let i = 0; i < byes; i++) byeRows.push(nextLeafRow++)
        row = byeRows.reduce((a, b) => a + b, 0) / byeRows.length
      } else {
        row = nextLeafRow++
      }
    } else {
      const rows = kids.map((k) => place(k.id, seen))
      // Allocate leaf rows for bye sides so the match is spaced between the
      // real feeder(s) and the bye gap, not collapsed onto the feeder.
      for (let i = 0; i < (byeSideCount.get(id) ?? 0); i++) rows.push(nextLeafRow++)
      row = rows.reduce((a, b) => a + b, 0) / rows.length
    }
    seen.delete(id)
    pos.set(id, row)
    return row
  }

  // Roots first (a match nothing advances out of -- the final), deepest last.
  const roots = matches
    .filter((m) => !hasParent.has(m.id))
    .sort((a, b) => b.round - a.round || a.slot - b.slot)
  for (const r of roots) place(r.id, new Set())
  // Anything the graph did not reach still needs a row.
  for (const m of matches) if (!pos.has(m.id)) place(m.id, new Set())

  return pos
}

/** Row pitch in px. Must exceed a card's height or rows would overlap. */
const ROW_H = 58

/** Renders one bracket (one bracket_kind within one division) as columns of
 *  rounds, with connectors showing how winners advance. Medal games are pulled
 *  out and shown separately, because they sit outside the elimination tree. */
export default function TournamentBracket({
  matches,
  bracketKind = 'championship',
  onSlotDrop,
}: {
  matches: TournamentMatchWithPlayers[]
  bracketKind?: string
  onSlotDrop?: SlotDropHandler
}) {
  // Memoised: these feed recompute's dependency list, and a fresh array on
  // every render would make the measure effect loop.
  const medalGames = useMemo(() => matches.filter((m) => m.is_medal_game), [matches])
  const bracketMatches = useMemo(() => matches.filter((m) => !m.is_medal_game), [matches])
  const edges = useMemo(() => deriveEdges(bracketMatches), [bracketMatches])
  const depth = useMemo(() => depthsFromFinal(bracketMatches, edges), [bracketMatches, edges])
  const rowOf = useMemo(() => layoutRows(bracketMatches, edges), [bracketMatches, edges])

  const columns = useMemo(
    () => [...new Set(bracketMatches.map((m) => depth.get(m.id) ?? 0))].sort((a, b) => b - a),
    [bracketMatches, depth]
  )

  // For each player who appears in a match without having won a prior match
  // (i.e. they entered on a bye), synthesise a placeholder card one column
  // to the left of their first real match.
  //
  // Row placement: the bye sits opposite the other feeder around the match
  // centre — byeRow = 2×matchRow − otherFeederRow. This mirrors the tree
  // layout and guarantees no collision with real match cards.
  const byeSlots = useMemo((): ByeSlot[] => {
    const feeders = new Map<string, string[]>()
    for (const e of edges) {
      if (!feeders.has(e.to)) feeders.set(e.to, [])
      feeders.get(e.to)!.push(e.from)
    }

    const slots: ByeSlot[] = []
    for (const m of bracketMatches) {
      const sides: Array<{
        side: 'a' | 'b'
        playerId: string | null
        player: { display_name: string } | null
        seed: number | null
      }> = [
        { side: 'a', playerId: m.player_a_id, player: m.player_a, seed: m.seed_a },
        { side: 'b', playerId: m.player_b_id, player: m.player_b, seed: m.seed_b },
      ]

      const bothByes =
        sides.every(
          ({ playerId }) =>
            !playerId ||
            !bracketMatches.some((prev) => prev.round < m.round && prev.winner_id === playerId)
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
      next.push({
        key: `${edge.from}->${edge.to}`,
        d: `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`,
      })
    }

    // Connectors from bye cards into their target match card.
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
    // Measuring runs on every resize; only re-render when something moved.
    setLines((prev) =>
      prev.length === next.length && prev.every((l, i) => l.key === next[i].key && l.d === next[i].d)
        ? prev
        : next
    )
  }, [edges, byeSlots])

  useMeasureEffect(() => {
    recompute()
  }, [recompute])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(recompute)
    observer.observe(container)
    for (const el of cardRefs.current.values()) observer.observe(el)
    for (const el of byeRefs.current.values()) observer.observe(el)
    window.addEventListener('resize', recompute)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', recompute)
    }
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
            {/* Connectors sit behind the cards and are pointer-transparent. */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              aria-hidden="true"
            >
              {lines.map((l) => (
                <path
                  key={l.key}
                  d={l.d}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  className="text-gray-700"
                />
              ))}
            </svg>

            {columns.map((col, colIndex) => {
              const inRound = bracketMatches
                .filter((m) => (depth.get(m.id) ?? 0) === col)
                .sort((a, b) => a.round - b.round || a.slot - b.slot)
              return (
              <div key={col} className="flex flex-col relative">
                <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-3">
                  {columnHeading(col, colIndex, bracketKind, inRound)}
                </h4>
                {/* Absolute rows: a match sits against the matches that fed
                    it, so a bye shows up as an empty gap in the column. */}
                <div className="relative w-44" style={{ height: gridHeight }}>
                  {inRound.map((m) => (
                    <div
                      key={m.id}
                      className="absolute left-0"
                      style={{ top: (rowOf.get(m.id) ?? 0) * ROW_H }}
                    >
                      <div ref={setCardRef(m.id)}>
                        <MatchCard m={m} onSlotDrop={onSlotDrop} />
                      </div>
                    </div>
                  ))}
                  {byeSlots
                    .filter((b) => b.colDepth === col)
                    .map((b) => (
                      <div
                        key={b.key}
                        className="absolute left-0"
                        style={{ top: b.row * ROW_H }}
                        ref={setByeRef(b.key)}
                      >
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
          <h4 className="text-xs uppercase tracking-wide text-gray-500">
            {m.label ?? 'Medal game'}
          </h4>
          <MatchCard m={m} onSlotDrop={onSlotDrop} />
        </div>
      ))}
    </div>
  )
}
