import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const db = createServiceClient()
  const { userId, chessUsername, displayName } = await req.json()

  if (!userId || !chessUsername || !displayName) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const uname = chessUsername.toLowerCase()

  // Check if a player row already exists for this chess.com username
  const { data: existing } = await db
    .from('players')
    .select('id, user_id, display_name')
    .eq('chess_com_username', uname)
    .maybeSingle()

  if (existing) {
    if (existing.user_id) {
      // Already claimed by someone with a real account — deny
      return NextResponse.json(
        { error: 'This chess.com username is already linked to another account.' },
        { status: 409 }
      )
    }
    // Seeded player with no account yet — associate and optionally update display name
    const { error } = await db
      .from('players')
      .update({ user_id: userId, display_name: displayName } as any)
      .eq('id', existing.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, claimed: true })
  }

  // No existing player row — create a fresh one
  const { error } = await db
    .from('players')
    .insert({ user_id: userId, chess_com_username: uname, display_name: displayName } as any)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, claimed: false })
}
