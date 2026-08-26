import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getPlayerStats } from '@/lib/player-stats'

/** Returns the caller's own fun stats. The player row is resolved from the
 *  authenticated user server-side — a client can never request another
 *  player's stats by passing an id. */
export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer /i, '')
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const db = createServiceClient()
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) {
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

  const stats = await getPlayerStats(db, (player as { id: string }).id)
  return NextResponse.json({ stats })
}
