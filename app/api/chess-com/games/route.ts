import { NextRequest, NextResponse } from 'next/server'

const BASE = 'https://api.chess.com/pub'
const HEADERS = { 'User-Agent': 'chess-tournament-tracker/1.0' }

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get('username')
  const limitParam = req.nextUrl.searchParams.get('limit')
  const limit = limitParam ? parseInt(limitParam) : 50

  if (!username) return NextResponse.json({ error: 'Missing username' }, { status: 400 })

  // Fetch list of monthly archive URLs
  const archivesRes = await fetch(`${BASE}/player/${username.toLowerCase()}/games/archives`, { headers: HEADERS })
  if (!archivesRes.ok) return NextResponse.json({ games: [] })

  const { archives } = await archivesRes.json()
  if (!archives?.length) return NextResponse.json({ games: [] })

  // Fetch months newest-first until we have enough games
  const games: object[] = []
  for (let i = archives.length - 1; i >= 0 && games.length < limit; i--) {
    const res = await fetch(archives[i], { headers: HEADERS })
    if (!res.ok) continue
    const data = await res.json()
    const monthGames = (data.games ?? [])
      .filter((g: { time_class: string; black: { username: string } }) =>
        g.time_class !== 'daily' && !g.black.username.startsWith('bot_')
      )
      .reverse() // newest first within month
    games.push(...monthGames)
  }

  return NextResponse.json({ games: games.slice(0, limit) })
}
