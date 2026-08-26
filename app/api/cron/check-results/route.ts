import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getMonthlyGames, findMatchGame, deriveResult } from '@/lib/chess-com'
import { upsertGameFromChessCom } from '@/lib/games'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const secret = req.headers.get('authorization')
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceClient()
  const today = new Date().toISOString().split('T')[0]

  // Fetch all pending matches whose window has ended
  const { data: matches, error } = await db
    .from('matches')
    .select(`
      id, bracket, white_player_id, black_player_id,
      scheduled_start, scheduled_end,
      white_player:players!white_player_id(chess_com_username),
      black_player:players!black_player_id(chess_com_username)
    `)
    .eq('result', 'pending')
    .lte('scheduled_end', today)

  if (error) {
    console.error('Failed to fetch pending matches:', error)
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  let updated = 0
  let checked = 0

  for (const match of matches ?? []) {
    // Supabase returns joined rows as arrays for foreign key relations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = match as any
    const whiteUsername = Array.isArray(m.white_player) ? m.white_player[0]?.chess_com_username : m.white_player?.chess_com_username
    const blackUsername = Array.isArray(m.black_player) ? m.black_player[0]?.chess_com_username : m.black_player?.chess_com_username
    if (!whiteUsername || !blackUsername) continue

    const startDate = new Date(m.scheduled_start)
    const endDate = new Date(m.scheduled_end)
    endDate.setHours(23, 59, 59, 999)

    const startTs = Math.floor(startDate.getTime() / 1000)
    const endTs = Math.floor(endDate.getTime() / 1000)

    const year = endDate.getFullYear()
    const month = endDate.getMonth() + 1

    const games = await getMonthlyGames(whiteUsername, year, month)
    checked++

    const game = findMatchGame(games, blackUsername, startTs, endTs)
    if (game) {
      const result = deriveResult(game, whiteUsername)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.from('matches').update({ result, chess_com_game_url: game.url, last_checked_at: new Date().toISOString() } as any).eq('id', m.id)
      try {
        await upsertGameFromChessCom(db, {
          matchId: m.id,
          whitePlayerId: m.white_player_id,
          blackPlayerId: m.black_player_id,
          result,
          chessGame: game,
        })
      } catch (err) {
        console.error('Failed to import game for match', m.id, err)
      }
      updated++
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.from('matches').update({ last_checked_at: new Date().toISOString() } as any).eq('id', m.id)
    }
  }

  return NextResponse.json({ checked, updated })
}
