import { createServiceClient } from '@/lib/supabase'
import { Game } from '@/lib/database.types'
import { ColorStats, ParsedGameStats } from '@/lib/pgn'

type Db = ReturnType<typeof createServiceClient>

interface OpponentTally {
  playerId: string
  displayName: string
  wins: number
  losses: number
  gamesPlayed: number
}

interface FormatBucket {
  label: string
  wins: number
  draws: number
  losses: number
  winRate: number | null
}

export interface PlayerStats {
  gamesPlayed: number
  trophies: number
  longestGame: { plyCount: number; opponentName: string; url: string; endTime: string } | null
  shortestGame: { plyCount: number; opponentName: string; url: string; endTime: string } | null
  nemesis: { name: string; losses: number; gamesPlayed: number } | null
  victim: { name: string; wins: number; gamesPlayed: number } | null
  formatBias: { standard: FormatBucket | null; chess960: FormatBucket | null }
  bulletTrain: { seconds: number; opponentName: string; url: string; startPly: number | null } | null
  brainFreeze: { seconds: number; san: string; opponentName: string; url: string; ply: number | null } | null
  greedyCaptures: { total: number; mostInOneGame: { count: number; opponentName: string; url: string } | null }
  checkSpammer: { total: number }
  kingWalkSquares: { total: number }
  firstBloodRate: number | null
  scholarsMateCount: number
  longestWinStreak: number
  longestLossStreak: number
  favoriteOpening: { moves: string; count: number } | null
  colorSplit: { whiteWinRate: number | null; blackWinRate: number | null }
  colorOutcomes: {
    white: { wins: number; draws: number; losses: number }
    black: { wins: number; draws: number; losses: number }
  }
  decisiveGameRate: number | null
  avgGameLength: number | null
  perGameRates: { captures: number; checks: number; kingWalkSquares: number } | null
  avgMoveTimeSeconds: number | null
  openingVariety: number
  recentWinRate: { label: string; value: number }[]
  recentAvgMoveTime: { label: string; value: number }[]
  recentGameLength: { label: string; value: number }[]
}

/** Short chart label for a single game, e.g. 'Aug 25'. One game per bar --
 *  players play at most one game per week, so bucketing/averaging by week
 *  is equivalent to per-game and just obscures individual-game swings. */
