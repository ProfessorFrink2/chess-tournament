import { createClient } from '@supabase/supabase-js'
import BracketTable from '@/components/BracketTable'
import MatchList from '@/components/MatchList'
import type { Player, Season, MatchWithPlayersAndGame } from '@/lib/database.types'

export const dynamic = 'force-dynamic'

async function getData(): Promise<{
  season: Season | null
  players: Player[]
  matches: MatchWithPlayersAndGame[]
}> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: season } = await db
    .from('seasons')
    .select('*')
    .eq('is_active', true)
    .eq('is_hidden', false)
    .single()

  if (!season) return { season: null, players: [], matches: [] }

  const [{ data: players }, { data: matches }] = await Promise.all([
    db.from('players').select('*').order('display_name'),
    db
      .from('matches')
      .select(`
        *,
        white_player:players!white_player_id(id, display_name, chess_com_username),
        black_player:players!black_player_id(id, display_name, chess_com_username),
        games(id, rules, time_control, starred)
      `)
      .eq('season_id', (season as Season).id)
      .order('week_number')
      .order('bracket'),
  ])

  return {
    season: season as Season,
    players: (players ?? []) as Player[],
    matches: (matches ?? []) as MatchWithPlayersAndGame[],
  }
}

export default async function Home() {
  const { season, players, matches } = await getData()

  if (!season) {
    return (
      <div className="text-center py-20">
        <h1 className="text-3xl font-bold mb-2">Chess Tournament</h1>
        <p className="text-gray-400">No active season. Check back soon!</p>
      </div>
    )
  }

  const aBracketPlayers = players.filter((p) => p.bracket === 'A')
  const bBracketPlayers = players.filter((p) => p.bracket === 'B')
  const aMatches = matches.filter((m) => m.bracket === 'A')
  const bMatches = matches.filter((m) => m.bracket === 'B')

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold">{season.name}</h1>
        <p className="text-gray-400 text-sm mt-1">
          {season.start_date} — {season.end_date}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section>
          <h2 className="text-xl font-semibold mb-4 text-amber-400">A Bracket</h2>
          <BracketTable players={aBracketPlayers} matches={aMatches} />
        </section>
        <section>
          <h2 className="text-xl font-semibold mb-4 text-blue-400">B Bracket</h2>
          <BracketTable players={bBracketPlayers} matches={bMatches} />
        </section>
      </div>

      <div className="mt-12">
        <h2 className="text-xl font-semibold mb-4">Recent & Upcoming Matches</h2>
        <MatchList matches={matches} />
      </div>
    </div>
  )
}
