'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import StatCard from '@/components/StatCard'
import type { Season } from '@/lib/database.types'

interface MatchRow {
  white_player_id: string
  black_player_id: string
  result: string
  season_id: string
  bracket: string | null
}

interface PlayerRow {
  id: string
  display_name: string
  user_id: string | null
  is_historic: boolean
}

interface TMatchRow {
  winner_id: string | null
  player_a_id: string | null
  player_b_id: string | null
}

interface ProfileRow {
  id: string
  email: string
  created_at: string
}

interface SeasonStat {
  name: string
  total: number
  whiteWins: number
  blackWins: number
  draws: number
}

interface PlayerStat {
  display_name: string
  games: number
  wins: number
  winRate: number
}

function pct(n: number, d: number) {
  return d === 0 ? '—' : `${Math.round((n / d) * 100)}%`
}

function isRealSignup(email: string) {
  return !email.endsWith('@chess.local')
}

function groupByMonth(profiles: ProfileRow[]) {
  const real = profiles.filter((p) => isRealSignup(p.email))
  const now = new Date()
  const buckets: { label: string; value: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleString('default', { month: 'short', year: '2-digit' })
    const count = real.filter((p) => p.created_at.startsWith(key)).length
    buckets.push({ label, value: count })
  }
  return buckets
}

