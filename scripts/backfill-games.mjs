/** One-time backfill: import chess.com PGNs + derived stats for every
 *  historic match/tournament-match that predates the game-import hook added
 *  to app/api/matches/report and app/api/cron/check-results.
 *
 *  Idempotent: upserts into `games` keyed on chess_com_url, so re-running is
 *  safe and only fills in what's still missing.
 *
 *  Usage:
 *    node scripts/backfill-games.mjs --dry-run   # resolve and report, write nothing
 *    node scripts/backfill-games.mjs
 *
 *  Note: this file duplicates lib/pgn.ts, lib/chess-com.ts and lib/games.ts in
 *  plain JS because this is a standalone node script (no TypeScript loader
 *  configured for scripts/). Keep the two in sync if the parsing logic changes.
 */
import { createClient } from '@supabase/supabase-js'
import { Chess } from 'chess.js'
import { existsSync, readFileSync } from 'node:fs'

function loadEnv(path = '.env.local') {
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnv()

const DRY = process.argv.includes('--dry-run')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ---------------------------------------------------------------------------
// chess.com API (mirrors lib/chess-com.ts)
// ---------------------------------------------------------------------------

const CHESS_COM_BASE = 'https://api.chess.com/pub'

async function getMonthlyGames(username, year, month) {
  const mm = String(month).padStart(2, '0')
  try {
    const res = await fetch(
      `${CHESS_COM_BASE}/player/${username.toLowerCase()}/games/${year}/${mm}`,
      { headers: { 'User-Agent': 'chess-tournament-tracker/1.0 (backfill script)' } }
    )
    if (!res.ok) return []
    const data = await res.json()
    return data.games ?? []
  } catch {
    return []
  }
}

function findMatchGame(games, opponentUsername, startTs, endTs) {
  const opp = opponentUsername.toLowerCase()
  return (
    games.find((g) => {
      const isOpponent =
        g.white.username.toLowerCase() === opp || g.black.username.toLowerCase() === opp
      return isOpponent && g.end_time >= startTs && g.end_time <= endTs
    }) ?? null
  )
}

function deriveResult(game, whiteUsername) {
  const tournWhitePlayed =
    game.white.username.toLowerCase() === whiteUsername.toLowerCase() ? game.white : game.black
  const DRAW_RESULTS = ['agreed', 'stalemate', 'repetition', '50move', 'insufficient', 'timevsinsufficient']
  if (tournWhitePlayed.result === 'win') return 'white_wins'
  if (DRAW_RESULTS.includes(tournWhitePlayed.result)) return 'draw'
  return 'black_wins'
}

// ---------------------------------------------------------------------------
// PGN parsing (mirrors lib/pgn.ts)
// ---------------------------------------------------------------------------

const SCHOLARS_MATE_MAX_PLIES = 10
const BULLET_TRAIN_WINDOW = 5

function parseClockToSeconds(raw) {
  const parts = raw.trim().split(':').map(Number)
  if (parts.some((n) => Number.isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

function parseTimeControl(tc) {
  if (!tc) return { base: null, increment: 0 }
  const m = tc.match(/^(\d+)(?:\+(\d+))?$/)
  if (!m) return { base: null, increment: 0 }
  return { base: Number(m[1]), increment: m[2] ? Number(m[2]) : 0 }
}

function tokenizeMoves(pgn) {
  const blankLineIdx = pgn.search(/\n\s*\n/)
  const movetext = blankLineIdx === -1 ? pgn : pgn.slice(blankLineIdx)

  const tokens = []
  const TOKEN_RE = /([^\s{}]+)(\s*\{([^}]*)\})?/g
  let match
  while ((match = TOKEN_RE.exec(movetext)) !== null) {
    const raw = match[1]
    if (!raw) continue
    if (/^\d+\.+$/.test(raw)) continue
    if (raw.startsWith('$')) continue
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(raw)) continue

    const comment = match[3] ?? ''
    const clkMatch = comment.match(/\[%clk\s*([\d:.]+)\]/)
    tokens.push({ san: raw, clockSeconds: clkMatch ? parseClockToSeconds(clkMatch[1]) : null })
  }
  return tokens
}

function emptyColorStats() {
  return {
    captures: 0,
    checks: 0,
    kingWalkSquares: 0,
    bulletTrainSeconds: null,
    bulletTrainStartPly: null,
    brainFreezeSeconds: null,
    brainFreezePly: null,
    brainFreezeSan: null,
  }
}

/** Reads PGN headers directly with a regex rather than via chess.js, so
 *  headers are still available even for games chess.js can't load. */
function parseHeadersRaw(pgn) {
  const headers = {}
  const HEADER_RE = /^\[(\w+)\s+"([^"]*)"\]/gm
  let m
  while ((m = HEADER_RE.exec(pgn)) !== null) headers[m[1]] = m[2]
  return headers
}

function parseGameStats(pgn) {
  const headers = parseHeadersRaw(pgn)
  const clockTokens = tokenizeMoves(pgn)
  const { base, increment } = parseTimeControl(headers.TimeControl)

  const white = emptyColorStats()
  const black = emptyColorStats()
  const ownMoves = { w: [], b: [] }
  const lastClock = { w: base, b: base }
  let firstCaptureColor = null
  let plyCount = clockTokens.length

  // chess.js validates the resulting board position (and, for a custom start
  // FEN, its castling rights) even with strict:false, and throws on some real
  // chess.com games it considers invalid -- e.g. certain Chess960 starts. Board-
  // aware stats (captures/checks/king walk) are only available when this
  // succeeds; clock-based stats below fall back to move order alone, so a game
  // chess.js can't load still gets partial stats instead of blocking import.
  let verbose = null
  try {
    const chess = new Chess()
    chess.loadPgn(pgn, { strict: false })
    verbose = chess.history({ verbose: true })
    plyCount = verbose.length
  } catch {
    verbose = null
  }

  if (verbose) {
    verbose.forEach((move, ply) => {
      const color = move.color
      const stats = color === 'w' ? white : black

      if (move.captured) {
        stats.captures++
        if (firstCaptureColor === null) firstCaptureColor = color
      }
      if (move.san.includes('+') || move.san.includes('#')) stats.checks++

      if (move.piece === 'k') {
        const fromFile = move.from.charCodeAt(0)
        const fromRank = Number(move.from[1])
        const toFile = move.to.charCodeAt(0)
        const toRank = Number(move.to[1])
        stats.kingWalkSquares += Math.max(Math.abs(toFile - fromFile), Math.abs(toRank - fromRank))
      }

      const clockSeconds = clockTokens[ply]?.clockSeconds ?? null
      const prevClock = lastClock[color]
      const timeSpentSeconds =
        clockSeconds != null && prevClock != null
          ? Math.round(Math.max(0, prevClock + increment - clockSeconds) * 10) / 10
          : null
      if (clockSeconds != null) lastClock[color] = clockSeconds

      ownMoves[color].push({ ply, san: move.san, timeSpentSeconds })
    })
  } else {
    clockTokens.forEach((token, ply) => {
      const color = ply % 2 === 0 ? 'w' : 'b'
      const clockSeconds = token.clockSeconds
      const prevClock = lastClock[color]
      const timeSpentSeconds =
        clockSeconds != null && prevClock != null
          ? Math.round(Math.max(0, prevClock + increment - clockSeconds) * 10) / 10
          : null
      if (clockSeconds != null) lastClock[color] = clockSeconds
      ownMoves[color].push({ ply, san: token.san, timeSpentSeconds })
    })
  }

  for (const color of ['w', 'b']) {
    const stats = color === 'w' ? white : black
    const moves = ownMoves[color]

    for (const m of moves) {
      if (m.timeSpentSeconds != null && (stats.brainFreezeSeconds == null || m.timeSpentSeconds > stats.brainFreezeSeconds)) {
        stats.brainFreezeSeconds = m.timeSpentSeconds
        stats.brainFreezePly = m.ply
        stats.brainFreezeSan = m.san
      }
    }

    for (let i = 0; i + BULLET_TRAIN_WINDOW <= moves.length; i++) {
      const window = moves.slice(i, i + BULLET_TRAIN_WINDOW)
      if (window.some((m) => m.timeSpentSeconds == null)) continue
      const sum = Math.round(window.reduce((acc, m) => acc + m.timeSpentSeconds, 0) * 10) / 10
      if (stats.bulletTrainSeconds == null || sum < stats.bulletTrainSeconds) {
        stats.bulletTrainSeconds = sum
        stats.bulletTrainStartPly = window[0].ply
      }
    }
  }

  const startEpoch = headers.UTCDate && headers.UTCTime
    ? Date.parse(`${headers.UTCDate.replace(/\./g, '-')}T${headers.UTCTime}Z`)
    : NaN
  const endEpoch = headers.EndDate && headers.EndTime
    ? Date.parse(`${headers.EndDate.replace(/\./g, '-')}T${headers.EndTime}Z`)
    : NaN
  const durationSeconds =
    Number.isFinite(startEpoch) && Number.isFinite(endEpoch)
      ? Math.max(0, Math.round((endEpoch - startEpoch) / 1000))
      : null

  return {
    plyCount,
    durationSeconds,
    firstCaptureColor,
    isScholarsMate: plyCount <= SCHOLARS_MATE_MAX_PLIES && headers.Result !== '1/2-1/2',
    white,
    black,
  }
}

// ---------------------------------------------------------------------------
// Upsert (mirrors lib/games.ts)
// ---------------------------------------------------------------------------

async function upsertGame({ matchId, tournamentMatchId, whitePlayerId, blackPlayerId, result, chessGame }) {
  const stats = parseGameStats(chessGame.pgn)
  if (DRY) return { ok: true, stats }

  const { error } = await db.from('games').upsert(
    {
      match_id: matchId ?? null,
      tournament_match_id: tournamentMatchId ?? null,
      white_player_id: whitePlayerId,
      black_player_id: blackPlayerId,
      chess_com_url: chessGame.url,
      pgn: chessGame.pgn,
      result,
      time_control: chessGame.time_control ?? null,
      rules: chessGame.rules ?? null,
      time_class: chessGame.time_class ?? null,
      ply_count: stats.plyCount,
      end_time: new Date(chessGame.end_time * 1000).toISOString(),
      stats,
    },
    { onConflict: 'chess_com_url' }
  )
  if (error) throw new Error(`Failed to upsert game ${chessGame.url}: ${error.message}`)
  return { ok: true, stats }
}

function usernameOf(rel) {
  return Array.isArray(rel) ? rel[0]?.chess_com_username : rel?.chess_com_username
}

/** Search a username's archives across a date window (inclusive, unix ts) for
 *  a game against a given opponent. Fetches one archive month per calendar
 *  month spanned by the window. */
async function searchWindow(username, opponentUsername, startTs, endTs) {
  const start = new Date(startTs * 1000)
  const end = new Date(endTs * 1000)
  const found = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  while (cursor <= end) {
    const games = await getMonthlyGames(username, cursor.getFullYear(), cursor.getMonth() + 1)
    for (const g of games) {
      const isOpponent =
        g.white.username.toLowerCase() === opponentUsername.toLowerCase() ||
        g.black.username.toLowerCase() === opponentUsername.toLowerCase()
      if (isOpponent && g.end_time >= startTs && g.end_time <= endTs) found.push(g)
    }
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return found
}

// ---------------------------------------------------------------------------
// Pass 1: league matches
// ---------------------------------------------------------------------------

async function backfillLeagueMatches() {
  console.log('\n=== League matches ===')
  const { data: matches, error } = await db
    .from('matches')
    .select(`
      id, result, chess_com_game_url, scheduled_start, scheduled_end,
      white_player_id, black_player_id,
      white_player:players!white_player_id(chess_com_username),
      black_player:players!black_player_id(chess_com_username)
    `)
    .neq('result', 'pending')
  if (error) { console.error('Failed to read matches:', error.message); return }

  const { data: existingGames } = await db.from('games').select('chess_com_url').not('match_id', 'is', null)
  const alreadyImported = new Set((existingGames ?? []).map((g) => g.chess_com_url))

  let imported = 0
  const skipped = []

  for (const m of matches ?? []) {
    const whiteUsername = usernameOf(m.white_player)
    const blackUsername = usernameOf(m.black_player)
    if (!whiteUsername || !blackUsername) {
      skipped.push(`match ${m.id}: missing username`)
      continue
    }

    let game = null

    if (m.chess_com_game_url) {
      const idMatch = m.chess_com_game_url.match(/\/live\/(\d+)/)
      if (idMatch) {
        const end = new Date(m.scheduled_end)
        // Search both backward and forward from the scheduled month — makeup/late
        // games can be played well after the original scheduled window, so a
        // known game URL may only turn up in a later month's archive.
        for (let offset = -3; offset <= 2 && !game; offset++) {
          const d = new Date(end.getFullYear(), end.getMonth() - offset, 1)
          const games = await getMonthlyGames(whiteUsername, d.getFullYear(), d.getMonth() + 1)
          game = games.find((g) => g.url.includes(idMatch[1])) ?? null
        }
      }
    }

    if (!game) {
      const startTs = Math.floor(new Date(m.scheduled_start).getTime() / 1000)
      const endDate = new Date(m.scheduled_end)
      endDate.setHours(23, 59, 59, 999)
      const endTs = Math.floor(endDate.getTime() / 1000)
      const games = await getMonthlyGames(whiteUsername, endDate.getFullYear(), endDate.getMonth() + 1)
      game = findMatchGame(games, blackUsername, startTs, endTs)
    }

    if (!game) {
      skipped.push(`match ${m.id} (${whiteUsername} vs ${blackUsername}): game not found`)
      continue
    }
    if (alreadyImported.has(game.url)) continue

    const result = deriveResult(game, whiteUsername)
    await upsertGame({
      matchId: m.id,
      whitePlayerId: m.white_player_id,
      blackPlayerId: m.black_player_id,
      result,
      chessGame: game,
    })
    imported++
  }

  console.log(`Imported ${imported} league game(s).`)
  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`)
    for (const s of skipped) console.log(`  - ${s}`)
  }
}

// ---------------------------------------------------------------------------
// Pass 2: tournament matches
// ---------------------------------------------------------------------------

async function backfillTournamentMatches() {
  console.log('\n=== Tournament matches ===')
  const { data: matches, error } = await db
    .from('tournament_matches')
    .select(`
      id, player_a_id, player_b_id, score_a, score_b, winner_id,
      player_a:players!player_a_id(chess_com_username),
      player_b:players!player_b_id(chess_com_username),
      tournament:tournaments(id, start_date, end_date)
    `)
    .not('player_a_id', 'is', null)
    .not('player_b_id', 'is', null)
  if (error) { console.error('Failed to read tournament_matches:', error.message); return }

  const { data: existingGames } = await db.from('games').select('chess_com_url').not('tournament_match_id', 'is', null)
  const alreadyImported = new Set((existingGames ?? []).map((g) => g.chess_com_url))

  let imported = 0
  const skipped = []

  for (const m of matches ?? []) {
    const usernameA = usernameOf(m.player_a)
    const usernameB = usernameOf(m.player_b)
    if (!usernameA || !usernameB) {
      skipped.push(`tournament match ${m.id}: missing username`)
      continue
    }
    const decided = m.winner_id != null || m.score_a != null || m.score_b != null
    if (!decided) {
      skipped.push(`tournament match ${m.id}: not played yet`)
      continue
    }
    const t = Array.isArray(m.tournament) ? m.tournament[0] : m.tournament
    if (!t?.start_date) {
      skipped.push(`tournament match ${m.id}: parent tournament has no date window`)
      continue
    }
    const startTs = Math.floor(new Date(t.start_date).getTime() / 1000)
    const endDate = t.end_date ? new Date(t.end_date) : new Date()
    endDate.setHours(23, 59, 59, 999)
    const endTs = Math.floor(endDate.getTime() / 1000)

    const games = await searchWindow(usernameA, usernameB, startTs, endTs)
    if (!games.length) {
      skipped.push(`tournament match ${m.id} (${usernameA} vs ${usernameB}): no games found in window`)
      continue
    }

    for (const game of games) {
      if (alreadyImported.has(game.url)) continue
      const aIsWhite = game.white.username.toLowerCase() === usernameA.toLowerCase()
      const result = deriveResult(game, aIsWhite ? usernameA : usernameB)
      await upsertGame({
        tournamentMatchId: m.id,
        whitePlayerId: aIsWhite ? m.player_a_id : m.player_b_id,
        blackPlayerId: aIsWhite ? m.player_b_id : m.player_a_id,
        result,
        chessGame: game,
      })
      imported++
    }
  }

  console.log(`Imported ${imported} tournament game(s).`)
  if (skipped.length) {
    console.log(`Skipped ${skipped.length}:`)
    for (const s of skipped) console.log(`  - ${s}`)
  }
}

if (DRY) console.log('--dry-run: nothing will be written.')

await backfillLeagueMatches()
await backfillTournamentMatches()

console.log('\nDone.')
