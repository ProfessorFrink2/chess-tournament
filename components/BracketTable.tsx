'use client'

import { Player, MatchWithPlayers as Match } from '@/lib/database.types'

function computeStandings(players: Player[], matches: Match[]) {
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
    .map((p) => ({ player: p, ...scores[p.id] }))
    .sort((a, b) => {
      const pts = (x: typeof a) => x.wins * 2 + x.draws
      const diff = pts(b) - pts(a)
      if (diff !== 0) return diff
      return a.player.display_name.localeCompare(b.player.display_name)
    })
}

export default function BracketTable({ players, matches }: { players: Player[]; matches: Match[] }) {
  const standings = computeStandings(players, matches)

  if (players.length === 0) {
    return <p className="text-gray-500 text-sm">No players assigned yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 text-left border-b border-gray-800">
            <th className="pb-2 pr-4">#</th>
            <th className="pb-2 pr-4">Player</th>
            <th className="pb-2 pr-2 text-center">W</th>
            <th className="pb-2 pr-2 text-center">D</th>
            <th className="pb-2 pr-2 text-center">L</th>
            <th className="pb-2 text-center">Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row, i) => (
            <tr key={row.player.id} className="border-b border-gray-800/50">
              <td className="py-2 pr-4 text-gray-500">{i + 1}</td>
              <td className="py-2 pr-4 font-medium">
                <a
                  href={`https://chess.com/member/${row.player.chess_com_username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {row.player.display_name}
                </a>
              </td>
              <td className="py-2 pr-2 text-center text-green-400">{row.wins}</td>
              <td className="py-2 pr-2 text-center text-gray-400">{row.draws}</td>
              <td className="py-2 pr-2 text-center text-red-400">{row.losses}</td>
              <td className="py-2 text-center font-bold">{row.wins * 2 + row.draws}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