export default function StatsPage() {
  const [loading, setLoading] = useState(true)
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [seasons, setSeasons] = useState<Season[]>([])
  const [tMatches, setTMatches] = useState<TMatchRow[]>([])
  const [profiles, setProfiles] = useState<ProfileRow[]>([])

  useEffect(() => {
    async function load() {
      const [{ data: m }, { data: p }, { data: s }, { data: tm }, { data: pr }] = await Promise.all([
        supabase.from('matches').select('white_player_id, black_player_id, result, season_id, bracket'),
        supabase.from('players').select('id, display_name, user_id, is_historic'),
        supabase.from('seasons').select('*').order('number', { ascending: true, nullsFirst: false }),
        supabase.from('tournament_matches').select('winner_id, player_a_id, player_b_id'),
        supabase.from('profiles').select('id, email, created_at').order('created_at'),
      ])

      setMatches((m ?? []) as MatchRow[])
      setPlayers((p ?? []) as PlayerRow[])
      setSeasons((s ?? []) as Season[])
      setTMatches((tm ?? []) as TMatchRow[])
      setProfiles((pr ?? []) as ProfileRow[])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>

  // ── Match outcome aggregates ──────────────────────────────────────────────
  const completed = matches.filter((m) => m.result !== 'pending')
  const pending = matches.filter((m) => m.result === 'pending')
  const whiteWins = completed.filter((m) => m.result === 'white_wins')
  const blackWins = completed.filter((m) => m.result === 'black_wins')
  const draws = completed.filter((m) => m.result === 'draw')

  // ── Per-season stats ──────────────────────────────────────────────────────
  const seasonMap = new Map<string, Season>(seasons.map((s) => [s.id, s]))
  const seasonStats: SeasonStat[] = seasons.map((s) => {
    const sm = completed.filter((m) => m.season_id === s.id)
    return {
      name: s.name,
      total: sm.length,
      whiteWins: sm.filter((m) => m.result === 'white_wins').length,
      blackWins: sm.filter((m) => m.result === 'black_wins').length,
      draws: sm.filter((m) => m.result === 'draw').length,
    }
  }).filter((s) => s.total > 0)

  const gamesBySeason = seasonStats.map((s) => ({ label: s.name, value: s.total }))
  const whiteWinRateBySeason = seasonStats.map((s) => ({
    label: s.name,
    value: s.total === 0 ? 0 : Math.round((s.whiteWins / s.total) * 100),
  }))
  const drawRateBySeason = seasonStats.map((s) => ({
    label: s.name,
    value: s.total === 0 ? 0 : Math.round((s.draws / s.total) * 100),
  }))

  // ── Player activity ───────────────────────────────────────────────────────
  const gamesPerPlayer = new Map<string, number>()
  const whiteGamesPerPlayer = new Map<string, number>()
  const blackGamesPerPlayer = new Map<string, number>()
  const whiteWinsPerPlayer = new Map<string, number>()
  const blackWinsPerPlayer = new Map<string, number>()

  for (const m of completed) {
    gamesPerPlayer.set(m.white_player_id, (gamesPerPlayer.get(m.white_player_id) ?? 0) + 1)
    gamesPerPlayer.set(m.black_player_id, (gamesPerPlayer.get(m.black_player_id) ?? 0) + 1)
    whiteGamesPerPlayer.set(m.white_player_id, (whiteGamesPerPlayer.get(m.white_player_id) ?? 0) + 1)
    blackGamesPerPlayer.set(m.black_player_id, (blackGamesPerPlayer.get(m.black_player_id) ?? 0) + 1)
    if (m.result === 'white_wins') {
      whiteWinsPerPlayer.set(m.white_player_id, (whiteWinsPerPlayer.get(m.white_player_id) ?? 0) + 1)
    }
    if (m.result === 'black_wins') {
      blackWinsPerPlayer.set(m.black_player_id, (blackWinsPerPlayer.get(m.black_player_id) ?? 0) + 1)
    }
  }

  const playerNameMap = new Map<string, string>(players.map((p) => [p.id, p.display_name]))

  const top10 = [...gamesPerPlayer.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, games]) => ({ name: playerNameMap.get(id) ?? id, games }))

  // Best white-side and black-side win rates (min 5 games)
  const MIN_GAMES = 5
  const bestWhite = [...whiteGamesPerPlayer.entries()]
    .filter(([, g]) => g >= MIN_GAMES)
    .map(([id, g]) => ({ name: playerNameMap.get(id) ?? id, games: g, wins: whiteWinsPerPlayer.get(id) ?? 0 }))
    .sort((a, b) => b.wins / b.games - a.wins / a.games)
    .slice(0, 3)

  const bestBlack = [...blackGamesPerPlayer.entries()]
    .filter(([, g]) => g >= MIN_GAMES)
    .map(([id, g]) => ({ name: playerNameMap.get(id) ?? id, games: g, wins: blackWinsPerPlayer.get(id) ?? 0 }))
    .sort((a, b) => b.wins / b.games - a.wins / a.games)
    .slice(0, 3)

  // Unique players per season
  const uniquePerSeason = seasons.map((s) => {
    const ids = new Set<string>()
    matches.filter((m) => m.season_id === s.id).forEach((m) => { ids.add(m.white_player_id); ids.add(m.black_player_id) })
    return { label: s.name, value: ids.size }
  }).filter((x) => x.value > 0)

  // ── Player signup stats ───────────────────────────────────────────────────
  // "Real signups" = profiles with a real email (not admin-seeded @chess.local placeholders),
  // plus players who claimed their account via a real email (the claim flow).
  const profileById = new Map<string, ProfileRow>(profiles.map((p) => [p.id, p]))
  const realProfiles = profiles.filter((p) => isRealSignup(p.email))

  const totalPlayers = players.length
  const historic = players.filter((p) => p.is_historic).length
  const unclaimed = players.filter((p) => p.user_id === null && !p.is_historic).length

  // Claimed via real email = player has a user_id pointing to a real (non-seeded) profile
  const realSignupPlayers = players.filter((p) => {
    if (!p.user_id) return false
    const profile = profileById.get(p.user_id)
    return profile ? isRealSignup(profile.email) : false
  })

  const realSignupCount = realProfiles.length
  const signupsByMonth = groupByMonth(profiles)

  // ── Tournament stats ──────────────────────────────────────────────────────
  const tWinsPerPlayer = new Map<string, number>()
  for (const tm of tMatches) {
    if (tm.winner_id) tWinsPerPlayer.set(tm.winner_id, (tWinsPerPlayer.get(tm.winner_id) ?? 0) + 1)
  }
  const topTournamentPlayers = [...tWinsPerPlayer.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, wins]) => ({ name: playerNameMap.get(id) ?? id, wins }))

  // Most draws in a single season bracket
  const drawsBySeasonBracket = new Map<string, number>()
  for (const m of completed.filter((m) => m.result === 'draw')) {
    const key = `${m.season_id}:${m.bracket ?? ''}`
    drawsBySeasonBracket.set(key, (drawsBySeasonBracket.get(key) ?? 0) + 1)
  }
  const maxDrawEntry = [...drawsBySeasonBracket.entries()].sort((a, b) => b[1] - a[1])[0]
  const maxDrawSeasonName = maxDrawEntry
    ? seasonMap.get(maxDrawEntry[0].split(':')[0])?.name ?? '—'
    : '—'
  const maxDrawBracket = maxDrawEntry ? maxDrawEntry[0].split(':')[1] : ''
  const maxDrawCount = maxDrawEntry ? maxDrawEntry[1] : 0

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Stats</h1>
        <button
          onClick={() => window.location.reload()}
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          Refresh ↺
        </button>
      </div>

      {/* Players & Signups */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Players & Signups</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <StatCard title="Signed up" value={realSignupCount} subtitle="Real accounts (excl. seeded)" />
          <StatCard title="Claimed players" value={realSignupPlayers.length} subtitle="Players linked to a real account" />
          <StatCard title="Total players" value={totalPlayers} subtitle="Including seeded & historic" />
          <StatCard title="Unclaimed" value={unclaimed} subtitle="Current player, no account yet" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <StatCard
            title="Signups (last 12 months)"
            value={realSignupCount}
            subtitle="Real accounts, excl. admin-seeded"
            bars={signupsByMonth}
          />
          <StatCard
            title="Active players per season"
            value={uniquePerSeason.length > 0 ? Math.max(...uniquePerSeason.map((x) => x.value)) : 0}
            subtitle="Peak unique players in one season"
            bars={uniquePerSeason}
          />
        </div>
      </section>

      {/* Match outcomes */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Match Outcomes (all time)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <StatCard title="Total matches" value={completed.length} />
          <StatCard title="Pending" value={pending.length} subtitle="Not yet played" />
          <StatCard title="White wins" value={whiteWins.length} subtitle={pct(whiteWins.length, completed.length)} />
          <StatCard title="Black wins" value={blackWins.length} subtitle={pct(blackWins.length, completed.length)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard title="Draws" value={draws.length} subtitle={pct(draws.length, completed.length)} />
          <StatCard
            title="White win % per season"
            value={pct(whiteWins.length, completed.length)}
            bars={whiteWinRateBySeason}
          />
          <StatCard
            title="Draw % per season"
            value={pct(draws.length, completed.length)}
            bars={drawRateBySeason}
          />
        </div>
        <div className="mt-3">
          <StatCard
            title="Games per season"
            value={completed.length}
            subtitle="All completed matches"
            bars={gamesBySeason}
          />
        </div>
      </section>

      {/* Per-season table */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Per-Season Breakdown</h2>
        <div className="bg-gray-800 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left px-4 py-2">Season</th>
                <th className="text-right px-4 py-2">Matches</th>
                <th className="text-right px-4 py-2">White wins</th>
                <th className="text-right px-4 py-2">Black wins</th>
                <th className="text-right px-4 py-2">Draws</th>
              </tr>
            </thead>
            <tbody>
              {seasonStats.map((s, i) => (
                <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="px-4 py-2 text-white">{s.name}</td>
                  <td className="px-4 py-2 text-right text-gray-300">{s.total}</td>
                  <td className="px-4 py-2 text-right text-gray-300">{pct(s.whiteWins, s.total)}</td>
                  <td className="px-4 py-2 text-right text-gray-300">{pct(s.blackWins, s.total)}</td>
                  <td className="px-4 py-2 text-right text-gray-300">{pct(s.draws, s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Most active players */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Most Active Players</h2>
        <div className="bg-gray-800 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left px-4 py-2">#</th>
                <th className="text-left px-4 py-2">Player</th>
                <th className="text-right px-4 py-2">Games</th>
              </tr>
            </thead>
            <tbody>
              {top10.map((p, i) => (
                <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                  <td className="px-4 py-2 text-gray-500">{i + 1}</td>
                  <td className="px-4 py-2 text-white">{p.name}</td>
                  <td className="px-4 py-2 text-right text-gray-300">{p.games}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Fun stats */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Fun Stats</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Best white-side win rate */}
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Best White-Side Win Rate (min {MIN_GAMES} games)</p>
            {bestWhite.length === 0 ? (
              <p className="text-gray-500 text-sm">Not enough data</p>
            ) : (
              <ol className="space-y-1">
                {bestWhite.map((p, i) => (
                  <li key={i} className="flex justify-between text-sm">
                    <span className="text-white">{i + 1}. {p.name}</span>
                    <span className="text-gray-400">{p.wins}/{p.games} ({pct(p.wins, p.games)})</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Best black-side win rate */}
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Best Black-Side Win Rate (min {MIN_GAMES} games)</p>
            {bestBlack.length === 0 ? (
              <p className="text-gray-500 text-sm">Not enough data</p>
            ) : (
              <ol className="space-y-1">
                {bestBlack.map((p, i) => (
                  <li key={i} className="flex justify-between text-sm">
                    <span className="text-white">{i + 1}. {p.name}</span>
                    <span className="text-gray-400">{p.wins}/{p.games} ({pct(p.wins, p.games)})</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Most draws in one season bracket */}
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Most Draws — Single Season/Bracket</p>
            {maxDrawCount === 0 ? (
              <p className="text-gray-500 text-sm">No draws recorded</p>
            ) : (
              <>
                <p className="text-3xl font-bold text-white">{maxDrawCount}</p>
                <p className="text-xs text-gray-500 mt-1">{maxDrawSeasonName}{maxDrawBracket ? ` · Division ${maxDrawBracket}` : ''}</p>
              </>
            )}
          </div>

          {/* Tournament match wins */}
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Top Tournament Match Wins</p>
            {topTournamentPlayers.length === 0 ? (
              <p className="text-gray-500 text-sm">No tournament data</p>
            ) : (
              <ol className="space-y-1">
                {topTournamentPlayers.map((p, i) => (
                  <li key={i} className="flex justify-between text-sm">
                    <span className="text-white">{i + 1}. {p.name}</span>
                    <span className="text-gray-400">{p.wins} wins</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
