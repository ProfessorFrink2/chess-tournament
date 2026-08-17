import type { Player } from '@/lib/database.types'

export interface StandingRow {
  player: Pick<Player, 'id' | 'display_name' | 'chess_com_username'>
  wins: number
  draws: number
  losses: number
  points: number
  /** Explicit rank from a stored table. Omit to number rows by position. */
  rank?: number
}

/** Renders a league table. Shared by the live season (where rows are computed
 *  from match results) and by historic seasons (where the final table is stored
 *  in season_standings), so both look identical. */
export default function StandingsTable({
  rows,
  emptyMessage = 'No players assigned yet.',
}: {
  rows: StandingRow[]
  emptyMessage?: string
}) {
  if (rows.length === 0) {
    return <p className="text-gray-500 text-sm">{emptyMessage}</p>
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
          {rows.map((row, i) => (
            <tr key={row.player.id} className="border-b border-gray-800/50">
              <td className="py-2 pr-4 text-gray-500">{row.rank ?? i + 1}</td>
              <td className="py-2 pr-4 font-medium">
                {/* Historic players may have no chess.com account to link to. */}
                {row.player.chess_com_username ? (
                  <a
                    href={`https://chess.com/member/${row.player.chess_com_username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {row.player.display_name}
                  </a>
                ) : (
                  row.player.display_name
                )}
              </td>
              <td className="py-2 pr-2 text-center text-green-400">{row.wins}</td>
              <td className="py-2 pr-2 text-center text-gray-400">{row.draws}</td>
              <td className="py-2 pr-2 text-center text-red-400">{row.losses}</td>
              <td className="py-2 text-center font-bold">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
