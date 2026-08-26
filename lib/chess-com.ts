const CHESS_COM_BASE = 'https://api.chess.com/pub'

export interface ChessComGame {
  url: string
  pgn: string
  end_time: number
  time_class: string
  time_control: string
  rules: string
  white: { username: string; result: string }
  black: { username: string; result: string }
}

export interface ChessComArchive {
  games: ChessComGame[]
}

export async function validateChessComUsername(username: string): Promise<boolean> {
  try {
    const res = await fetch(`${CHESS_COM_BASE}/player/${username.toLowerCase()}`, {
      headers: { 'User-Agent': 'chess-tournament-tracker/1.0' },
    })
    return res.ok
  } catch {
    return false
  }
}

export async function getMonthlyGames(
  username: string,
  year: number,
  month: number
): Promise<ChessComGame[]> {
  const mm = String(month).padStart(2, '0')
  try {
    const res = await fetch(
      `${CHESS_COM_BASE}/player/${username.toLowerCase()}/games/${year}/${mm}`,
      { headers: { 'User-Agent': 'chess-tournament-tracker/1.0' } }
    )
    if (!res.ok) return []
    const data: ChessComArchive = await res.json()
    return data.games ?? []
  } catch {
    return []
  }
}

/** Find a game between two players within a date range (unix timestamps). */
export function findMatchGame(
  games: ChessComGame[],
  opponentUsername: string,
  startTs: number,
  endTs: number
): ChessComGame | null {
  const opp = opponentUsername.toLowerCase()
  return (
    games.find((g) => {
      const isOpponent =
        g.white.username.toLowerCase() === opp ||
        g.black.username.toLowerCase() === opp
      return isOpponent && g.end_time >= startTs && g.end_time <= endTs
    }) ?? null
  )
}

/** Derive match result from a chess.com game, from the perspective of white/black player IDs. */
export function deriveResult(
  game: ChessComGame,
  whiteUsername: string
): 'white_wins' | 'black_wins' | 'draw' {
  // Find which side the tournament-white player took in the chess.com game (may differ from tournament color)
  const tournWhitePlayed = game.white.username.toLowerCase() === whiteUsername.toLowerCase()
    ? game.white : game.black
  const DRAW_RESULTS = ['agreed', 'stalemate', 'repetition', '50move', 'insufficient', 'timevsinsufficient']
  if (tournWhitePlayed.result === 'win') return 'white_wins'
  if (DRAW_RESULTS.includes(tournWhitePlayed.result)) return 'draw'
  return 'black_wins'
}
