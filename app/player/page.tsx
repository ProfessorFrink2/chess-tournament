'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Player, MatchWithPlayers, TournamentMatchWithPlayers, Tournament } from '@/lib/database.types'
import Link from 'next/link'

interface ChessComGame {
  url: string
  time_class: string
  end_time: number
  white: { username: string; rating: number; result: string }
  black: { username: string; rating: number; result: string }
  pgn?: string
}

const resultLabel: Record<string, string> = {
  white_wins: 'White wins',
  black_wins: 'Black wins',
  draw: 'Draw',
  pending: 'Pending',
}

function outcomeFor(match: MatchWithPlayers, playerId: string): 'win' | 'loss' | 'draw' | 'pending' {
  if (match.result === 'pending') return 'pending'
  if (match.result === 'draw') return 'draw'
  const isWhite = match.white_player_id === playerId
  if (match.result === 'white_wins') return isWhite ? 'win' : 'loss'
  return isWhite ? 'loss' : 'win'
}

const outcomeColor = {
  win: 'text-green-400',
  loss: 'text-red-400',
  draw: 'text-gray-400',
  pending: 'text-gray-500',
}

export default function PlayerPage() {
  const router = useRouter()
  const [player, setPlayer] = useState<Player | null>(null)
  const [allMatches, setAllMatches] = useState<MatchWithPlayers[]>([])
  const [tournamentMatches, setTournamentMatches] = useState<(TournamentMatchWithPlayers & { tournament: Pick<Tournament, 'id' | 'name' | 'number'> | null })[]>([])
  const [chessGames, setChessGames] = useState<ChessComGame[]>([])
  const [usernameToName, setUsernameToName] = useState<Record<string, string>>({})
  const [chessLoading, setChessLoading] = useState(false)
  const [showCount, setShowCount] = useState(20)
  const [loading, setLoading] = useState(true)
  const [reporting, setReporting] = useState<string | null>(null)
  const [gameUrl, setGameUrl] = useState('')
  const [reportWarning, setReportWarning] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/auth/login'); return }

    const { data: playerData } = await supabase
      .from('players')
      .select('*')
      .eq('user_id', session.user.id)
      .single()

    if (!playerData) { router.push('/auth/signup'); return }
    const p = playerData as Player
    setPlayer(p)

    // Build username → display name map for chess.com history
    const { data: allPlayers } = await supabase.from('players').select('chess_com_username, display_name')
    if (allPlayers) {
      const map: Record<string, string> = {}
      for (const ap of allPlayers as Pick<Player, 'chess_com_username' | 'display_name'>[]) {
        // Historic players have no chess.com account — nothing to map.
        if (!ap.chess_com_username) continue
        map[ap.chess_com_username.toLowerCase()] = ap.display_name
      }
      setUsernameToName(map)
    }

    const [{ data: matches }, { data: tMatches }] = await Promise.all([
      supabase
        .from('matches')
        .select(`*, white_player:players!white_player_id(id, display_name, chess_com_username), black_player:players!black_player_id(id, display_name, chess_com_username)`)
        .or(`white_player_id.eq.${p.id},black_player_id.eq.${p.id}`)
        .order('scheduled_start', { ascending: true }),
      supabase
        .from('tournament_matches')
        .select(`*, player_a:players!player_a_id(id, display_name, chess_com_username), player_b:players!player_b_id(id, display_name, chess_com_username), tournament:tournaments(id, name, number)`)
        .or(`player_a_id.eq.${p.id},player_b_id.eq.${p.id}`)
        .order('round', { ascending: true }),
    ])

    setAllMatches((matches ?? []) as MatchWithPlayers[])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setTournamentMatches((tMatches ?? []) as any)
    setLoading(false)

    // Fetch chess.com game history in background
    if (!p.chess_com_username) return
    setChessLoading(true)
    fetch(`/api/chess-com/games?username=${encodeURIComponent(p.chess_com_username)}&limit=200`)
      .then(r => r.json())
      .then(({ games }) => setChessGames(games ?? []))
      .finally(() => setChessLoading(false))
  }

  async function submitReport(matchId: string, force = false, manualResult?: string) {
    if (!manualResult && !gameUrl.trim()) { setReportWarning('Please paste a chess.com game URL or select a result manually.'); return }
    setSubmitting(true)
    setReportWarning('')
    const res = await fetch('/api/matches/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manualResult
        ? { matchId, manualResult }
        : { matchId, gameUrl: gameUrl.trim(), force }
      ),
    })
    const data = await res.json()
    setSubmitting(false)

    if (res.status === 409 && data.requiresForce) {
      setReportWarning(data.warning)
      return
    }
    if (!res.ok) { setReportWarning(data.error ?? 'Failed to submit result.'); return }

    setReporting(null)
    setGameUrl('')
    setReportWarning('')
    setStatus(`Result submitted: ${data.result?.replace('_', ' ')}`)
    loadData()
  }

  if (loading) return <p className="text-gray-400">Loading…</p>
  if (!player) return null

  const opponent = (match: MatchWithPlayers) =>
    match.white_player_id === player.id ? match.black_player : match.white_player

  const colorFor = (match: MatchWithPlayers) =>
    match.white_player_id === player.id ? 'White' : 'Black'

  // Find chess.com games already played against a given opponent username
  function foundGamesFor(oppUsername: string | null): ChessComGame[] {
    if (!oppUsername) return []
    const opp = oppUsername.toLowerCase()
    return chessGames.filter(g =>
      g.white.username.toLowerCase() === opp || g.black.username.toLowerCase() === opp
    )
  }

  function gameOutcomeLabel(g: ChessComGame): string {
    const isWhite = g.white.username.toLowerCase() === player!.chess_com_username?.toLowerCase()
    const me = isWhite ? g.white : g.black
    if (me.result === 'win') return 'You won'
    if ((isWhite ? g.black : g.white).result === 'win') return 'You lost'
    return 'Draw'
  }

  const reportedUrls = new Set(
    allMatches.map(m => m.chess_com_game_url).filter(Boolean).map(u => u!.split('?')[0].replace(/\/$/, ''))
  )

  return (
    <div className="max-w-2xl mx-auto space-y-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{player.display_name}</h1>
          {player.chess_com_username && <a
            href={`https://chess.com/member/${player.chess_com_username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gray-400 hover:text-white"
          >
            @{player.chess_com_username} ↗
          </a>}
          <div>
            <Link href="/player/stats" className="text-sm text-blue-400 hover:underline">
              My Stats →
            </Link>
          </div>
        </div>
        <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${
          player.bracket === 'A'
            ? 'border-amber-500 text-amber-400'
            : player.bracket === 'B'
            ? 'border-blue-500 text-blue-400'
            : 'border-gray-700 text-gray-500'
        }`}>
          {player.bracket ? `${player.bracket} Bracket` : 'Unassigned'}
        </span>
      </div>

      {status && (
        <div className="bg-gray-800 border border-gray-700 rounded px-4 py-2 text-sm text-amber-300">
          {status}
        </div>
      )}

      {/* All matches */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Season Matches</h2>
        {allMatches.length === 0 ? (
          <p className="text-gray-500 text-sm">No matches scheduled yet.</p>
        ) : (
          <div className="space-y-2">
            {allMatches.map(m => {
              const opp = opponent(m)
              const color = colorFor(m)
              const outcome = outcomeFor(m, player.id)
              const isPending = m.result === 'pending'
              const isReporting = reporting === m.id
              const foundGames = isPending ? foundGamesFor(opp.chess_com_username) : []
              const hasFound = foundGames.length > 0

              const today = new Date().toISOString().split('T')[0]
              const isCurrentWeek = m.scheduled_start <= today && m.scheduled_end >= today
              const isPast = m.scheduled_end < today
              const dateColor = isPending && isCurrentWeek ? 'text-green-700' : isPending && isPast ? 'text-red-800' : 'text-gray-600'

              return (
                <div key={m.id} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{player.display_name}</span>
                        {!isPending && <span className="text-xs text-gray-500">({color})</span>}
                        {!isPending && (
                          <span className={`font-semibold text-sm uppercase tracking-wide ${outcomeColor[outcome]}`}>
                            {outcome}
                          </span>
                        )}
                        <span className="text-gray-500">vs</span>
                        <span className="font-medium">{opp.display_name}</span>
                        {!isPending && <span className="text-xs text-gray-500">({color === 'White' ? 'Black' : 'White'})</span>}
                        {opp.chess_com_username && <a
                          href={`https://chess.com/member/${opp.chess_com_username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-gray-500 hover:text-gray-300"
                        >
                          @{opp.chess_com_username} ↗
                        </a>}
                      </div>
                      <div className={`text-xs mt-0.5 ${dateColor}`}>
                        {m.week_number === 0 ? 'Play by season end' : `Week ${m.week_number}`}{m.week_number !== 0 && ` · ${m.scheduled_start} – ${m.scheduled_end}`}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!isPending && m.chess_com_game_url && (
                        <a
                          href={m.chess_com_game_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:underline"
                        >
                          View game ↗
                        </a>
                      )}
                      {!isPending && (
                        <button
                          onClick={async () => {
                            await fetch('/api/matches/override', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ matchId: m.id, result: 'pending' }),
                            })
                            loadData()
                          }}
                          className="text-xs text-gray-500 hover:text-red-400 hover:underline"
                        >
                          Clear result
                        </button>
                      )}
                      {isPending && (
                        <button
                          onClick={() => {
                            if (isReporting) { setReporting(null); setGameUrl(''); setReportWarning('') }
                            else { setReporting(m.id); setGameUrl(''); setReportWarning('') }
                          }}
                          className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                            hasFound && !isReporting
                              ? 'bg-green-900 border-green-700 text-green-300 hover:bg-green-800'
                              : 'bg-gray-800 border-gray-700 hover:bg-gray-700'
                          }`}
                        >
                          {isReporting ? 'Cancel' : hasFound ? `chess.com result found (${foundGames.length})` : 'Report result'}
                        </button>
                      )}
                    </div>
                  </div>

                  {isReporting && (
                    <div className="mt-3 border-t border-gray-800 pt-3 space-y-2">
                      {hasFound && (
                        <div className="space-y-1 mb-1">
                          {foundGames.map((g, i) => {
                            const date = new Date(g.end_time * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                            const label = gameOutcomeLabel(g)
                            const labelColor = label === 'You won' ? 'text-green-400' : label === 'You lost' ? 'text-red-400' : 'text-gray-400'
                            return (
                              <div key={i} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                  <span className={`font-semibold ${labelColor}`}>{label}</span>
                                  <span className="text-gray-500 capitalize">{g.time_class} · {date}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <a href={g.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">View ↗</a>
                                  <button
                                    onClick={() => { setGameUrl(g.url); setReportWarning('') }}
                                    className="text-amber-400 hover:text-amber-300 hover:underline"
                                  >
                                    Use this
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                          <div className="border-t border-gray-800 pt-2" />
                        </div>
                      )}
                      <p className="text-xs text-gray-400">
                        Paste the chess.com game URL — the result will be read automatically.
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="url"
                          value={gameUrl}
                          onChange={e => { setGameUrl(e.target.value); setReportWarning('') }}
                          placeholder="https://www.chess.com/game/live/..."
                          className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
                        />
                        <button
                          onClick={() => submitReport(m.id)}
                          disabled={submitting}
                          className="bg-white text-gray-900 text-sm font-medium px-4 py-1.5 rounded hover:bg-gray-100 disabled:opacity-50 shrink-0"
                        >
                          {submitting ? 'Checking…' : 'Submit'}
                        </button>
                      </div>
                      <div className="border-t border-gray-800 pt-2">
                        <p className="text-xs text-gray-500 mb-1.5">Or report manually (in-person / game not found):</p>
                        <div className="flex gap-2">
                          {([
                            { label: 'I won', result: m.white_player_id === player.id ? 'white_wins' : 'black_wins' },
                            { label: 'I lost', result: m.white_player_id === player.id ? 'black_wins' : 'white_wins' },
                            { label: 'Draw', result: 'draw' },
                          ] as const).map(({ label, result }) => (
                            <button
                              key={result}
                              onClick={() => submitReport(m.id, false, result)}
                              disabled={submitting}
                              className="text-xs px-3 py-1.5 rounded border border-gray-700 bg-gray-800 hover:bg-gray-700 disabled:opacity-50"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {reportWarning && (
                        <div className="bg-amber-950 border border-amber-700 rounded px-3 py-2 text-sm text-amber-300 flex items-start justify-between gap-3">
                          <span>{reportWarning}</span>
                          <button
                            onClick={() => submitReport(m.id, true)}
                            className="text-xs underline shrink-0 hover:text-amber-100"
                          >
                            Use anyway
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Tournament matches */}
      {tournamentMatches.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Tournament Matches</h2>
          <div className="space-y-2">
            {tournamentMatches.map((m) => {
              const isA = m.player_a_id === player.id
              const me = isA ? m.player_a : m.player_b
              const opp = isA ? m.player_b : m.player_a
              const myScore = isA ? m.score_a : m.score_b
              const oppScore = isA ? m.score_b : m.score_a
              const decided = m.winner_id != null
              const iWon = decided && m.winner_id === player.id
              const iLost = decided && m.winner_id !== player.id

              return (
                <div key={m.id} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                          {m.tournament?.name ?? 'Tournament'}
                          {m.division ? ` · Div ${m.division}` : ''}
                          {' · '}R{m.round}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        <span className="font-medium">{me?.display_name ?? player.display_name}</span>
                        {decided && (
                          <span className={`font-semibold text-sm uppercase tracking-wide ${iWon ? 'text-green-400' : iLost ? 'text-red-400' : 'text-gray-400'}`}>
                            {iWon ? 'WIN' : iLost ? 'LOSS' : 'DRAW'}
                          </span>
                        )}
                        <span className="text-gray-500">vs</span>
                        <span className="font-medium">{opp?.display_name ?? 'TBD'}</span>
                        {decided && myScore != null && oppScore != null && (
                          <span className="text-xs text-gray-500">{myScore} – {oppScore}</span>
                        )}
                        {!decided && <span className="text-xs text-gray-600 italic">Pending</span>}
                      </div>
                    </div>
                    <Link
                      href={`/tournaments/${m.tournament_id}${m.division ? `?division=${encodeURIComponent(m.division)}` : ''}`}
                      className="text-xs text-blue-400 hover:underline shrink-0"
                    >
                      View bracket ↗
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Chess.com game history */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Chess.com History</h2>
          {chessLoading && <span className="text-xs text-gray-500 animate-pulse">Fetching games…</span>}
          {!chessLoading && chessGames.length > 0 && (
            <span className="text-xs text-gray-500">{chessGames.length} games</span>
          )}
        </div>

        {!chessLoading && chessGames.length === 0 ? (
          <p className="text-gray-500 text-sm">No games found on chess.com.</p>
        ) : (
          <>
            <div className="space-y-1">
              {chessGames.slice(0, showCount).map((g, i) => {
                const isWhite = g.white.username.toLowerCase() === player.chess_com_username?.toLowerCase()
                const me = isWhite ? g.white : g.black
                const opp = isWhite ? g.black : g.white
                const date = new Date(g.end_time * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

                let outcome: 'win' | 'loss' | 'draw'
                if (me.result === 'win') outcome = 'win'
                else if (opp.result === 'win') outcome = 'loss'
                else outcome = 'draw'
                const gameUrlNorm = g.url.split('?')[0].replace(/\/$/, '')
                const isReported = reportedUrls.has(gameUrlNorm)

                return (
                  <div key={i} className={`flex items-center justify-between bg-gray-900 border rounded-lg px-4 py-2.5 text-sm ${isReported ? 'border-gray-700 opacity-50' : 'border-gray-800'}`}>
                    <div className="flex items-center gap-3">
                      <span className={`font-semibold text-xs uppercase w-8 ${outcomeColor[outcome]}`}>
                        {outcome}
                      </span>
                      <span className="text-gray-300">
                        vs {usernameToName[opp.username.toLowerCase()] ?? opp.username}
                        {usernameToName[opp.username.toLowerCase()] && (
                          <span className="text-gray-600 text-xs ml-1">({opp.username})</span>
                        )}
                      </span>
                      <span className="text-xs text-gray-600">{isWhite ? 'White' : 'Black'}</span>
                      <span className="text-xs text-gray-600 capitalize">{g.time_class}</span>
                      {isReported && <span className="text-xs text-gray-500 italic">reported</span>}
                    </div>
                    <div className="flex items-center gap-3 text-right">
                      <span className="text-xs text-gray-500">{date}</span>
                      <a
                        href={g.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:underline"
                      >
                        View ↗
                      </a>
                    </div>
                  </div>
                )
              })}
            </div>

            {chessGames.length > showCount && (
              <button
                onClick={() => setShowCount(c => c + 50)}
                className="mt-3 w-full text-sm text-gray-400 hover:text-white border border-gray-800 rounded-lg py-2 hover:border-gray-600 transition-colors"
              >
                Show more ({chessGames.length - showCount} remaining)
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
