import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { MatchResult } from '@/lib/database.types'

export async function POST(req: NextRequest) {
  const db = createServiceClient()
  const { matchId, result } = await req.json()

  const validResults: MatchResult[] = ['white_wins', 'black_wins', 'draw', 'pending']
  if (!matchId || !validResults.includes(result)) {
    return NextResponse.json({ error: 'Invalid matchId or result' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await db
    .from('matches')
    .update({ result, chess_com_game_url: result === 'pending' ? null : undefined, last_checked_at: new Date().toISOString() } as any)
    .eq('id', matchId)

  if (error) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
