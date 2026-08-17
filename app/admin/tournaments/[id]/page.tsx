'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { BRACKET_KIND_LABELS, FORMAT_LABELS, divisionLabel, entrantBracketFor } from '@/lib/tournaments'
import TournamentBracket from '@/components/TournamentBracket'
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
  const [showBracketPreview, setShowBracketPreview] = useState(false)

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
          .select(
            `*, player_a:players!player_a_id(${playerCols}), player_b:players!player_b_id(${playerCols})`
          )
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

    // Load season participants if this tournament is linked to a season.
    // Historic seasons store results in season_standings; live seasons store
    // them in matches. Try standings first, fall back to match participants.
    if (tournament?.season_id) {
      const { data: standings } = await supabase
        .from('season_standings')
        .select('*, player:players(id, display_name)')
        .eq('season_id', tournament.season_id)
        .order('rank')
      if (standings && standings.length > 0) {
        setSeasonStandings(standings as unknown as (SeasonStanding & { player: { id: string; display_name: string } | null })[])
        setSeasonMatchPlayers([])
      } else {
        // Live season: derive participants from match history.
        const { data: matchRows } = await supabase
          .from('matches')
          .select('white_player_id, black_player_id, bracket, result')
          .eq('season_id', tournament.season_id)
        const ids = new Set<string>()
        for (const m of matchRows ?? []) {
          if (m.white_player_id) ids.add(m.white_player_id)
          if (m.black_player_id) ids.add(m.black_player_id)
        }
        if (ids.size > 0) {
          const { data: seasonPs } = await supabase
            .from('players')
            .select('*')
            .in('id', [...ids])
            .order('display_name')
          setSeasonMatchPlayers((seasonPs ?? []) as Player[])
        } else {
          setSeasonMatchPlayers([])
        }
        setSeasonStandings([])
      }
    } else {
      setSeasonStandings([])
      setSeasonMatchPlayers([])
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

  async function updateEntrant(entrantId: string, patch: { seed?: number | null; final_placement?: number | null }) {
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
      // Historic season: use pre-computed standings.
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
      // Live season: compute standings from match history for this division.
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
        else if (m.result === 'draw') {
          points[m.white_player_id] += 1
          points[m.black_player_id] += 1
        }
      }
      const ranked = Object.entries(points)
        .sort((a, b) => b[1] - a[1])
        .map(([player_id], i) => ({
          tournament_id: id,
          division: activeDivision,
          bracket_kind: entrantBracketFor(activeKind),
          player_id,
          seed: i + 1,
        }))
      rows = ranked
    } else {
      setStatus('No season linked to this tournament')
      return
    }

    // Insert only players not already in this bracket (avoids onConflict issues
    // with the functional unique index on coalesce(division, '-')).
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
    const patch = side === 'a'
      ? { player_a_id: playerId }
      : { player_b_id: playerId }
    await updateMatch(matchId, patch)
  }

  async function generateBracket() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setStatus('Session expired — sign in again'); return }

    setStatus('Generating bracket…')
    const res = await fetch('/api/tournaments/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${session.access_token}`,
      },
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

  // Entrants belong to a bracket, not just a division — a consolation bracket
  // has its own field and its own placements.
  const divisionEntrants = entrants.filter(
    (e) => e.division === activeDivision && e.bracket_kind === entrantBracketFor(activeKind)
  )
  const divisionMatches = matches.filter(
    (m) => m.division === activeDivision && m.bracket_kind === activeKind
  )
  const entrantPlayerIds = new Set(divisionEntrants.map((e) => e.player_id))
  // Either historic (from season_standings) or live (from match participants).
  const seasonPlayerIds = new Set<string>([
    ...seasonStandings.map((s) => s.player?.id).filter((x): x is string => Boolean(x)),
    ...seasonMatchPlayers.map((p) => p.id),
  ])
  const availablePlayers = players
    .filter((p) => !entrantPlayerIds.has(p.id))
    .sort((a, b) => {
      // Season participants float to the top when there's a linked season.
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
            <button
              key={d}
              onClick={() => addDivision(d)}
              className="px-3 py-1 rounded text-sm border border-dashed border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
            >
              + {d}
            </button>
          ))}
        </div>

        {/* Divisions are not restricted to A-D: past tournaments used city
            names and qualified names like "A (Bogdan)" or "B (X)". */}
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
              if (divisions.some((x) => x.division === name)) {
                setStatus(`Division "${name}" already exists`); return
              }
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
            No divisions — entrants and matches will be recorded without one. That is correct for a
            tournament that was never split up.
          </p>
        )}
      </section>

      {/* Entrants */}
      <section>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="text-lg font-semibold">
            Entrants{' '}
            <span className="text-gray-500 text-sm font-normal">
              — {divisionLabel(activeDivision)} · {entrantBracketFor(activeKind) === 'consolation' ? 'Consolation' : 'Main draw'}
            </span>
          </h2>
          {(seasonStandings.length > 0 || seasonMatchPlayers.length > 0) && activeDivision && (
            <button
              onClick={() => importFromSeason(activeDivision)}
              className="text-xs bg-gray-800 border border-gray-700 px-3 py-1.5 rounded hover:bg-gray-700"
            >
              Seed from season standings
            </button>
          )}
        </div>

        <div className="space-y-1 mb-3">
          {divisionEntrants.map((e) => (
            <div
              key={e.id}
              draggable
              onDragStart={(ev) => {
                ev.dataTransfer.setData('playerId', e.player_id)
                ev.dataTransfer.effectAllowed = 'copy'
              }}
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
              <label className="text-xs text-gray-500">place</label>
              <input
                type="number"
                value={e.final_placement ?? ''}
                placeholder="—"
                onChange={(ev) => updateEntrant(e.id, { final_placement: ev.target.value ? parseInt(ev.target.value, 10) : null })}
                className="w-16 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs"
              />
              <button onClick={() => removeEntrant(e.id)} className="text-xs text-red-500 hover:text-red-400">×</button>
            </div>
          ))}
          {divisionEntrants.length === 0 && (
            <p className="text-gray-500 text-sm">No entrants in this division yet.</p>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          <select
            value={addPlayerId}
            onChange={(e) => setAddPlayerId(e.target.value)}
            className="flex-1 min-w-48 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
          >
            <option value="">Add a player…</option>
            {seasonPlayerIds.size > 0 && <option disabled>── Season participants ──</option>}
            {availablePlayers.filter((p) => seasonPlayerIds.has(p.id)).map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}{p.chess_com_username ? ` (${p.chess_com_username})` : ''}
              </option>
            ))}
            {seasonPlayerIds.size > 0 && availablePlayers.some((p) => !seasonPlayerIds.has(p.id)) && (
              <option disabled>── Other players ──</option>
            )}
            {availablePlayers.filter((p) => !seasonPlayerIds.has(p.id)).map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}{p.chess_com_username ? ` (${p.chess_com_username})` : ''}
              </option>
            ))}
          </select>
          <input
            placeholder="seed"
            inputMode="numeric"
            value={addSeed}
            onChange={(e) => setAddSeed(e.target.value)}
            className="w-20 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
          />
          <button onClick={addEntrant} className="bg-white text-gray-900 text-sm font-medium px-4 py-1.5 rounded hover:bg-gray-100">
            Add
          </button>
        </div>
      </section>

      {/* Bracket */}
      <section>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-lg font-semibold">Bracket</h2>
          <div className="flex gap-2 items-center flex-wrap">
            <select
              value={activeKind}
              onChange={(e) => setActiveKind(e.target.value as BracketKind)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white"
            >
              {KINDS.map((k) => <option key={k} value={k}>{BRACKET_KIND_LABELS[k]}</option>)}
            </select>
            <button
              onClick={generateBracket}
              className="text-xs bg-gray-800 border border-gray-700 px-3 py-1.5 rounded hover:bg-gray-700"
            >
              Generate from seeds
            </button>
          </div>
        </div>

        <p className="text-xs text-gray-500 mb-3">
          Generating replaces every match in this division and bracket. Enter each match as a race
          score (e.g. 3 – 2), then pick the winner.
        </p>

        {divisionMatches.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => setShowBracketPreview((v) => !v)}
              className="text-xs text-gray-400 hover:text-white mb-2 underline"
            >
              {showBracketPreview ? 'Hide bracket preview' : 'Show bracket preview'}
            </button>
            {showBracketPreview && (
              <div className="border border-gray-800 rounded px-4 pb-4 pt-2 bg-gray-950 overflow-x-auto">
                <TournamentBracket
                  matches={divisionMatches}
                  bracketKind={activeKind}
                  onSlotDrop={dropPlayerIntoSlot}
                />
              </div>
            )}
          </div>
        )}

        <div className="space-y-1">
          {divisionMatches.map((m) => (
            <div key={m.id} className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm flex-wrap">
              <span className="text-gray-600 text-xs w-14 shrink-0">R{m.round}·{m.slot}</span>
              <span className="flex-1 min-w-32 truncate">
                {m.player_a?.display_name ?? <span className="text-gray-700">TBD</span>}
              </span>
              <input
                type="number"
                value={m.score_a ?? ''}
                onChange={(e) => updateMatch(m.id, { score_a: e.target.value ? parseInt(e.target.value, 10) : null })}
                className="w-12 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs"
              />
              <span className="text-gray-600">–</span>
              <input
                type="number"
                value={m.score_b ?? ''}
                onChange={(e) => updateMatch(m.id, { score_b: e.target.value ? parseInt(e.target.value, 10) : null })}
                className="w-12 bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs"
              />
              <span className="flex-1 min-w-32 truncate">
                {m.player_b?.display_name ?? <span className="text-gray-700">TBD</span>}
              </span>
              <select
                value={m.winner_id ?? ''}
                onChange={(e) => updateMatch(m.id, { winner_id: e.target.value || null })}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs"
              >
                <option value="">No winner</option>
                {m.player_a_id && <option value={m.player_a_id}>{m.player_a?.display_name}</option>}
                {m.player_b_id && <option value={m.player_b_id}>{m.player_b?.display_name}</option>}
              </select>
            </div>
          ))}
          {divisionMatches.length === 0 && (
            <p className="text-gray-500 text-sm">
              No matches in this bracket. Add seeded entrants above, then generate.
            </p>
          )}
        </div>
      </section>
    </div>
  )
}
