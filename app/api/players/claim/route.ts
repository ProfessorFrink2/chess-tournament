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
      // Check if the existing account is just a dummy seed account (@chess.local email)
      const { data: existingProfile } = await db
        .from('profiles')
        .select('email')
        .eq('id', existing.user_id)
        .maybeSingle()

      const isSeedAccount = existingProfile?.email?.endsWith('@chess.local')

      if (!isSeedAccount) {
        // Already claimed by a real account — deny
        return NextResponse.json(
          { error: 'This chess.com username is already linked to another account.' },
          { status: 409 }
        )
      }

      // Delete the old dummy auth user so the profile row is cleaned up
      await db.auth.admin.deleteUser(existing.user_id)
    }

    // Seeded player (or just cleared) — associate with the new account
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
