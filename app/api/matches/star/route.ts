import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

/** Toggles the caller's own star vote on a match's imported game. Any
 *  registered player may star any game -- the player id is resolved
 *  server-side from the bearer token, same pattern as /api/player-stats,
 *  rather than trusting a client-supplied player id. */
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer /i, '')
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { matchId } = await req.json()
  if (!matchId) {
    return NextResponse.json({ error: 'matchId is required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data: { user }, error: authError } = await db.auth.getUser(token)
  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: player } = await db
    .from('players')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!player) {
    return NextResponse.json({ error: 'No player record for this account' }, { status: 404 })
  }
  const playerId = (player as { id: string }).id

  const { data: game } = await db
    .from('games')
    .select('id')
    .eq('match_id', matchId)
    .maybeSingle()

  if (!game) {
    return NextResponse.json({ error: 'No recorded game to star yet' }, { status: 404 })
  }
  const gameId = (game as { id: string }).id

  const { data: existing } = await db
    .from('game_stars')
    .select('id')
    .eq('game_id', gameId)
    .eq('player_id', playerId)
    .maybeSingle()

  let starred: boolean
  if (existing) {
    const { error } = await db.from('game_stars').delete().eq('id', (existing as { id: string }).id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    starred = false
  } else {
    const { error } = await db.from('game_stars').insert({ game_id: gameId, player_id: playerId })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    starred = true
  }

  const { count } = await db
    .from('game_stars')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', gameId)

  return NextResponse.json({ ok: true, starred, count: count ?? 0 })
}
