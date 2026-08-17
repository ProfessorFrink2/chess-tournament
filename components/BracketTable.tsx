'use client'

import { Player, MatchWithPlayers as Match } from '@/lib/database.types'
import StandingsTable, { StandingRow } from './StandingsTable'

function computeStandings(players: Player[], matches: Match[]): StandingRow[] {
  const scores: Record<string, { wins: number; draws: number; losses: number; played: number }> = {}
  for (const p of players) {
    scores[p.id] = { wins: 0, draws: 0, losses: 0, played: 0 }
  }

  for (const m of matches) {
    if (m.result === 'pending') continue
    const w = m.white_player_id
    const b = m.black_player_id
    scores[w] = scores[w] ?? { wins: 0, draws: 0, losses: 0, played: 0 }
    scores[b] = scores[b] ?? { wins: 0, draws: 0, losses: 0, played: 0 }

    if (m.result === 'white_wins') {
      scores[w].wins++; scores[b].losses++
    } else if (m.result === 'black_wins') {
      scores[b].wins++; scores[w].losses++
    } else {
      scores[w].draws++; scores[b].draws++
    }
    scores[w].played++
    scores[b].played++
  }

  return players
    .map((p) => {
      const s = scores[p.id]
      return { player: p, wins: s.wins, draws: s.draws, losses: s.losses, points: s.wins * 2 + s.draws }
    })
    .sort((a, b) => {
      const diff = b.points - a.points
      if (diff !== 0) return diff
      return a.player.display_name.localeCompare(b.player.display_name)
    })
}

/** Live-season league table: derives standings from played matches, then hands
 *  off to StandingsTable so it renders identically to a stored historic table. */
export default function BracketTable({ players, matches }: { players: Player[]; matches: Match[] }) {
  return <StandingsTable rows={computeStandings(players, matches)} />
}
