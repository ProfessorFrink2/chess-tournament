import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient, requireAdmin } from '@/lib/supabase'
import { getMonthlyGames, deriveResult } from '@/lib/chess-com'
import { upsertGameFromChessCom } from '@/lib/games'

const CHESS_COM_GAME_RE = /^https:\/\/www\.chess\.com\/game\/live\/(\d+)/i

/** Records one game of a tournament match (a race-to-N between two seeds).
 *  Recomputes score_a/score_b from the games actually imported for this
 *  match; leaves winner_id for the admin to set by hand once the match is
 *  decided, same as today — there's no stored "best of N" to auto-finalize
 *  against. */
export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin(req)
  if (unauthorized) return unauthorized

  const db = createServiceClient()
  const { tournamentMatchId, gameUrl } = await req.json()

  if (!tournamentMatchId || !gameUrl) {
    return NextResponse.json({ error: 'tournamentMatchId and gameUrl are required' }, { status: 400 })
  }

  const urlMatch = String(gameUrl).trim().match(CHESS_COM_GAME_RE)
  if (!urlMatch) {
    return NextResponse.json({ error: 'Please paste a valid chess.com game URL (e.g. https://www.chess.com/game/live/...)' }, { status: 400 })
  }
  const normalizedUrl = `https://www.chess.com/game/live/${urlMatch[1]}`

  const { data: tm } = await db
    .from('tournament_matches')
    .select(`
      id, player_a_id, player_b_id,
      player_a:players!player_a_id(chess_com_username),
      player_b:players!player_b_id(chess_com_username)
    `)
    .eq('id', tournamentMatchId)
    .single()

  if (!tm) return NextResponse.json({ error: 'Tournament match not found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tm as any
  if (!t.player_a_id || !t.player_b_id) {
    return NextResponse.json({ error: 'Both seeds must be assigned before recording a game' }, { status: 400 })
  }
  const usernameA: string = Array.isArray(t.player_a) ? t.player_a[0]?.chess_com_username : t.player_a?.chess_com_username
  const usernameB: string = Array.isArray(t.player_b) ? t.player_b[0]?.chess_com_username : t.player_b?.chess_com_username

  if (!usernameA || !usernameB) {
    return NextResponse.json({ error: 'Could not resolve player usernames' }, { status: 500 })
  }

  const existing = await db.from('games').select('id').eq('chess_com_url', normalizedUrl).maybeSingle()
  if (existing.data) {
    return NextResponse.json({ error: 'This game has already been recorded' }, { status: 409 })
  }

  const now = new Date()
  let foundGame = null
  for (let monthOffset = 0; monthOffset <= 12 && !foundGame; monthOffset++) {
    const d = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1)
    const games = await getMonthlyGames(usernameA, d.getFullYear(), d.getMonth() + 1)
    foundGame = games.find((g) => g.url.includes(urlMatch[1])) ?? null
  }

  if (!foundGame) {
    return NextResponse.json({ error: 'Game not found on chess.com. Make sure the URL is correct and the game is finished.' }, { status: 404 })
  }

  const gameUsernames = [foundGame.white.username.toLowerCase(), foundGame.black.username.toLowerCase()]
  if (!gameUsernames.includes(usernameA.toLowerCase()) || !gameUsernames.includes(usernameB.toLowerCase())) {
    return NextResponse.json({ error: `This game doesn't appear to be between ${usernameA} and ${usernameB}.` }, { status: 400 })
  }

  const aIsWhite = foundGame.white.username.toLowerCase() === usernameA.toLowerCase()
  const result = deriveResult(foundGame, aIsWhite ? usernameA : usernameB)
  const winnerIsA = aIsWhite ? result === 'white_wins' : result === 'black_wins'

  await upsertGameFromChessCom(db, {
    tournamentMatchId,
    whitePlayerId: aIsWhite ? t.player_a_id : t.player_b_id,
    blackPlayerId: aIsWhite ? t.player_b_id : t.player_a_id,
    result,
    chessGame: foundGame,
  })

  const { data: storedGames, error: gamesError } = await db
    .from('games')
    .select('white_player_id, black_player_id, result')
    .eq('tournament_match_id', tournamentMatchId)
  if (gamesError) return NextResponse.json({ error: gamesError.message }, { status: 500 })

  let scoreA = 0
  let scoreB = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const g of (storedGames ?? []) as any[]) {
    if (g.result === 'draw') continue
    const aWon = g.result === 'white_wins' ? g.white_player_id === t.player_a_id : g.black_player_id === t.player_a_id
    if (aWon) scoreA++
    else scoreB++
  }

  const { error: updateError } = await db
    .from('tournament_matches')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({ score_a: scoreA, score_b: scoreB } as any)
    .eq('id', tournamentMatchId)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ ok: true, result, winnerIsA, scoreA, scoreB })
}
