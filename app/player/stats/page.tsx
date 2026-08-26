'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Player } from '@/lib/database.types'
import { PlayerStats } from '@/lib/player-stats'
import StatCard from '@/components/StatCard'
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
            <StatCard title="Games Played" value={stats.gamesPlayed} />
            <StatCard title="Trophies" value={stats.trophies} subtitle="Season + championship wins" />
            <StatCard title="Decisive Games" value={fmtPct(stats.decisiveGameRate)} subtitle="Non-draw rate" />

            <StatCard
              title="Longest Game"
              value={stats.longestGame ? `${stats.longestGame.plyCount} plies` : '—'}
              subtitle={stats.longestGame ? `vs ${stats.longestGame.opponentName}` : undefined}
            />
            <StatCard
              title="Shortest Game"
              value={stats.shortestGame ? `${stats.shortestGame.plyCount} plies` : '—'}
              subtitle={stats.shortestGame ? `vs ${stats.shortestGame.opponentName}` : undefined}
            />
            <StatCard title="Scholar's Mate Trap" value={stats.scholarsMateCount} subtitle="Decisive games in ≤5 moves" />

            <StatCard
              title="Nemesis"
              value={stats.nemesis?.name ?? '—'}
              subtitle={stats.nemesis ? `${stats.nemesis.losses} losses in ${stats.nemesis.gamesPlayed} games` : 'No repeat losses yet'}
            />
            <StatCard
              title="Victim"
              value={stats.victim?.name ?? '—'}
              subtitle={stats.victim ? `${stats.victim.wins} wins in ${stats.victim.gamesPlayed} games` : 'No repeat wins yet'}
            />
            <StatCard
              title="Longest Streak"
              value={stats.longestWinStreak > 0 ? `${stats.longestWinStreak}W` : stats.longestLossStreak > 0 ? `${stats.longestLossStreak}L` : '—'}
            />

            <StatCard
              title="The Bullet Train"
              value={stats.bulletTrain ? fmtSeconds(stats.bulletTrain.seconds) : '—'}
              subtitle={stats.bulletTrain ? `Fastest 5 moves, vs ${stats.bulletTrain.opponentName}` : 'Needs clock data'}
            />
            <StatCard
              title="Brain Freeze"
              value={stats.brainFreeze ? fmtSeconds(stats.brainFreeze.seconds) : '—'}
              subtitle={stats.brainFreeze ? `On ${stats.brainFreeze.san}, vs ${stats.brainFreeze.opponentName}` : 'Needs clock data'}
            />
            <StatCard title="First Blood" value={fmtPct(stats.firstBloodRate)} subtitle="% games with first capture" />

            <StatCard
              title="Greedy Captures"
              value={stats.greedyCaptures.total}
              subtitle={stats.greedyCaptures.mostInOneGame ? `Most in one game: ${stats.greedyCaptures.mostInOneGame.count} vs ${stats.greedyCaptures.mostInOneGame.opponentName}` : undefined}
            />
            <StatCard title="Check Spammer" value={stats.checkSpammer.total} subtitle="Total checks given" />
            <StatCard title="King Walk Distance" value={`${stats.kingWalkSquares.total} sq`} subtitle="Total squares traveled" />

            <StatCard
              title="Format Bias — 10+2"
              value={stats.formatBias.standard ? fmtPct(stats.formatBias.standard.winRate) : '—'}
              subtitle={stats.formatBias.standard ? `${stats.formatBias.standard.wins}W ${stats.formatBias.standard.draws}D ${stats.formatBias.standard.losses}L` : 'No data'}
            />
            <StatCard
              title="Format Bias — Chess960"
              value={stats.formatBias.chess960 ? fmtPct(stats.formatBias.chess960.winRate) : '—'}
              subtitle={stats.formatBias.chess960 ? `${stats.formatBias.chess960.wins}W ${stats.formatBias.chess960.draws}D ${stats.formatBias.chess960.losses}L` : 'No data'}
            />
            <StatCard
              title="Color Split"
              value={`${fmtPct(stats.colorSplit.whiteWinRate)} / ${fmtPct(stats.colorSplit.blackWinRate)}`}
              subtitle="Win rate as White / Black"
            />

            {stats.favoriteOpening && (
              <StatCard title="Favorite Opening" value={stats.favoriteOpening.moves} subtitle={`Played ${stats.favoriteOpening.count} times`} />
            )}
          </div>
        </>
      )}
    </div>
  )
}
