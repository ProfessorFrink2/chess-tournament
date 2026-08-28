import Link from 'next/link'
import { notFound } from 'next/navigation'
import TournamentBracket from '@/components/TournamentBracket'
import StandingsTable, { StandingRow } from '@/components/StandingsTable'
import {
  createReadClient,
  FORMAT_LABELS,
  BRACKET_KIND_LABELS,
  podiumIcon,
  divisionLabel,
  entrantBracketFor,
} from '@/lib/tournaments'
import type {
  DivisionKey,
  Tournament,
  Season,
  TournamentDivision,
  TournamentEntrantWithPlayer,
  TournamentMatchWithPlayers,
  SeasonStandingWithPlayer,
} from '@/lib/database.types'

export const dynamic = 'force-dynamic'

async function getData(id: string) {
  const db = createReadClient()

  const { data: tournament } = await db
    .from('tournaments')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!tournament || (tournament as Tournament).is_hidden) return null
  const t = tournament as Tournament

  const playerCols = 'id, display_name, chess_com_username'

  const [{ data: divisions }, { data: entrants }, { data: matches }] = await Promise.all([
    db.from('tournament_divisions').select('*').eq('tournament_id', id).order('division'),
    db
      .from('tournament_entrants')
      .select(`*, player:players(${playerCols})`)
      .eq('tournament_id', id)
      .order('seed', { nullsFirst: false }),
    db
      .from('tournament_matches')
      .select(
        `*, player_a:players!player_a_id(${playerCols}), player_b:players!player_b_id(${playerCols})`
      )
      .eq('tournament_id', id)
      .order('round')
      .order('slot'),
  ])

  let season: Season | null = null
  let standings: SeasonStandingWithPlayer[] = []
  if (t.season_id) {
    const [{ data: s }, { data: st }] = await Promise.all([
      db.from('seasons').select('*').eq('id', t.season_id).maybeSingle(),
      db
        .from('season_standings')
        .select(`*, player:players(${playerCols})`)
        .eq('season_id', t.season_id)
        .order('division')
        .order('rank'),
    ])
    season = (s ?? null) as Season | null
    standings = (st ?? []) as unknown as SeasonStandingWithPlayer[]
  }

  return {
    tournament: t,
    season,
    standings,
    divisions: (divisions ?? []) as TournamentDivision[],
    entrants: (entrants ?? []) as unknown as TournamentEntrantWithPlayer[],
    matches: (matches ?? []) as unknown as TournamentMatchWithPlayers[],
  }
}

