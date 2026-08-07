'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { MatchWithPlayers as Match } from '@/lib/database.types'

const resultColor: Record<string, string> = {
  white_wins: 'text-yellow-300',
  black_wins: 'text-blue-300',
  draw: 'text-gray-400',
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
  if (m.scheduled_end < today) return 'text-red-800'
  return 'text-gray-600'
}

export default function MatchList({ matches: initialMatches }: { matches: Match[] }) {
  const [matches, setMatches] = useState(initialMatches)
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null)
  const [reporting, setReporting] = useState<string | null>(null)
  const [gameUrl, setGameUrl] = useState('')
  const [warning, setWarning] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data } = await supabase
        .from('players')
        .select('id')
        .eq('user_id', session.user.id)
        .single()
      if (data) setMyPlayerId((data as { id: string }).id)
    })
  }, [])

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
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-2">
            Week {week}
          </h3>
          <div className="space-y-2">
            {byWeek[week].map((m) => {
              const isMyMatch = myPlayerId && (m.white_player_id === myPlayerId || m.black_player_id === myPlayerId)
              const isPending = m.result === 'pending'
              const isReporting = reporting === m.id

              return (
                <div key={m.id} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-xs text-gray-600 w-4">{m.bracket}</span>
                      <span>{m.white_player.display_name}</span>
                      <span className="text-gray-600">vs</span>
                      <span>{m.black_player.display_name}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
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
                          className="text-xs bg-gray-800 border border-gray-700 px-3 py-1.5 rounded hover:bg-gray-700 whitespace-nowrap"
                        >
                          {isReporting ? 'Cancel' : 'Report result'}
                        </button>
                      )}
                    </div>
                  </div>

                  {isReporting && (
                    <div className="mt-3 border-t border-gray-800 pt-3 space-y-2">
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
