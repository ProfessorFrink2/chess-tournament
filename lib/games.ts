import { createServiceClient } from '@/lib/supabase'
import { ChessComGame } from '@/lib/chess-com'
import { parseGameStats } from '@/lib/pgn'
import { MatchResult } from '@/lib/database.types'

type Db = ReturnType<typeof createServiceClient>

interface UpsertGameParams {
  matchId?: string
  tournamentMatchId?: string
  whitePlayerId: string
  blackPlayerId: string
  result: MatchResult
  chessGame: ChessComGame
}

/** Parses and stores a chess.com game's PGN + derived stats, keyed on its URL
 *  so re-running import/backfill for the same game is a no-op. Exactly one of
 *  matchId/tournamentMatchId must be given. */
export async function upsertGameFromChessCom(db: Db, params: UpsertGameParams) {
  const { matchId, tournamentMatchId, whitePlayerId, blackPlayerId, result, chessGame } = params
  if (!matchId === !tournamentMatchId) {
    throw new Error('upsertGameFromChessCom requires exactly one of matchId/tournamentMatchId')
  }

  const stats = parseGameStats(chessGame.pgn)

  const { error } = await db.from('games').upsert(
    {
      match_id: matchId ?? null,
      tournament_match_id: tournamentMatchId ?? null,
      white_player_id: whitePlayerId,
      black_player_id: blackPlayerId,
      chess_com_url: chessGame.url,
      pgn: chessGame.pgn,
      result,
      time_control: chessGame.time_control ?? null,
      rules: chessGame.rules ?? null,
      time_class: chessGame.time_class ?? null,
      ply_count: stats.plyCount,
      end_time: new Date(chessGame.end_time * 1000).toISOString(),
      stats,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    { onConflict: 'chess_com_url' }
  )

  if (error) throw new Error(`Failed to upsert game ${chessGame.url}: ${error.message}`)
}
