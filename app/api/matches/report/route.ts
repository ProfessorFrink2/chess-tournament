import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { MatchResult } from '@/lib/database.types'
import { getMonthlyGames, deriveResult } from '@/lib/chess-com'
import { upsertGameFromChessCom } from '@/lib/games'

const CHESS_COM_GAME_RE = /^https:\/\/www\.chess\.com\/game\/live\/(\d+)/i

export async function POST(req: NextRequest) {
  const db = createServiceClient()
  const { matchId, gameUrl, force, manualResult } = await req.json()

  if (!matchId) {
    return NextResponse.json({ error: 'matchId is required' }, { status: 400 })
  }

  // Manual result path (no chess.com URL needed)
  if (manualResult) {
    const valid: MatchResult[] = ['white_wins', 'black_wins', 'draw']
    if (!valid.includes(manualResult)) {
      return NextResponse.json({ error: 'Invalid result' }, { status: 400 })
    }
    const { error } = await db.from('matches').update({
      result: manualResult,
      chess_com_game_url: null,
      last_checked_at: new Date().toISOString(),
    } as any).eq('id', matchId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, result: manualResult })
  }

  if (!gameUrl) {
    return NextResponse.json({ error: 'gameUrl or manualResult is required' }, { status: 400 })
  }

  // Validate URL format
  const urlMatch = gameUrl.trim().match(CHESS_COM_GAME_RE)
  if (!urlMatch) {
    return NextResponse.json({ error: 'Please paste a valid chess.com game URL (e.g. https://www.chess.com/game/live/...)' }, { status: 400 })
  }
  const normalizedUrl = `https://www.chess.com/game/live/${urlMatch[1]}`

  // Check if this URL is already linked to a different match
  const { data: existing } = await db
    .from('matches')
    .select('id')
    .eq('chess_com_game_url', normalizedUrl)
    .neq('id', matchId)
    .maybeSingle()

  if (existing && !force) {
    return NextResponse.json({
      warning: 'This game is already linked to another match. Are you sure you want to use it for this one too?',
      requiresForce: true,
    }, { status: 409 })
  }

  // Fetch the match to get player usernames
  const { data: match } = await db
    .from('matches')
    .select(`
      white_player_id, black_player_id,
      white_player:players!white_player_id(chess_com_username),
      black_player:players!black_player_id(chess_com_username)
    `)
    .eq('id', matchId)
    .single()

  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = match as any
  const whiteUsername: string = Array.isArray(m.white_player) ? m.white_player[0]?.chess_com_username : m.white_player?.chess_com_username
  const blackUsername: string = Array.isArray(m.black_player) ? m.black_player[0]?.chess_com_username : m.black_player?.chess_com_username

  if (!whiteUsername || !blackUsername) {
    return NextResponse.json({ error: 'Could not resolve player usernames' }, { status: 500 })
  }

  // Fetch that game from chess.com to derive the result
  // The game URL contains the game ID — find it in either player's recent months
  const now = new Date()
  let foundGame = null
  for (let monthOffset = 0; monthOffset <= 6 && !foundGame; monthOffset++) {
    const d = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1)
    const games = await getMonthlyGames(whiteUsername, d.getFullYear(), d.getMonth() + 1)
    foundGame = games.find(g => g.url.includes(urlMatch[1])) ?? null
  }

  if (!foundGame) {
    return NextResponse.json({ error: 'Game not found on chess.com. Make sure the URL is correct and the game is finished.' }, { status: 404 })
  }

  // Verify both tournament players are in the game
  const gameUsernames = [foundGame.white.username.toLowerCase(), foundGame.black.username.toLowerCase()]
  if (!gameUsernames.includes(whiteUsername.toLowerCase()) || !gameUsernames.includes(blackUsername.toLowerCase())) {
    return NextResponse.json({ error: `This game doesn't appear to be between ${whiteUsername} and ${blackUsername}.` }, { status: 400 })
  }

  const result: MatchResult = deriveResult(foundGame, whiteUsername)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await db.from('matches').update({
    result,
    chess_com_game_url: normalizedUrl,
    last_checked_at: new Date().toISOString(),
  } as any).eq('id', matchId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await upsertGameFromChessCom(db, {
      matchId,
      whitePlayerId: m.white_player_id,
      blackPlayerId: m.black_player_id,
      result,
      chessGame: foundGame,
    })
  } catch (err) {
    console.error('Failed to import game for match', matchId, err)
  }

  return NextResponse.json({ ok: true, result })
}
