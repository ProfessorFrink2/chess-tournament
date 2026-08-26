'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MatchWithPlayersAndGame as Match } from '@/lib/database.types'

interface ChessComGame {
  url: string
  time_class: string
  end_time: number
  white: { username: string; result: string }
  black: { username: string; result: string }
}

const resultColor: Record<string, string> = {
  white_wins: 'text-white',
  black_wins: 'text-white',
  draw: 'text-white',
  pending: 'text-gray-500',
}

function resultLabel(m: Match): string {
  if (m.result === 'white_wins') return `${m.white_player.display_name} (white) wins`
  if (m.result === 'black_wins') return `${m.black_player.display_name} (black) wins`
  if (m.result === 'draw') return 'Draw'
  return 'Pending'
}

function dateColor(m: Match): string {
  if (m.result !== 'pending') return 'text-gray-600'
  const today = new Date().toISOString().split('T')[0]
  if (m.scheduled_start <= today && m.scheduled_end >= today) return 'text-green-700'
  if (today < m.scheduled_start) return 'text-gray-600'
  // Grace period: stay green for a week past scheduled_end before turning red.
  const graceEnd = new Date(m.scheduled_end)
  graceEnd.setDate(graceEnd.getDate() + 7)
  const graceEndStr = graceEnd.toISOString().split('T')[0]
  return today <= graceEndStr ? 'text-green-700' : 'text-red-800'
}

/** "600+2" -> "10+2" for display (base seconds -> minutes, keep increment). */
function formatTimeControl(tc: string | null): string | null {
  if (!tc) return null
  const m = tc.match(/^(\d+)(?:\+(\d+))?$/)
  if (!m) return tc
  const minutes = Math.round(Number(m[1]) / 60)
  return m[2] ? `${minutes}+${m[2]}` : `${minutes} min`
}

function formatBadge(game: Match['games'][number] | null): string | null {
  if (!game) return null
  if (game.rules === 'chess960') return '960'
  return formatTimeControl(game.time_control)
}

