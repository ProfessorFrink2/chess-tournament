import { NextRequest, NextResponse } from 'next/server'
import { validateChessComUsername } from '@/lib/chess-com'

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get('username')
  if (!username) {
    return NextResponse.json({ valid: false, error: 'Missing username' }, { status: 400 })
  }
  const valid = await validateChessComUsername(username)
  return NextResponse.json({ valid })
}
