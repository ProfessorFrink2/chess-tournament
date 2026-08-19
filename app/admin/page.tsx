'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  Player, Season, Match, Bracket, MatchResult, Tournament, TournamentFormat,
} from '@/lib/database.types'
import { useRouter } from 'next/navigation'
import DatePicker from '@/components/DatePicker'
import { FORMAT_LABELS } from '@/lib/tournaments'

type AdminMatch = Match & {
  white_player: Pick<Player, 'display_name'>
  black_player: Pick<Player, 'display_name'>
}

export default function AdminPage() {
  const router = useRouter()
  const [players, setPlayers] = useState<Player[]>([])
  const [seasons, setSeasons] = useState<Season[]>([])
  const [matches, setMatches] = useState<AdminMatch[]>([])
  const [activeSeason, setActiveSeason] = useState<Season | null>(null)
  const [loading, setLoading] = useState(true)
  const [newSeason, setNewSeason] = useState({ name: '', start_date: '' })
  const [status, setStatus] = useState('')
  const [adminUserIds, setAdminUserIds] = useState<Set<string>>(new Set())
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string; input: string } | null>(null)
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [newTournament, setNewTournament] = useState<{
    number: string
    name: string
    format: TournamentFormat
    season_id: string
  }>({ number: '', name: '', format: 'single_elim', season_id: '' })

  useEffect(() => {
    checkAdmin()
    loadData()
  }, [])

  async function checkAdmin() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/'); return }
    const { data } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
    if ((data as { role: string } | null)?.role !== 'admin') { router.push('/'); return }
  }

  async function loadData() {
    setLoading(true)
    const [{ data: ps }, { data: ss }, { data: ts }, adminsRes] = await Promise.all([
      supabase.from('players').select('*').order('display_name'),
      supabase.from('seasons').select('*').order('number', { ascending: true, nullsFirst: false }),
      supabase.from('tournaments').select('*').order('number', { ascending: true }),
      fetch('/api/players/admins').then(r => r.json()),
    ])
    const players = (ps ?? []) as Player[]
    const seasons = (ss ?? []) as Season[]
    setPlayers(players)
    setSeasons(seasons)
    setTournaments((ts ?? []) as Tournament[])
    setAdminUserIds(new Set((adminsRes.adminIds ?? []) as string[]))
    const active = seasons.find((s) => s.is_active) ?? null
    setActiveSeason(active)

    if (active) {
      const { data: ms } = await supabase
        .from('matches')
        .select('*, white_player:players!white_player_id(display_name), black_player:players!black_player_id(display_name)')
        .eq('season_id', active.id)
        .order('week_number')
      setMatches((ms as AdminMatch[]) ?? [])
    }
    setLoading(false)
  }

  async function setBracket(playerId: string, bracket: Bracket | null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('players').update({ bracket } as any).eq('id', playerId)
    setPlayers((prev) => prev.map((p) => p.id === playerId ? { ...p, bracket } : p))
  }

  async function createSeason() {
    if (!newSeason.name || !newSeason.start_date) { setStatus('Name and start date are required'); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: season, error } = await supabase.from('seasons').insert({ ...newSeason, is_hidden: true } as any).select().single()
    if (error) { setStatus('Error: ' + error.message); return }
    setStatus('Season created! Generating schedule…')
    setNewSeason({ name: '', start_date: '' })

    // Auto-generate schedule using the season's start date
    const res = await fetch('/api/schedule/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonId: (season as { id: string }).id }),
    })
    const data = await res.json()
    if (data.error) { setStatus('Season created but schedule failed: ' + data.error); }
    else { setStatus(`Season created! A=${data.created?.A ?? 0} matches, B=${data.created?.B ?? 0} matches scheduled.`) }
    loadData()
  }

  async function deleteSeason(id: string) {
    const { error } = await supabase.from('seasons').delete().eq('id', id)
    if (error) { setStatus('Error: ' + error.message); return }
    setDeleteConfirm(null)
    setStatus('Season deleted.')
    loadData()
  }

  async function startSeason(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('seasons').update({ is_active: false } as any).neq('id', id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('seasons').update({ is_active: true, is_finished: false } as any).eq('id', id)
    setStatus('Season started!')
    loadData()
  }

  async function finishSeason(id: string) {
    if (!confirm('Mark this season as finished? It will become read-only.')) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('seasons').update({ is_active: false, is_finished: true } as any).eq('id', id)
    setStatus('Season finished.')
    loadData()
  }

  async function toggleSeasonHidden(id: string, current: boolean) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('seasons').update({ is_hidden: !current } as any).eq('id', id)
    setStatus(current ? 'Season visible.' : 'Season hidden.')
    loadData()
  }

  async function toggleTournamentHidden(id: string, current: boolean) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('tournaments').update({ is_hidden: !current } as any).eq('id', id)
    setStatus(current ? 'Tournament visible.' : 'Tournament hidden.')
    loadData()
  }

  async function createTournament() {
    const number = parseInt(newTournament.number, 10)
    if (!Number.isFinite(number)) { setStatus('Tournament number is required'); return }
    if (!newTournament.name.trim()) { setStatus('Tournament name is required'); return }

    const { data, error } = await supabase.from('tournaments').insert({
      number,
      name: newTournament.name.trim(),
      format: newTournament.format,
      season_id: newTournament.season_id || null,
      is_hidden: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).select().single()

    if (error) { setStatus('Error: ' + error.message); return }
    setStatus('Tournament created.')
    setNewTournament({ number: '', name: '', format: 'single_elim', season_id: '' })
    router.push(`/admin/tournaments/${(data as { id: string }).id}`)
  }

  async function deleteTournament(id: string) {
    if (!confirm('Delete this tournament and all its brackets, entrants and results?')) return
    const { error } = await supabase.from('tournaments').delete().eq('id', id)
    if (error) { setStatus('Error: ' + error.message); return }
    setStatus('Tournament deleted.')
    loadData()
  }

  async function overrideResult(matchId: string, result: MatchResult) {
    await fetch('/api/matches/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, result }),
    })
    setMatches((prev) => prev.map((m) => m.id === matchId ? { ...m, result } : m))
  }

  async function setRole(targetUserId: string, role: 'admin' | 'user') {
    const res = await fetch('/api/players/set-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId, role }),
    })
    if (!res.ok) { setStatus('Failed to update role'); return }
    setAdminUserIds(prev => {
      const next = new Set(prev)
      if (role === 'admin') next.add(targetUserId)
      else next.delete(targetUserId)
      return next
    })
  }

  async function triggerCronManually() {
    setStatus('Checking chess.com…')
    const res = await fetch('/api/cron/check-results', {
      headers: { authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET ?? ''}` },
    })
    const data = await res.json()
    setStatus(`Checked ${data.checked} matches, updated ${data.updated}`)
  }

  if (loading) return <p className="text-gray-400">Loading…</p>

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold">Admin Panel</h1>
      {status && (
        <div className="bg-gray-800 border border-gray-700 rounded px-4 py-2 text-sm text-amber-300">
          {status}
        </div>
      )}

      {/* Seasons */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Seasons</h2>
        <div className="space-y-2 mb-4">
          {seasons.map((s) => (
            <div key={s.id} className="bg-gray-900 border border-gray-800 rounded px-4 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span>{s.name} <span className="text-gray-500">(starts {s.start_date}{s.end_date ? ` – ${s.end_date}` : ''})</span></span>
                <div className="flex items-center gap-2">
                  {(s as any).is_finished ? (
                    <span className="text-gray-500 text-xs">Finished</span>
                  ) : s.is_active ? (
                    <>
                      <span className="text-green-400 text-xs">Active</span>
                      <button onClick={() => finishSeason(s.id)} className="text-xs text-amber-500 hover:text-amber-400 hover:underline">Finish</button>
                    </>
                  ) : (
                    <button onClick={() => startSeason(s.id)} className="text-xs text-blue-400 hover:underline">Start</button>
                  )}
                  <button onClick={() => toggleSeasonHidden(s.id, !!(s as any).is_hidden)} className={`text-xs hover:underline ml-2 ${(s as any).is_hidden ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-500 hover:text-gray-300'}`}>
                    {(s as any).is_hidden ? 'Hidden' : 'Hide'}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(deleteConfirm?.id === s.id ? null : { id: s.id, name: s.name, input: '' })}
                    className="text-xs text-red-500 hover:text-red-400 hover:underline ml-2"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {deleteConfirm?.id === s.id && (
                <div className="mt-2 flex items-center gap-2 border-t border-gray-800 pt-2">
                  <span className="text-xs text-gray-400">Type <span className="text-white font-mono">{s.name}</span> to confirm:</span>
                  <input
                    autoFocus
                    value={deleteConfirm.input}
                    onChange={(e) => setDeleteConfirm({ ...deleteConfirm, input: e.target.value })}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-red-600"
                    placeholder={s.name}
                  />
                  <button
                    onClick={() => deleteSeason(s.id)}
                    disabled={deleteConfirm.input !== s.name}
                    className="text-xs px-3 py-1 rounded bg-red-700 text-white hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Delete
                  </button>
                  <button onClick={() => setDeleteConfirm(null)} className="text-xs text-gray-500 hover:text-gray-300">Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input placeholder="Season name" value={newSeason.name} onChange={(e) => setNewSeason({ ...newSeason, name: e.target.value })}
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white" />
          <div className="w-44">
            <DatePicker
              value={newSeason.start_date}
              onChange={(v) => setNewSeason({ ...newSeason, start_date: v })}
              placeholder="First week starts"
            />
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-1">Schedule generates automatically — 1 match per week per player until the round-robin is complete.</p>
        <button onClick={createSeason} className="mt-2 bg-white text-gray-900 text-sm font-medium px-4 py-1.5 rounded hover:bg-gray-100">
          Create Season
        </button>
      </section>

      {/* Tournaments */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Tournaments</h2>
        <div className="space-y-2 mb-4">
          {tournaments.map((t) => {
            const season = seasons.find((s) => s.id === t.season_id)
            return (
              <div key={t.id} className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded px-4 py-2 text-sm">
                <span>
                  <span className="text-gray-600 mr-2">#{t.number}</span>
                  {t.name}
                  <span className="text-gray-500 text-xs ml-2">
                    {FORMAT_LABELS[t.format] ?? t.format}
                    {' · '}
                    {season ? season.name : 'no season'}
                  </span>
                </span>
                <div className="flex items-center gap-3">
                  <Link href={`/admin/tournaments/${t.id}`} className="text-xs text-blue-400 hover:underline">
                    Edit
                  </Link>
                  <button onClick={() => toggleTournamentHidden(t.id, !!(t as any).is_hidden)} className={`text-xs hover:underline ${(t as any).is_hidden ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-500 hover:text-gray-300'}`}>
                    {(t as any).is_hidden ? 'Hidden' : 'Hide'}
                  </button>
                  <button onClick={() => deleteTournament(t.id)} className="text-xs text-red-500 hover:text-red-400 hover:underline">
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
          {tournaments.length === 0 && <p className="text-gray-500 text-sm">No tournaments yet.</p>}
        </div>

        <div className="flex gap-2 flex-wrap">
          <input
            placeholder="#"
            inputMode="numeric"
            value={newTournament.number}
            onChange={(e) => setNewTournament({ ...newTournament, number: e.target.value })}
            className="w-16 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
          />
          <input
            placeholder="Tournament name"
            value={newTournament.name}
            onChange={(e) => setNewTournament({ ...newTournament, name: e.target.value })}
            className="flex-1 min-w-40 bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
          />
          <select
            value={newTournament.format}
            onChange={(e) => setNewTournament({ ...newTournament, format: e.target.value as TournamentFormat })}
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
          >
            {Object.entries(FORMAT_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
          <select
            value={newTournament.season_id}
            onChange={(e) => setNewTournament({ ...newTournament, season_id: e.target.value })}
            className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
          >
            <option value="">No season</option>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          A tournament may stand alone — several past tournaments had no league season behind them.
        </p>
        <button onClick={createTournament} className="mt-2 bg-white text-gray-900 text-sm font-medium px-4 py-1.5 rounded hover:bg-gray-100">
          Create Tournament
        </button>
      </section>

      {/* Bracket Assignment */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Player Brackets</h2>
        <div className="space-y-1">
          {players.map((p) => (
            <div key={p.id} className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded px-4 py-2 text-sm">
              <span>{p.display_name} <span className="text-gray-500 text-xs">({p.chess_com_username})</span></span>
              <div className="flex gap-1">
                {(['A', 'B', 'C', 'D', null] as const).map((b) => (
                  <button
                    key={String(b)}
                    onClick={() => setBracket(p.id, b)}
                    className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                      p.bracket === b
                        ? b === 'A' ? 'bg-amber-500 border-amber-500 text-gray-900' : b === 'B' ? 'bg-blue-500 border-blue-500 text-white' : 'bg-gray-600 border-gray-600'
                        : 'border-gray-700 hover:border-gray-500'
                    }`}
                  >
                    {b ?? 'Unassigned'}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Manage Admins */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Manage Admins</h2>
        <div className="space-y-1">
          {players.filter(p => p.user_id).map((p) => {
            const isAdmin = p.user_id ? adminUserIds.has(p.user_id) : false
            return (
              <div key={p.id} className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded px-4 py-2 text-sm">
                <span>
                  {p.display_name}
                  <span className="text-gray-500 text-xs ml-1">({p.chess_com_username})</span>
                  {isAdmin && <span className="ml-2 text-xs text-amber-400 font-medium">Admin</span>}
                </span>
                <button
                  onClick={() => p.user_id && setRole(p.user_id, isAdmin ? 'user' : 'admin')}
                  className={`text-xs px-3 py-1 rounded border transition-colors ${
                    isAdmin
                      ? 'border-red-700 text-red-400 hover:bg-red-900'
                      : 'border-gray-700 text-gray-400 hover:bg-gray-800'
                  }`}
                >
                  {isAdmin ? 'Remove admin' : 'Make admin'}
                </button>
              </div>
            )
          })}
          {players.filter(p => p.user_id).length === 0 && (
            <p className="text-gray-500 text-sm">No registered players yet.</p>
          )}
        </div>
      </section>

      {/* Match Result Override */}
      <section>
        <h2 className="text-lg font-semibold mb-1">Match Results</h2>
        <div className="flex justify-between items-center mb-3">
          <p className="text-sm text-gray-400">Override results or trigger a manual chess.com check.</p>
          <button onClick={triggerCronManually} className="text-xs bg-gray-800 border border-gray-700 px-3 py-1.5 rounded hover:bg-gray-700">
            Check chess.com now
          </button>
        </div>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {matches.map((m) => (
            <div key={m.id} className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded px-4 py-2 text-sm">
              <span className="text-gray-300">
                <span className="text-gray-600 mr-2">{m.bracket} W{m.week_number}</span>
                {m.white_player.display_name} vs {m.black_player.display_name}
              </span>
              <select
                value={m.result}
                onChange={(e) => overrideResult(m.id, e.target.value as MatchResult)}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-xs"
              >
                <option value="pending">Pending</option>
                <option value="white_wins">White wins</option>
                <option value="black_wins">Black wins</option>
                <option value="draw">Draw</option>
              </select>
            </div>
          ))}
          {matches.length === 0 && <p className="text-gray-500 text-sm">No matches yet. Generate a schedule first.</p>}
        </div>
      </section>
    </div>
  )
}
