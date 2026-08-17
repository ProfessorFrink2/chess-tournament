'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { BRACKET_KIND_LABELS, FORMAT_LABELS, divisionLabel, entrantBracketFor } from '@/lib/tournaments'
import TournamentBracket from '@/components/TournamentBracket'
import type { PlayerStat } from '@/components/TournamentBracket'
import type {
  Bracket,
  BracketKind,
  DivisionKey,
  Player,
  SeasonStanding,
  Tournament,
  TournamentDivision,
  TournamentEntrantWithPlayer,
  TournamentMatchWithPlayers,
} from '@/lib/database.types'

const DIVISIONS: Bracket[] = ['A', 'B', 'C', 'D']
const KINDS: BracketKind[] = ['championship', 'consolation', 'winners', 'losers']

export default function AdminTournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [divisions, setDivisions] = useState<TournamentDivision[]>([])
  const [entrants, setEntrants] = useState<TournamentEntrantWithPlayer[]>([])
  const [matches, setMatches] = useState<TournamentMatchWithPlayers[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('')

  const [activeDivision, setActiveDivision] = useState<DivisionKey | null>(null)
  const [activeKind, setActiveKind] = useState<BracketKind>('championship')
  const [addPlayerId, setAddPlayerId] = useState('')
  const [addSeed, setAddSeed] = useState('')
  const [customDivision, setCustomDivision] = useState('')
  const [seasonStandings, setSeasonStandings] = useState<(SeasonStanding & { player: { id: string; display_name: string } | null })[]>([])
  const [seasonMatchPlayers, setSeasonMatchPlayers] = useState<Player[]>([])
  // Raw season match rows for computing W/D/L stats
  const [seasonMatchRows, setSeasonMatchRows] = useState<{ white_player_id: string | null; black_player_id: string | null; result: string; bracket: string }[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    const playerCols = 'id, display_name, chess_com_username'

    const [{ data: t }, { data: ds }, { data: es }, { data: ms }, { data: ps }] =
      await Promise.all([
        supabase.from('tournaments').select('*').eq('id', id).maybeSingle(),
        supabase.from('tournament_divisions').select('*').eq('tournament_id', id).order('division'),
        supabase
          .from('tournament_entrants')
          .select(`*, player:players(${playerCols})`)
          .eq('tournament_id', id)
          .order('seed', { nullsFirst: false }),
        supabase
          .from('tournament_matches')
          .select(`*, player_a:players!player_a_id(${playerCols}), player_b:players!player_b_id(${playerCols})`)
          .eq('tournament_id', id)
          .order('round')
          .order('slot'),
        supabase.from('players').select('*').order('display_name'),
      ])

    const tournament = (t ?? null) as Tournament | null
    setTournament(tournament)
    const divs = (ds ?? []) as TournamentDivision[]
    setDivisions(divs)
    setEntrants((es ?? []) as unknown as TournamentEntrantWithPlayer[])
    setMatches((ms ?? []) as unknown as TournamentMatchWithPlayers[])
    setPlayers((ps ?? []) as Player[])
    setActiveDivision((prev) => prev ?? divs[0]?.division ?? null)

    if (tournament?.season_id) {
      const { data: standings } = await supabase
        .from('season_standings')
        .select('*, player:players(id, display_name)')
        .eq('season_id', tournament.season_id)
        .order('rank')
      if (standings && standings.length > 0) {
        setSeasonStandings(standings as unknown as (SeasonStanding & { player: { id: string; display_name: string } | null })[])
        setSeasonMatchPlayers([])
        setSeasonMatchRows([])
      } else {
        const { data: matchRows } = await supabase
          .from('matches')
          .select('white_player_id, black_player_id, bracket, result')
          .eq('season_id', tournament.season_id)
        const rows = (matchRows ?? []) as { white_player_id: string | null; black_player_id: string | null; result: string; bracket: string }[]
        setSeasonMatchRows(rows)
        const ids = new Set<string>()
        for (const m of rows) {
          if (m.white_player_id) ids.add(m.white_player_id)
          if (m.black_player_id) ids.add(m.black_player_id)
        }
        if (ids.size > 0) {
          const { data: seasonPs } = await supabase.from('players').select('*').in('id', [...ids]).order('display_name')
          setSeasonMatchPlayers((seasonPs ?? []) as Player[])
        } else {
          setSeasonMatchPlayers([])
        }
        setSeasonStandings([])
      }
    } else {
      setSeasonStandings([])
      setSeasonMatchPlayers([])
      setSeasonMatchRows([])
    }

    setLoading(false)
  }, [id])

  useEffect(() => {
    async function guard() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/'); return }
      const { data } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      if ((data as { role: string } | null)?.role !== 'admin') { router.push('/'); return }
      load()
    }
    guard()
  }, [load, router])

  // Build W/D/L stats per player from the linked season's match rows.
  const playerStats = useMemo((): Map<string, PlayerStat> => {
    const map = new Map<string, PlayerStat>()
    const ensure = (id: string) => {
      if (!map.has(id)) map.set(id, { w: 0, d: 0, l: 0 })
      return map.get(id)!
    }
    for (const m of seasonMatchRows) {
      if (!m.white_player_id || !m.black_player_id) continue
      const w = ensure(m.white_player_id)
      const b = ensure(m.black_player_id)
      if (m.result === 'white_wins') { w.w++; b.l++ }
      else if (m.result === 'black_wins') { w.l++; b.w++ }
      else if (m.result === 'draw') { w.d++; b.d++ }
    }
    // Also use season_standings if available.
    for (const s of seasonStandings) {
      if (!s.player?.id) continue
      map.set(s.player.id, { w: s.wins ?? 0, d: s.draws ?? 0, l: s.losses ?? 0 })
    }
    return map
  }, [seasonMatchRows, seasonStandings])

  async function addDivision(division: DivisionKey) {
    const { error } = await supabase.from('tournament_divisions').insert({
      tournament_id: id,
      division,
      format: tournament?.format ?? 'single_elim',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    if (error) { setStatus('Error: ' + error.message); return }
    setActiveDivision(division)
    load()
  }

  async function removeDivision(divisionId: string, division: DivisionKey) {
    if (!confirm(`Remove division ${division}? Its entrants and matches stay but become orphaned.`)) return
    await supabase.from('tournament_divisions').delete().eq('id', divisionId)
    setActiveDivision(null)
    load()
  }

  async function addEntrant() {
    if (!addPlayerId) { setStatus('Pick a player to add'); return }
    const seed = addSeed.trim() ? parseInt(addSeed, 10) : null
    const { error } = await supabase.from('tournament_entrants').insert({
      tournament_id: id,
      division: activeDivision,
      bracket_kind: entrantBracketFor(activeKind),
      player_id: addPlayerId,
      seed,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    if (error) { setStatus('Error: ' + error.message); return }
    setAddPlayerId('')
    setAddSeed('')
    load()
  }

  async function updateEntrant(entrantId: string, patch: { seed?: number | null }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('tournament_entrants').update(patch as any).eq('id', entrantId)
    if (error) { setStatus('Error: ' + error.message); return }
    setEntrants((prev) => prev.map((e) => (e.id === entrantId ? { ...e, ...patch } : e)))
  }

  async function removeEntrant(entrantId: string) {
    await supabase.from('tournament_entrants').delete().eq('id', entrantId)
    load()
  }

  async function importFromSeason(division: DivisionKey) {
    setStatus('Importing…')

    let rows: { tournament_id: string; division: string | null; bracket_kind: string; player_id: string; seed: number }[]

    const divStandings = seasonStandings.filter((s) => s.division === division)
    if (divStandings.length > 0) {
      rows = divStandings
        .filter((s) => s.player?.id)
        .map((s) => ({
          tournament_id: id,
          division: activeDivision,
          bracket_kind: entrantBracketFor(activeKind),
          player_id: s.player!.id,
          seed: s.rank,
        }))
    } else if (tournament?.season_id) {
      const { data: matchRows } = await supabase
        .from('matches')
        .select('white_player_id, black_player_id, result, bracket')
        .eq('season_id', tournament.season_id)
        .eq('bracket', division)
      if (!matchRows || matchRows.length === 0) {
        setStatus(`No matches found for division ${division} in the linked season`)
        return
      }
      const points: Record<string, number> = {}
      for (const m of matchRows) {
        if (m.white_player_id) points[m.white_player_id] ??= 0
        if (m.black_player_id) points[m.black_player_id] ??= 0
        if (m.result === 'white_wins') { points[m.white_player_id] += 2 }
        else if (m.result === 'black_wins') { points[m.black_player_id] += 2 }
        else if (m.result === 'draw') { points[m.white_player_id] += 1; points[m.black_player_id] += 1 }
      }
      rows = Object.entries(points)
        .sort((a, b) => b[1] - a[1])
        .map(([player_id], i) => ({
          tournament_id: id, division: activeDivision,
          bracket_kind: entrantBracketFor(activeKind), player_id, seed: i + 1,
        }))
    } else {
      setStatus('No season linked to this tournament')
      return
    }

    const alreadyIn = new Set(
      entrants
        .filter((e) => e.division === activeDivision && e.bracket_kind === entrantBracketFor(activeKind))
        .map((e) => e.player_id)
    )
    const newRows = rows.filter((r) => !alreadyIn.has(r.player_id))
    if (newRows.length === 0) { setStatus('All players already added.'); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('tournament_entrants').insert(newRows as any)
    if (error) { setStatus('Error: ' + error.message); return }
    setStatus(`Imported ${newRows.length} entrants from season standings.`)
    load()
  }

  async function dropPlayerIntoSlot(matchId: string, side: 'a' | 'b', playerId: string) {
    await updateMatch(matchId, side === 'a' ? { player_a_id: playerId } : { player_b_id: playerId })
  }

  async function generateBracket() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setStatus('Session expired — sign in again'); return }
    setStatus('Generating bracket…')
    const res = await fetch('/api/tournaments/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ tournamentId: id, division: activeDivision, bracketKind: activeKind }),
    })
    const data = await res.json()
    if (!res.ok) { setStatus('Error: ' + (data.error ?? res.statusText)); return }
    setStatus(`Generated ${data.created} matches.`)
    load()
  }

  async function updateMatch(
    matchId: string,
    patch: Partial<Pick<TournamentMatchWithPlayers, 'score_a' | 'score_b' | 'winner_id' | 'player_a_id' | 'player_b_id'>>
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('tournament_matches').update(patch as any).eq('id', matchId)
    if (error) { setStatus('Error: ' + error.message); return }
    setMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, ...patch } : m)))
  }

  if (loading) return <p className="text-gray-400">Loading…</p>
  if (!tournament) return <p className="text-gray-400">Tournament not found.</p>

  const divisionEntrants = entrants.filter(
    (e) => e.division === activeDivision && e.bracket_kind === entrantBracketFor(activeKind)
  )
  const divisionMatches = matches.filter(
    (m) => m.division === activeDivision && m.bracket_kind === activeKind
  )
  const entrantPlayerIds = new Set(divisionEntrants.map((e) => e.player_id))
  const seasonPlayerIds = new Set<string>([
    ...seasonStandings.map((s) => s.player?.id).filter((x): x is string => Boolean(x)),
    ...seasonMatchPlayers.map((p) => p.id),
  ])
  const availablePlayers = players
    .filter((p) => !entrantPlayerIds.has(p.id))
    .sort((a, b) => {
      const aIn = seasonPlayerIds.has(a.id)
      const bIn = seasonPlayerIds.has(b.id)
      if (aIn === bIn) return a.display_name.localeCompare(b.display_name)
      return aIn ? -1 : 1
    })

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-300">← Admin</Link>
        <h1 className="text-2xl font-bold mt-2">
          <span className="text-gray-600 mr-2">#{tournament.number}</span>
          {tournament.name}
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          {FORMAT_LABELS[tournament.format] ?? tournament.format}
          {' · '}
          <Link href={`/tournaments/${tournament.id}`} className="hover:text-white underline">
            View public page
          </Link>
        </p>
      </div>

      {status && (
        <div className="bg-gray-800 border border-gray-700 rounded px-4 py-2 text-sm text-amber-300">
          {status}
        </div>
      )}

      {/* Divisions */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Divisions</h2>
        <div className="flex gap-2 flex-wrap items-center">
          {divisions.map((d) => (
            <span key={d.id} className="flex items-center">
              <button
                onClick={() => setActiveDivision(d.division)}
                className={`px-3 py-1 rounded-l text-sm border transition-colors ${
                  activeDivision === d.division
                    ? 'bg-white text-gray-900 border-white font-medium'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500'
                }`}
              >
                {divisionLabel(d.division)}
              </button>
              <button
                onClick={() => removeDivision(d.id, d.division)}
                className="px-2 py-1 rounded-r text-sm border border-l-0 border-gray-700 text-gray-600 hover:text-red-400"
                title="Remove division"
              >
                ×
              </button>
            </span>
          ))}
          {DIVISIONS.filter((d) => !divisions.some((x) => x.division === d)).map((d) => (
            <button key={d} onClick={() => addDivision(d)}
              className="px-3 py-1 rounded text-sm border border-dashed border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300">
              + {d}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <input
            placeholder="Custom division name, e.g. B (X) or Kamloops"
            value={customDivision}
            onChange={(e) => setCustomDivision(e.target.value)}
            maxLength={40}
            className="flex-1 max-w-80 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
          />
          <button
            onClick={() => {
              const name = customDivision.trim()
              if (!name) { setStatus('Enter a division name'); return }
              if (divisions.some((x) => x.division === name)) { setStatus(`Division "${name}" already exists`); return }
              setCustomDivision('')
              addDivision(name)
            }}
            className="text-sm border border-gray-700 px-3 py-1.5 rounded hover:bg-gray-800"
          >
            Add division
          </button>
        </div>
        {divisions.length === 0 && (
          <p className="text-xs text-gray-500 mt-2">
            No divisions — entrants and matches will be recorded without one.
          </p>
        )}
      </section>

      {/* Entrants + Bracket combined */}
      <section>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">
              {divisionLabel(activeDivision)}
              <span className="text-gray-500 text-sm font-normal ml-2">
                {entrantBracketFor(activeKind) === 'consolation' ? 'Consolation' : 'Championship'}
              </span>
            </h2>
            <select
              value={activeKind}
              onChange={(e) => setActiveKind(e.target.value as BracketKind)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white"
            >
              {KINDS.map((k) => <option key={k} value={k}>{BRACKET_KIND_LABELS[k]}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(seasonStandings.length > 0 || seasonMatchPlayers.length > 0) && activeDivision && divisionMatches.length === 0 && (
              <button onClick={() => importFromSeason(activeDivision)}
                className="text-xs bg-gray-800 border border-gray-700 px-3 py-1.5 rounded hover:bg-gray-700">
                Seed from season standings
              </button>
            )}
            {divisionMatches.length === 0 && (
              <button onClick={generateBracket}
                className="text-xs bg-gray-800 border border-gray-700 px-3 py-1.5 rounded hover:bg-gray-700">
                Generate from seeds
              </button>
            )}
          </div>
        </div>

        {/* Bracket is the primary UI — entrant rows are embedded as round-1 cards */}
        {divisionMatches.length > 0 ? (
          <div className="border border-gray-800 rounded px-4 pb-4 pt-2 bg-gray-950 overflow-x-auto">
            <TournamentBracket
              matches={divisionMatches}
              bracketKind={activeKind}
              playerStats={playerStats.size > 0 ? playerStats : undefined}
              onSlotDrop={dropPlayerIntoSlot}
            />
          </div>
        ) : (
          <div className="space-y-1 mb-3">
            {divisionEntrants.length === 0 && (
              <p className="text-gray-500 text-sm">No entrants yet. Add players below, then generate the bracket.</p>
            )}
            {divisionEntrants.map((e) => (
              <div
                key={e.id}
                draggable
                onDragStart={(ev) => { ev.dataTransfer.setData('playerId', e.player_id); ev.dataTransfer.effectAllowed = 'copy' }}
                className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm cursor-grab active:cursor-grabbing"
              >
                <span className="text-gray-600 select-none">⠿</span>
                <input
                  type="number"
                  value={e.seed ?? ''}
                  placeholder="seed"
                  onChange={(ev) => updateEntrant(e.id, { seed: ev.target.value ? parseInt(ev.target.value, 10) : null })}
                  className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs"
                />
                <span className="flex-1 truncate">{e.player?.display_name}</span>
                <button onClick={() => removeEntrant(e.id)} className="text-xs text-red-500 hover:text-red-400">×</button>
              </div>
            ))}
          </div>
        )}

        {/* Match score entry — shown below the bracket */}
        {divisionMatches.length > 0 && (
          <div className="mt-4 space-y-1">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs uppercase tracking-wide text-gray-500">Match results</h3>
              <button onClick={generateBracket} className="text-xs text-gray-600 hover:text-gray-400 underline">
                Regenerate bracket
              </button>
            </div>
            {divisionMatches.filter((m) => !m.is_medal_game).map((m) => (
              <div key={m.id} className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm flex-wrap">
                <span className="text-gray-600 text-xs w-14 shrink-0">R{m.round}·{m.slot}</span>
                <span className="flex-1 min-w-28 truncate">
                  {m.player_a?.display_name ?? <span className="text-gray-700">TBD</span>}
                </span>
                <input type="number" value={m.score_a ?? ''}
                  onChange={(e) => updateMatch(m.id, { score_a: e.target.value ? parseInt(e.target.value, 10) : null })}
                  className="w-12 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs" />
                <span className="text-gray-600">–</span>
                <input type="number" value={m.score_b ?? ''}
                  onChange={(e) => updateMatch(m.id, { score_b: e.target.value ? parseInt(e.target.value, 10) : null })}
                  className="w-12 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs" />
                <span className="flex-1 min-w-28 truncate">
                  {m.player_b?.display_name ?? <span className="text-gray-700">TBD</span>}
                </span>
                <select value={m.winner_id ?? ''} onChange={(e) => updateMatch(m.id, { winner_id: e.target.value || null })}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs">
                  <option value="">No winner</option>
                  {m.player_a_id && <option value={m.player_a_id}>{m.player_a?.display_name}</option>}
                  {m.player_b_id && <option value={m.player_b_id}>{m.player_b?.display_name}</option>}
                </select>
              </div>
            ))}
          </div>
        )}

        {/* Add a player */}
        <div className="flex gap-2 flex-wrap mt-4">
          <select value={addPlayerId} onChange={(e) => setAddPlayerId(e.target.value)}
            className="flex-1 min-w-48 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white">
            <option value="">Add a player…</option>
            {seasonPlayerIds.size > 0 && <option disabled>── Season participants ──</option>}
            {availablePlayers.filter((p) => seasonPlayerIds.has(p.id)).map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}{p.chess_com_username ? ` (${p.chess_com_username})` : ''}</option>
            ))}
            {seasonPlayerIds.size > 0 && availablePlayers.some((p) => !seasonPlayerIds.has(p.id)) && (
              <option disabled>── Other players ──</option>
            )}
            {availablePlayers.filter((p) => !seasonPlayerIds.has(p.id)).map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}{p.chess_com_username ? ` (${p.chess_com_username})` : ''}</option>
            ))}
          </select>
          <input placeholder="seed" inputMode="numeric" value={addSeed} onChange={(e) => setAddSeed(e.target.value)}
            className="w-20 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white" />
          <button onClick={addEntrant} className="bg-white text-gray-900 text-sm font-medium px-4 py-1.5 rounded hover:bg-gray-100">
            Add
          </button>
        </div>
      </section>
    </div>
  )
}