function gameLabel(isoDateStr: string): string {
  return new Date(isoDateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function openingKey(pgn: string): string | null {
  const blankLineIdx = pgn.search(/\n\s*\n/)
  const movetext = blankLineIdx === -1 ? pgn : pgn.slice(blankLineIdx)
  const moves = movetext
    .replace(/\{[^}]*\}/g, '')
    .split(/\s+/)
    .filter((t) => t && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
    .slice(0, 6)
  return moves.length >= 4 ? moves.join(' ') : null
}

export async function getPlayerStats(db: Db, playerId: string): Promise<PlayerStats> {
  const [{ data: games }, { data: seasonWins }, { data: tournamentWins }, { data: players }] =
    await Promise.all([
      db
        .from('games')
        .select('*')
        .or(`white_player_id.eq.${playerId},black_player_id.eq.${playerId}`)
        .order('end_time', { ascending: true }),
      db.from('season_standings').select('id').eq('player_id', playerId).eq('rank', 1),
      db
        .from('tournament_entrants')
        .select('id')
        .eq('player_id', playerId)
        .eq('bracket_kind', 'championship')
        .eq('final_placement', 1),
      db.from('players').select('id, display_name'),
    ])

  const nameById = new Map((players ?? []).map((p) => [(p as { id: string; display_name: string }).id, (p as { id: string; display_name: string }).display_name]))

  const rows = (games ?? []) as Game[]

  const trophies = (seasonWins?.length ?? 0) + (tournamentWins?.length ?? 0)

  let longestGame: PlayerStats['longestGame'] = null
  let shortestGame: PlayerStats['shortestGame'] = null
  const opponents = new Map<string, OpponentTally>()
  const standardBucket: FormatBucket = { label: '10+2', wins: 0, draws: 0, losses: 0, winRate: null }
  const chess960Bucket: FormatBucket = { label: 'Chess960', wins: 0, draws: 0, losses: 0, winRate: null }
  let bulletTrain: PlayerStats['bulletTrain'] = null
  let brainFreeze: PlayerStats['brainFreeze'] = null
  let totalCaptures = 0
  let mostCapturesGame: PlayerStats['greedyCaptures']['mostInOneGame'] = null
  let totalChecks = 0
  let totalKingWalk = 0
  let firstBloodWins = 0
  let firstBloodEligible = 0
  let scholarsMateCount = 0
  const openingCounts = new Map<string, number>()
  let whiteWins = 0
  let whiteDraws = 0
  let whiteLosses = 0
  let whiteGames = 0
  let blackWins = 0
  let blackDraws = 0
  let blackLosses = 0
  let blackGames = 0
  let decisive = 0

  let currentStreak: 'win' | 'loss' | null = null
  let currentStreakLen = 0
  let longestWinStreak = 0
  let longestLossStreak = 0

  let totalPlies = 0
  const moveTimeSamples: number[] = []
  const recentWinRate: { label: string; value: number }[] = []
  const recentGameLength: { label: string; value: number }[] = []
  const recentAvgMoveTime: { label: string; value: number }[] = []

  for (const g of rows) {
    const isWhite = g.white_player_id === playerId
    const opponentId = isWhite ? g.black_player_id : g.white_player_id
    const opponentName = nameById.get(opponentId) ?? 'Unknown'
    const won = (isWhite && g.result === 'white_wins') || (!isWhite && g.result === 'black_wins')
    const lost = (isWhite && g.result === 'black_wins') || (!isWhite && g.result === 'white_wins')
    const drew = g.result === 'draw'

    totalPlies += g.ply_count

    const label = gameLabel(g.end_time)
    recentWinRate.push({ label, value: won ? 100 : drew ? 50 : 0 })
    recentGameLength.push({ label, value: g.ply_count })

    if (!longestGame || g.ply_count > longestGame.plyCount) {
      longestGame = { plyCount: g.ply_count, opponentName, url: g.chess_com_url, endTime: g.end_time }
    }
    if (!shortestGame || g.ply_count < shortestGame.plyCount) {
      shortestGame = { plyCount: g.ply_count, opponentName, url: g.chess_com_url, endTime: g.end_time }
    }

    const tally = opponents.get(opponentId) ?? { playerId: opponentId, displayName: opponentName, wins: 0, losses: 0, gamesPlayed: 0 }
    tally.gamesPlayed++
    if (won) tally.wins++
    if (lost) tally.losses++
    opponents.set(opponentId, tally)

    if (g.rules === 'chess960') {
      if (won) chess960Bucket.wins++
      else if (lost) chess960Bucket.losses++
      else chess960Bucket.draws++
    } else if (g.time_control === '600+2') {
      if (won) standardBucket.wins++
      else if (lost) standardBucket.losses++
      else standardBucket.draws++
    }

    const stats = g.stats as ParsedGameStats
    const mine: ColorStats | undefined = isWhite ? stats?.white : stats?.black

    if (mine) {
      totalCaptures += mine.captures
      if (!mostCapturesGame || mine.captures > mostCapturesGame.count) {
        mostCapturesGame = { count: mine.captures, opponentName, url: g.chess_com_url }
      }
      totalChecks += mine.checks
      totalKingWalk += mine.kingWalkSquares
      if (mine.avgMoveTimeSeconds != null) {
        moveTimeSamples.push(mine.avgMoveTimeSeconds)
        recentAvgMoveTime.push({ label, value: mine.avgMoveTimeSeconds })
      }

      if (mine.bulletTrainSeconds != null && (bulletTrain == null || mine.bulletTrainSeconds < bulletTrain.seconds)) {
        bulletTrain = { seconds: mine.bulletTrainSeconds, opponentName, url: g.chess_com_url, startPly: mine.bulletTrainStartPly }
      }
      if (mine.brainFreezeSeconds != null && (brainFreeze == null || mine.brainFreezeSeconds > brainFreeze.seconds)) {
        brainFreeze = { seconds: mine.brainFreezeSeconds, san: mine.brainFreezeSan ?? '', opponentName, url: g.chess_com_url, ply: mine.brainFreezePly }
      }
    }

    if (stats?.firstCaptureColor != null) {
      firstBloodEligible++
      const myColor = isWhite ? 'w' : 'b'
      if (stats.firstCaptureColor === myColor) firstBloodWins++
    }

    if (stats?.isScholarsMate && (won || lost)) scholarsMateCount++

    const key = openingKey(g.pgn)
    if (key) openingCounts.set(key, (openingCounts.get(key) ?? 0) + 1)

    if (isWhite) {
      whiteGames++
      if (won) whiteWins++
      else if (lost) whiteLosses++
      else whiteDraws++
    } else {
      blackGames++
      if (won) blackWins++
      else if (lost) blackLosses++
      else blackDraws++
    }

    if (!drew) decisive++

    if (won) {
      currentStreakLen = currentStreak === 'win' ? currentStreakLen + 1 : 1
      currentStreak = 'win'
      longestWinStreak = Math.max(longestWinStreak, currentStreakLen)
    } else if (lost) {
      currentStreakLen = currentStreak === 'loss' ? currentStreakLen + 1 : 1
      currentStreak = 'loss'
      longestLossStreak = Math.max(longestLossStreak, currentStreakLen)
    } else {
      currentStreak = null
      currentStreakLen = 0
    }
  }

  let nemesis: PlayerStats['nemesis'] = null
  let victim: PlayerStats['victim'] = null
  for (const o of opponents.values()) {
    if (o.losses > 0 && (!nemesis || o.losses > nemesis.losses || (o.losses === nemesis.losses && o.gamesPlayed > nemesis.gamesPlayed))) {
      nemesis = { name: o.displayName, losses: o.losses, gamesPlayed: o.gamesPlayed }
    }
    if (o.wins > 0 && (!victim || o.wins > victim.wins || (o.wins === victim.wins && o.gamesPlayed > victim.gamesPlayed))) {
      victim = { name: o.displayName, wins: o.wins, gamesPlayed: o.gamesPlayed }
    }
  }

  let favoriteOpening: PlayerStats['favoriteOpening'] = null
  for (const [moves, count] of openingCounts) {
    if (!favoriteOpening || count > favoriteOpening.count) favoriteOpening = { moves, count }
  }

  function finalizeBucket(b: FormatBucket): FormatBucket | null {
    const total = b.wins + b.draws + b.losses
    if (total === 0) return null
    return { ...b, winRate: b.wins / total }
  }

  return {
    gamesPlayed: rows.length,
    trophies,
    longestGame,
    shortestGame,
    nemesis,
    victim,
    formatBias: {
      standard: finalizeBucket(standardBucket),
      chess960: finalizeBucket(chess960Bucket),
    },
    bulletTrain,
    brainFreeze,
    greedyCaptures: { total: totalCaptures, mostInOneGame: mostCapturesGame },
    checkSpammer: { total: totalChecks },
    kingWalkSquares: { total: totalKingWalk },
    firstBloodRate: firstBloodEligible > 0 ? firstBloodWins / firstBloodEligible : null,
    scholarsMateCount,
    longestWinStreak,
    longestLossStreak,
    favoriteOpening,
    colorSplit: {
      whiteWinRate: whiteGames > 0 ? whiteWins / whiteGames : null,
      blackWinRate: blackGames > 0 ? blackWins / blackGames : null,
    },
    colorOutcomes: {
      white: { wins: whiteWins, draws: whiteDraws, losses: whiteLosses },
      black: { wins: blackWins, draws: blackDraws, losses: blackLosses },
    },
    decisiveGameRate: rows.length > 0 ? decisive / rows.length : null,
    avgGameLength: rows.length > 0 ? totalPlies / rows.length : null,
    perGameRates: rows.length > 0
      ? { captures: totalCaptures / rows.length, checks: totalChecks / rows.length, kingWalkSquares: totalKingWalk / rows.length }
      : null,
    avgMoveTimeSeconds: moveTimeSamples.length > 0
      ? moveTimeSamples.reduce((a, b) => a + b, 0) / moveTimeSamples.length
      : null,
    openingVariety: openingCounts.size,
    recentWinRate: recentWinRate.slice(-12),
    recentAvgMoveTime: recentAvgMoveTime.slice(-12),
    recentGameLength: recentGameLength.slice(-12),
  }
}