function Tabs({
  options,
  active,
  hrefFor,
}: {
  options: { key: string; label: string }[]
  active: string
  hrefFor: (key: string) => string
}) {
  if (options.length <= 1) return null
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map((o) => (
        <Link
          key={o.key}
          href={hrefFor(o.key)}
          className={`px-3 py-1 rounded text-sm border transition-colors ${
            o.key === active
              ? 'bg-white text-gray-900 border-white font-medium'
              : 'border-gray-700 text-gray-400 hover:border-gray-500'
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  )
}

export default async function TournamentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ division?: string; bracket?: string }>
}) {
  const { id } = await params
  const query = await searchParams
  const data = await getData(id)
  if (!data) notFound()

  const { tournament, season, standings, divisions, entrants, matches } = data

  // Which divisions exist, in a stable order. Fall back to whatever the
  // entrants/matches mention, so a tournament works even without division rows.
  const divisionKeys: DivisionKey[] = divisions.length
    ? divisions.map((d) => d.division)
    : [
        ...new Set(
          [...entrants, ...matches].map((r) => r.division).filter((d): d is DivisionKey => d != null)
        ),
      ].sort()

  const hasDivisions = divisionKeys.length > 0
  const requestedDivision = query.division
  const activeDivision: DivisionKey | null =
    requestedDivision && divisionKeys.includes(requestedDivision)
      ? requestedDivision
      : (divisionKeys[0] ?? null)

  const divisionMatches = matches.filter((m) => m.division === activeDivision)
  const divisionEntrants = entrants.filter((e) => e.division === activeDivision)

  // A division can hold several brackets (championship + consolation, or the
  // two sides of a double elimination draw). Entrants carry a bracket_kind too,
  // so a consolation winner is not confused with the division champion.
  // Tabs come from the matches. Entrant bracket kinds are only a fallback for a
  // bracket with entrants but no recorded matches — otherwise a double
  // elimination would sprout an empty "Championship" tab alongside its real
  // winners and losers sides.
  const matchKinds = [...new Set(divisionMatches.map((m) => m.bracket_kind))].sort()
  const bracketKinds = matchKinds.length
    ? matchKinds
    : [...new Set(divisionEntrants.map((e) => e.bracket_kind))].sort()

  const activeBracket =
    query.bracket && bracketKinds.includes(query.bracket as never)
      ? query.bracket
      : (bracketKinds[0] ?? 'championship')

  const bracketMatches = divisionMatches.filter((m) => m.bracket_kind === activeBracket)
  const bracketEntrants = divisionEntrants.filter(
    (e) => e.bracket_kind === entrantBracketFor(activeBracket)
  )

  const podium = bracketEntrants
    .filter((e) => e.final_placement != null && e.final_placement <= 3)
    .sort((a, b) => (a.final_placement ?? 0) - (b.final_placement ?? 0))

  // A season's groups do not always line up with the playoff divisions.
  // Tournament 10 ran two round robins, "A (Alicia)" and "A (Bogdan)", whose
  // qualifiers merged into one A bracket; tournament 12 did the same with
  // "B (X)" and "B (Z)". Tournament 3's group stage used city names that map to
  // no playoff division at all. So: prefer the groups belonging to the active
  // division, and fall back to showing every group when none of them match.
  const allStandingsDivisions = [...new Set(standings.map((s) => s.division))].sort()
  const matchingDivisions = activeDivision
    ? allStandingsDivisions.filter(
        (d) => d === activeDivision || d.startsWith(`${activeDivision} (`)
      )
    : allStandingsDivisions
  const shownStandingsDivisions = matchingDivisions.length
    ? matchingDivisions
    : allStandingsDivisions

  const standingsGroups: { division: string; rows: StandingRow[] }[] =
    shownStandingsDivisions.map((division) => ({
      division,
      rows: standings
        .filter((s) => s.division === division)
        .map((s) => ({
          player: s.player,
          wins: s.wins,
          draws: s.draws,
          losses: s.losses,
          points: s.points,
          rank: s.rank,
        })),
    }))

  const base = `/tournaments/${tournament.id}`

  return (
    <div className="space-y-8">
      <div>
        <Link href="/tournaments" className="text-sm text-gray-500 hover:text-gray-300">
          ← All tournaments
        </Link>
        <h1 className="text-3xl font-bold mt-2">{tournament.name}</h1>
        <p className="text-gray-400 text-sm mt-1">
          {FORMAT_LABELS[tournament.format] ?? tournament.format}
          {' · '}
          {season ? (
            <>Seeded from {season.name}</>
          ) : (
            <>Standalone — no league season</>
          )}
        </p>
      </div>

      <Tabs
        options={divisionKeys.map((d) => ({ key: d, label: divisionLabel(d) }))}
        active={activeDivision ?? ''}
        hrefFor={(d) => `${base}?division=${d}`}
      />

      {podium.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">
            Podium
            {bracketKinds.some((k) => entrantBracketFor(k) === 'consolation') && (
              <span className="text-gray-500 text-sm font-normal ml-2">
                — {entrantBracketFor(activeBracket) === 'consolation' ? 'Consolation' : 'Main draw'}
              </span>
            )}
          </h2>
          <div className="flex gap-3 flex-wrap">
            {podium.map((e) => {
              const { icon, className } = podiumIcon(activeDivision, e.final_placement ?? 1)
              return (
                <div
                  key={e.id}
                  className="bg-gray-900 border border-gray-800 rounded px-4 py-2 text-sm"
                >
                  <span className={`mr-2 ${className}`}>{icon}</span>
                  <span className="font-medium">{e.player?.display_name ?? '—'}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className="text-lg font-semibold">Bracket</h2>
          <Tabs
            options={bracketKinds.map((k) => ({
              key: k,
              label: BRACKET_KIND_LABELS[k] ?? k,
            }))}
            active={activeBracket}
            hrefFor={(k) =>
              `${base}?${activeDivision ? `division=${activeDivision}&` : ''}bracket=${k}`
            }
          />
        </div>

        {bracketMatches.length > 0 ? (
          <TournamentBracket matches={bracketMatches} bracketKind={activeBracket} />
        ) : (
          <p className="text-gray-500 text-sm">
            No bracket was recorded for this tournament — only the final placements are known.
          </p>
        )}
      </section>

      {bracketEntrants.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">
            Entrants{' '}
            <span className="text-gray-500 text-sm font-normal">
              ({bracketEntrants.length})
            </span>
          </h2>
          <div className="flex gap-2 flex-wrap text-sm">
            {bracketEntrants.map((e) => (
              <span
                key={e.id}
                className="bg-gray-900 border border-gray-800 rounded px-2 py-1 text-gray-300"
              >
                {e.seed != null && <span className="text-gray-600 mr-1">({e.seed})</span>}
                {e.player?.display_name ?? '—'}
              </span>
            ))}
          </div>
        </section>
      )}

      {standingsGroups.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">
            League standings
            {season && (
              <span className="text-gray-500 text-sm font-normal ml-2">{season.name}</span>
            )}
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {standingsGroups.map((g) => (
              <div key={g.division}>
                {allStandingsDivisions.length > 1 && (
                  <h3 className="text-sm text-gray-400 mb-2">{divisionLabel(g.division)}</h3>
                )}
                <StandingsTable rows={g.rows} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
