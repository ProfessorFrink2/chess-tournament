import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

/** Toggles the "starred" flag on a match's imported game. Only the two
 *  players in that match may star it -- resolved server-side from the
 *  bearer token, same pattern as /api/player-stats, rather than trusting a
 *  client-supplied player id. */
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

  const { data: match } = await db
    .from('matches')
    .select('white_player_id, black_player_id')
    .eq('id', matchId)
    .maybeSingle()

  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 })

  const m = match as { white_player_id: string; black_player_id: string }
  const playerId = (player as { id: string }).id
  if (m.white_player_id !== playerId && m.black_player_id !== playerId) {
    return NextResponse.json({ error: 'Only players in this match can star it' }, { status: 403 })
  }

  const { data: game } = await db
    .from('games')
    .select('id, starred')
    .eq('match_id', matchId)
    .maybeSingle()

  if (!game) {
    return NextResponse.json({ error: 'No recorded game to star yet' }, { status: 404 })
  }

  const g = game as { id: string; starred: boolean }
  const starred = !g.starred
  const { error } = await db.from('games').update({ starred }).eq('id', g.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, starred })
}
