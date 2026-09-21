'use client'

import { ReactNode, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Player } from '@/lib/database.types'
import { PlayerStats } from '@/lib/player-stats'
import StatCard from '@/components/StatCard'
import ColorOutcomeSunburst from '@/components/ColorOutcomeSunburst'
import Link from 'next/link'

function fmtSeconds(s: number): string {
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m ${rem}s`
}

function fmtPct(n: number | null): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`
}

/** chess.com's game page highlights the position after the Nth half-move via
 *  ?move=N, 1-indexed — our stored ply is 0-indexed, so add 1. */
function moveUrl(url: string, ply: number): string {
  return `${url}?move=${ply + 1}`
}

function GameLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-indigo-400 hover:text-indigo-300 underline"
    >
      {children}
    </a>
  )
}

export default function PlayerStatsPage() {
  const router = useRouter()
  const [player, setPlayer] = useState<Player | null>(null)
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/auth/login'); return }

    const { data: playerData } = await supabase
      .from('players')
      .select('*')
      .eq('user_id', session.user.id)
      .single()

    if (!playerData) { router.push('/auth/signup'); return }
    setPlayer(playerData as Player)

    const res = await fetch('/api/player-stats', {
      headers: { authorization: `Bearer ${session.access_token}` },
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to load stats.'); setLoading(false); return }
    setStats(data.stats as PlayerStats)
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) return <p className="text-gray-400">Loading…</p>
  if (error) return <p className="text-red-400">{error}</p>
  if (!player || !stats) return null

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{player.display_name}&rsquo;s Stats</h1>
        <Link href="/player" className="text-sm text-gray-400 hover:text-white">
          &larr; Back
        </Link>
      </div>

      {stats.gamesPlayed === 0 ? (
        <p className="text-gray-500 text-sm">
          No recorded league or tournament games yet — stats will appear once results with a linked chess.com game come in.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-3 bg-gray-800 rounded-lg p-4 flex flex-col gap-2">
              <p className="text-xs text-gray-400 uppercase tracking-wide">Game Breakdown</p>
              <ColorOutcomeSunburst colorOutcomes={stats.colorOutcomes} />
            </div>

            <StatCard
              title="Avg Game Length"
              value={stats.avgGameLength != null ? `${Math.round(stats.avgGameLength)} plies` : '—'}
              subtitle="Last 12 games"
              bars={stats.recentGameLength.length > 0 ? stats.recentGameLength : undefined}
            />
            <StatCard
              title="Avg Time / Move"
              value={stats.avgMoveTimeSeconds != null ? fmtSeconds(stats.avgMoveTimeSeconds) : '—'}
              subtitle={stats.avgMoveTimeSeconds != null ? 'Last 12 games' : 'Needs clock data'}
              bars={stats.recentAvgMoveTime.length > 0 ? stats.recentAvgMoveTime : undefined}
            />
            <StatCard title="Games Played" value={stats.gamesPlayed} />

            {stats.gameResults.length > 0 && (
              <div className="col-span-2 sm:col-span-3 bg-gray-800 rounded-lg p-4 flex flex-col gap-2">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Game Results</p>
                <p className="text-3xl font-bold text-white">
                  {fmtPct(stats.gameResults.filter((g) => g.result === 'win').length / stats.gameResults.length)}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {stats.gameResults.map((g, i) => (
                    <a
                      key={i}
                      href={g.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`${g.label} vs ${g.opponentName} — ${
                        g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : 'Draw'
                      }`}
                      className="text-lg leading-none hover:scale-125 transition-transform"
                    >
                      {g.result === 'win' ? '✅' : g.result === 'loss' ? '❌' : '⚖️'}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <StatCard title="Trophies" value={stats.trophies} subtitle="Season + championship wins" />
            <StatCard title="Decisive Games" value={fmtPct(stats.decisiveGameRate)} subtitle="Non-draw rate" />

            <StatCard
              title="Longest Game"
              value={stats.longestGame ? `${stats.longestGame.plyCount} plies` : '—'}
              subtitle={
                stats.longestGame ? (
                  <>
                    vs {stats.longestGame.opponentName} — <GameLink href={stats.longestGame.url}>view game</GameLink>
                  </>
                ) : undefined
              }
            />
            <StatCard
              title="Shortest Game"
              value={stats.shortestGame ? `${stats.shortestGame.plyCount} plies` : '—'}
              subtitle={
                stats.shortestGame ? (
                  <>
                    vs {stats.shortestGame.opponentName} — <GameLink href={stats.shortestGame.url}>view game</GameLink>
                  </>
                ) : undefined
              }
            />

            <StatCard
              title="Longest Streak"
              value={stats.longestWinStreak > 0 ? `${stats.longestWinStreak}W` : stats.longestLossStreak > 0 ? `${stats.longestLossStreak}L` : '—'}
            />

            <StatCard
              title="The Bullet Train"
              value={stats.bulletTrain ? fmtSeconds(stats.bulletTrain.seconds) : '—'}
              subtitle={
                stats.bulletTrain ? (
                  <>
                    Fastest 5 moves, vs {stats.bulletTrain.opponentName}
                    {stats.bulletTrain.startPly != null && (
                      <>
                        {' — '}
                        <GameLink href={moveUrl(stats.bulletTrain.url, stats.bulletTrain.startPly)}>view move</GameLink>
                      </>
                    )}
                  </>
                ) : 'Needs clock data'
              }
            />
            <StatCard
              title="Brain Freeze"
              value={stats.brainFreeze ? fmtSeconds(stats.brainFreeze.seconds) : '—'}
              subtitle={
                stats.brainFreeze ? (
                  <>
                    On {stats.brainFreeze.san}, vs {stats.brainFreeze.opponentName}
                    {stats.brainFreeze.ply != null && (
                      <>
                        {' — '}
                        <GameLink href={moveUrl(stats.brainFreeze.url, stats.brainFreeze.ply)}>view move</GameLink>
                      </>
                    )}
                  </>
                ) : 'Needs clock data'
              }
            />
            <StatCard title="First Blood" value={fmtPct(stats.firstBloodRate)} subtitle="% games with first capture" />

            <StatCard
              title="Greedy Captures"
              value={stats.greedyCaptures.total}
              subtitle={
                stats.greedyCaptures.mostInOneGame ? (
                  <>
                    Most in one game: {stats.greedyCaptures.mostInOneGame.count} vs {stats.greedyCaptures.mostInOneGame.opponentName}
                    {' — '}
                    <GameLink href={stats.greedyCaptures.mostInOneGame.url}>view game</GameLink>
                  </>
                ) : undefined
              }
            />
            <StatCard title="Check Spammer" value={stats.checkSpammer.total} subtitle="Total checks given" />
            <StatCard title="King Walk Distance" value={`${stats.kingWalkSquares.total} sq`} subtitle="Total squares traveled" />
            <StatCard
              title="Captures / Game"
              value={stats.perGameRates ? stats.perGameRates.captures.toFixed(1) : '—'}
            />
            <StatCard
              title="Checks / Game"
              value={stats.perGameRates ? stats.perGameRates.checks.toFixed(1) : '—'}
            />
            <StatCard
              title="King Walk / Game"
              value={stats.perGameRates ? `${stats.perGameRates.kingWalkSquares.toFixed(1)} sq` : '—'}
            />

            <StatCard
              title="10+2 Win Rate"
              value={stats.formatBias.standard ? fmtPct(stats.formatBias.standard.winRate) : '—'}
              subtitle={stats.formatBias.standard ? `${stats.formatBias.standard.wins}W ${stats.formatBias.standard.draws}D ${stats.formatBias.standard.losses}L` : 'No data'}
            />
            <StatCard
              title="Chess960 Win Rate"
              value={stats.formatBias.chess960 ? fmtPct(stats.formatBias.chess960.winRate) : '—'}
              subtitle={stats.formatBias.chess960 ? `${stats.formatBias.chess960.wins}W ${stats.formatBias.chess960.draws}D ${stats.formatBias.chess960.losses}L` : 'No data'}
            />
            <StatCard title="Win Rate As White" value={fmtPct(stats.colorSplit.whiteWinRate)} />
            <StatCard title="Win Rate As Black" value={fmtPct(stats.colorSplit.blackWinRate)} />

            {stats.favoriteOpening && (
              <StatCard title="Favorite Opening" value={stats.favoriteOpening.moves} subtitle={`Played ${stats.favoriteOpening.count} times`} />
            )}
            <StatCard title="Opening Variety" value={stats.openingVariety} subtitle="Distinct openings played" />
          </div>
        </>
      )}
    </div>
  )
}
