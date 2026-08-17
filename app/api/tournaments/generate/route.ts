import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient, requireAdmin } from '@/lib/supabase'
import { generateSingleElim } from '@/lib/bracket'
import type { Bracket, BracketKind } from '@/lib/database.types'

/** Generate an empty single-elimination bracket for one division of a
 *  tournament, seeded from that division's entrants. Existing matches for the
 *  same division and bracket kind are replaced. */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied

  const db = createServiceClient()
  const { tournamentId, division, bracketKind = 'championship' } = await req.json()

  if (!tournamentId) {
    return NextResponse.json({ error: 'Missing tournamentId' }, { status: 400 })
  }

  const div = (division ?? null) as Bracket | null
  const kind = bracketKind as BracketKind

  let entrantQuery = db
    .from('tournament_entrants')
    .select('player_id, seed')
    .eq('tournament_id', tournamentId)
    .order('seed', { nullsFirst: false })

  entrantQuery = div ? entrantQuery.eq('division', div) : entrantQuery.is('division', null)

  const { data: entrants, error: entrantError } = await entrantQuery
  if (entrantError) {
    return NextResponse.json({ error: entrantError.message }, { status: 500 })
  }
  if (!entrants || entrants.length < 2) {
    return NextResponse.json(
      { error: 'Need at least 2 entrants in this division to generate a bracket' },
      { status: 400 }
    )
  }

  // Seed number -> player. Entrants without an explicit seed fall in after the
  // seeded ones, in the order the database returned them.
  const rows = entrants as { player_id: string; seed: number | null }[]
  const bySeed = new Map<number, string>()
  let nextSeed = 1
  for (const e of rows) {
    const seed = e.seed ?? nextSeed
    while (bySeed.has(nextSeed)) nextSeed++
    bySeed.set(seed, e.player_id)
    while (bySeed.has(nextSeed)) nextSeed++
  }

  const generated = generateSingleElim(rows.length)

  const matchRows = generated.map((m) => ({
    tournament_id: tournamentId,
    division: div,
    bracket_kind: kind,
    round: m.round,
    slot: m.slot,
    seed_a: m.seed_a,
    seed_b: m.seed_b,
    player_a_id: m.seed_a != null ? (bySeed.get(m.seed_a) ?? null) : null,
    player_b_id: m.seed_b != null ? (bySeed.get(m.seed_b) ?? null) : null,
  }))

  // Replace rather than accumulate, so regenerating is safe.
  let deleteQuery = db
    .from('tournament_matches')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('bracket_kind', kind)
  deleteQuery = div ? deleteQuery.eq('division', div) : deleteQuery.is('division', null)
  const { error: deleteError } = await deleteQuery
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error } = await db.from('tournament_matches').insert(matchRows as any).select('id, round, slot')
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Wire next_match_id: slot S in round R advances to slot ceil(S/2) in round R+1.
  const byRoundSlot = new Map<string, string>()
  for (const m of inserted ?? []) {
    byRoundSlot.set(`${m.round}:${m.slot}`, m.id)
  }
  for (const m of inserted ?? []) {
    const nextId = byRoundSlot.get(`${m.round + 1}:${Math.ceil(m.slot / 2)}`)
    if (!nextId) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.from('tournament_matches').update({ next_match_id: nextId } as any).eq('id', m.id)
  }

  return NextResponse.json({ created: matchRows.length })
}
