import Link from 'next/link'
import { createReadClient, FORMAT_LABELS, MEDALS, divisionLabel } from '@/lib/tournaments'
import type { Tournament, Season } from '@/lib/database.types'

export const dynamic = 'force-dynamic'

type PodiumRow = {
  tournament_id: string
  division: string | null
  final_placement: number
  player: { display_name: string } | null
}

// The index card shows the tournament's actual podium, so consolation brackets
// are excluded — their winner is not the division champion.

async function getData() {
  const db = createReadClient()

  const [{ data: tournaments }, { data: seasons }, { data: podium }] = await Promise.all([
    db.from('tournaments').select('*').eq('is_hidden', false).order('number', { ascending: false }),
    db.from('seasons').select('id, name, number').eq('is_hidden', false),
    db
      .from('tournament_entrants')
      .select('tournament_id, division, final_placement, player:players(display_name)')
      .eq('bracket_kind', 'championship')
      .not('final_placement', 'is', null)
      .lte('final_placement', 3)
      .order('final_placement'),
  ])

  return {
    tournaments: (tournaments ?? []) as Tournament[],
    seasons: (seasons ?? []) as Pick<Season, 'id' | 'name' | 'number'>[],
    podium: (podium ?? []) as unknown as PodiumRow[],
  }
}

export default async function TournamentsPage() {
  const { tournaments, seasons, podium } = await getData()

  if (tournaments.length === 0) {
    return (
      <div>
        <h1 className="text-3xl font-bold mb-2">Tournaments</h1>
        <p className="text-gray-400">No tournaments recorded yet.</p>
      </div>
    )
  }

  const seasonById = new Map(seasons.map((s) => [s.id, s]))

  // tournament id -> division -> placement-ordered names
  const podiumByTournament = new Map<string, Map<string | null, PodiumRow[]>>()
  for (const row of podium) {
    if (!podiumByTournament.has(row.tournament_id)) {
      podiumByTournament.set(row.tournament_id, new Map())
    }
    const byDivision = podiumByTournament.get(row.tournament_id)!
    if (!byDivision.has(row.division)) byDivision.set(row.division, [])
    byDivision.get(row.division)!.push(row)
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Tournaments</h1>
        <p className="text-gray-400 text-sm mt-1">
          {tournaments.length} tournament{tournaments.length === 1 ? '' : 's'} on record
        </p>
      </div>

      <div className="space-y-3">
        {tournaments.map((t) => {
          const season = t.season_id ? seasonById.get(t.season_id) : null
          const byDivision = podiumByTournament.get(t.id)

          return (
            <Link
              key={t.id}
              href={`/tournaments/${t.id}`}
              className="block bg-gray-900 border border-gray-800 rounded px-4 py-3 hover:border-gray-600 transition-colors"
            >
              <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <h2 className="font-semibold">
                  {t.name}
                  {t.is_active && (
                    <span className="ml-2 text-xs text-green-400 font-normal">Active</span>
                  )}
                </h2>
                <span className="text-xs text-gray-500">
                  {FORMAT_LABELS[t.format] ?? t.format}
                  {' · '}
                  {season ? season.name : 'No league season'}
                </span>
              </div>

              {byDivision && (
                <div className="mt-2 space-y-1">
                  {[...byDivision.entries()]
                    .sort(([a], [b]) => (a ?? '').localeCompare(b ?? ''))
                    .map(([division, rows]) => (
                      <div key={division ?? 'overall'} className="text-sm flex gap-3 flex-wrap">
                        {byDivision.size > 1 && (
                          <span className="text-gray-500 text-xs w-20 shrink-0 pt-0.5">
                            {divisionLabel(division)}
                          </span>
                        )}
                        <span className="flex gap-3 flex-wrap">
                          {rows.map((r) => (
                            <span key={r.final_placement} className="text-gray-300">
                              {MEDALS[r.final_placement - 1]} {r.player?.display_name ?? '—'}
                            </span>
                          ))}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
