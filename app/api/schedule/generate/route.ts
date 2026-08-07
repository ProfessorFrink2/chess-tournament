import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { generateRoundRobin, addDays, toDateString } from '@/lib/schedule'
import { Bracket } from '@/lib/database.types'

export async function POST(req: NextRequest) {
  const db = createServiceClient()
  const { seasonId, bracketStartDate: explicitStart } = await req.json()

  if (!seasonId) {
    return NextResponse.json({ error: 'Missing seasonId' }, { status: 400 })
  }

  // If no start date provided, pull it from the season record
  let bracketStartDate = explicitStart
  if (!bracketStartDate) {
    const { data: season } = await db.from('seasons').select('start_date').eq('id', seasonId).single()
    if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 })
    bracketStartDate = (season as { start_date: string }).start_date
  }

  const results: Record<string, number> = {}

  for (const bracket of ['A', 'B'] as Bracket[]) {
    const { data: players } = await db
      .from('players')
      .select('id')
      .eq('bracket', bracket)

    if (!players || players.length < 2) {
      results[bracket] = 0
      continue
    }

    const rounds = generateRoundRobin((players as { id: string }[]).map((p) => p.id))
    const matchRows = []
    const weekStart = new Date(bracketStartDate)

    for (let i = 0; i < rounds.length; i++) {
      const start = addDays(weekStart, i * 7)
      const end = addDays(start, 6)
      for (const [white, black] of rounds[i]) {
        matchRows.push({
          season_id: seasonId,
          bracket,
          week_number: i + 1,
          white_player_id: white,
          black_player_id: black,
          scheduled_start: toDateString(start),
          scheduled_end: toDateString(end),
        })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await db.from('matches').insert(matchRows as any)
    if (error) {
      console.error(`Error inserting ${bracket} bracket matches:`, error)
      return NextResponse.json({ error: `Failed to insert ${bracket} matches` }, { status: 500 })
    }
    results[bracket] = matchRows.length
  }

  // Set season end_date to the last match's end date
  const allEnds = Object.values(results).length > 0
    ? (() => {
        const weekStart = new Date(bracketStartDate)
        const maxRounds = Math.max(...['A', 'B'].map(b => {
          const n = results[b] > 0
            ? Math.ceil((-1 + Math.sqrt(1 + 8 * results[b])) / 2) + 1
            : 0
          return n
        }))
        return toDateString(addDays(weekStart, (maxRounds - 1) * 7 + 6))
      })()
    : null

  if (allEnds) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.from('seasons').update({ end_date: allEnds } as any).eq('id', seasonId)
  }

  return NextResponse.json({ created: results })
}