export default function MatchList({ matches: initialMatches }: { matches: Match[] }) {
  const [matches, setMatches] = useState(initialMatches)
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null)
  const [myChessUsername, setMyChessUsername] = useState<string | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [chessGames, setChessGames] = useState<ChessComGame[]>([])
  const [reporting, setReporting] = useState<string | null>(null)
  const [gameUrl, setGameUrl] = useState('')
  const [warning, setWarning] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      setAccessToken(session.access_token)
      const { data } = await supabase
        .from('players')
        .select('id, chess_com_username')
        .eq('user_id', session.user.id)
        .single()
      if (!data) return
      const p = data as { id: string; chess_com_username: string }
      setMyPlayerId(p.id)
      setMyChessUsername(p.chess_com_username)
      fetch(`/api/chess-com/games?username=${encodeURIComponent(p.chess_com_username)}&limit=200`)
        .then(r => r.json())
        .then(({ games }) => setChessGames(games ?? []))
    })
  }, [])

  function foundGamesVs(oppUsername: string): ChessComGame[] {
    if (!myChessUsername) return []
    const opp = oppUsername.toLowerCase()
    return chessGames.filter(g =>
      g.white.username.toLowerCase() === opp || g.black.username.toLowerCase() === opp
    )
  }

  function gameOutcomeLabel(g: ChessComGame): string {
    if (!myChessUsername) return ''
    const isWhite = g.white.username.toLowerCase() === myChessUsername.toLowerCase()
    const me = isWhite ? g.white : g.black
    if (me.result === 'win') return 'You won'
    if ((isWhite ? g.black : g.white).result === 'win') return 'You lost'
    return 'Draw'
  }

  async function submitReport(matchId: string, force = false, manualResult?: string) {
    if (!manualResult && !gameUrl.trim()) { setWarning('Please paste a chess.com game URL or select a result manually.'); return }
    setSubmitting(true)
    setWarning('')
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
    if (res.status === 409 && data.requiresForce) { setWarning(data.warning); return }
    if (!res.ok) { setWarning(data.error ?? 'Failed to submit.'); return }
    setReporting(null)
    setGameUrl('')
    setWarning('')
    setMatches(prev => prev.map(m => m.id === matchId ? { ...m, result: data.result, chess_com_game_url: manualResult ? null : gameUrl.trim() } : m))
  }

  async function toggleStar(matchId: string) {
    if (!accessToken) return
    const res = await fetch('/api/matches/star', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ matchId }),
    })
    const data = await res.json()
    if (!res.ok) return
    setMatches(prev => prev.map(m =>
      m.id === matchId ? { ...m, games: m.games.map(g => ({ ...g, starred: data.starred })) } : m
    ))
  }

  const byWeek = matches.reduce<Record<number, Match[]>>((acc, m) => {
    if (!acc[m.week_number]) acc[m.week_number] = []
    acc[m.week_number].push(m)
    return acc
  }, {})

  const weeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b)

  return (
    <div className="space-y-6">
      {weeks.map((week) => (
        <div key={week}>
          <h3 id={`week-${week}`} className="scroll-mt-4 text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            {week === 0 ? 'Play by season end' : `Week ${week}`}
            <a
              href={`#week-${week}`}
              className="text-gray-600 hover:text-gray-300 normal-case tracking-normal font-normal"
              title="Link to this week"
            >
              #
            </a>
          </h3>
          <div className="space-y-2">
            {byWeek[week].map((m) => {
              const isMyMatch = myPlayerId && (m.white_player_id === myPlayerId || m.black_player_id === myPlayerId)
              const isPending = m.result === 'pending'
              const isReporting = reporting === m.id
              const oppUsername = isMyMatch
                ? (m.white_player_id === myPlayerId ? m.black_player.chess_com_username : m.white_player.chess_com_username)
                : null
              const foundGames = (isPending && oppUsername) ? foundGamesVs(oppUsername) : []
              const hasFound = foundGames.length > 0
              const game = m.games?.[0] ?? null
              const badge = formatBadge(game)

              return (
                <div key={m.id} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="flex items-center gap-3 text-sm min-w-0">
                      <span className="text-xs text-gray-600 shrink-0">{m.bracket}</span>
                      {badge && (
                        <span className="text-[10px] text-gray-400 border border-gray-700 rounded px-1 py-0.5 shrink-0">
                          {badge}
                        </span>
                      )}
                      <span className="truncate">{m.white_player.display_name}</span>
                      <span className="text-gray-600 shrink-0">vs</span>
                      <span className="truncate">{m.black_player.display_name}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {game && (
                        <button
                          onClick={() => isMyMatch && toggleStar(m.id)}
                          disabled={!isMyMatch}
                          title={isMyMatch ? (game.starred ? 'Unstar this game' : 'Star this game') : 'Especially good game'}
                          className={`text-lg leading-none ${game.starred ? 'text-amber-400' : 'text-gray-700'} ${isMyMatch ? 'hover:text-amber-300 cursor-pointer' : 'cursor-default'}`}
                        >
                          {game.starred ? '★' : '☆'}
                        </button>
                      )}
                      <div className="text-sm text-right">
                        {m.chess_com_game_url ? (
                          <a
                            href={m.chess_com_game_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${resultColor[m.result]} hover:underline`}
                          >
                            {resultLabel(m)} ↗
                          </a>
                        ) : (
                          <span className={resultColor[m.result]}>{resultLabel(m)}</span>
                        )}
                        <div className={`text-xs mt-0.5 ${dateColor(m)}`}>
                          {m.scheduled_start} – {m.scheduled_end}
                        </div>
                      </div>
                      {isMyMatch && !isPending && (
                        <button
                          onClick={async () => {
                            await fetch('/api/matches/override', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ matchId: m.id, result: 'pending' }),
                            })
                            setMatches(prev => prev.map(x => x.id === m.id ? { ...x, result: 'pending', chess_com_game_url: null } : x))
                          }}
                          className="text-xs text-gray-500 hover:text-red-400 hover:underline"
                        >
                          Clear
                        </button>
                      )}
                      {isMyMatch && isPending && (
                        <button
                          onClick={() => {
                            if (isReporting) { setReporting(null); setGameUrl(''); setWarning('') }
                            else { setReporting(m.id); setGameUrl(''); setWarning('') }
                          }}
                          className={`text-xs px-3 py-1.5 rounded border transition-colors whitespace-nowrap ${
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
                                    onClick={() => { setGameUrl(g.url); setWarning('') }}
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
                      <p className="text-xs text-gray-400">Paste the chess.com game URL — the result will be read automatically.</p>
                      <div className="flex gap-2">
                        <input
                          type="url"
                          value={gameUrl}
                          onChange={e => { setGameUrl(e.target.value); setWarning('') }}
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
                            { label: 'I won', result: m.white_player_id === myPlayerId ? 'white_wins' : 'black_wins' },
                            { label: 'I lost', result: m.white_player_id === myPlayerId ? 'black_wins' : 'white_wins' },
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
                      {warning && (
                        <div className="bg-amber-950 border border-amber-700 rounded px-3 py-2 text-sm text-amber-300 flex items-start justify-between gap-3">
                          <span>{warning}</span>
                          <button onClick={() => submitReport(m.id, true)} className="text-xs underline shrink-0 hover:text-amber-100">
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
        </div>
      ))}
    </div>
  )
}
