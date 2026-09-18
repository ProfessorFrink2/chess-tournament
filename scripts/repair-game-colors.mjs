/** One-time repair: chess.com assigns colors randomly per game, independent of the
 *  tournament's white/black label on the match row. Before this fix, the game importers
 *  (app/api/matches/report, app/api/cron/check-results, scripts/backfill-games.mjs's
 *  league-match pass) blindly copied the tournament's white_player_id/black_player_id
 *  into the `games` table, even though `games.stats.white`/`stats.black` are parsed
 *  straight from the PGN's *actual* colors. Whenever a player's real chess.com color
 *  differed from the tournament label, their per-color stats (captures/checks/king walk/
 *  move time) got attributed to their opponent instead.
 *
 *  This rewrites every `games` row's white_player_id/black_player_id/result to match the
 *  colors actually played in its own PGN, so they line up with stats.white/stats.black.
 *  Idempotent: rows that already match are left untouched, safe to re-run.
 *
 *  Usage:
 *    node scripts/repair-game-colors.mjs --dry-run   # report only, write nothing
 *    node scripts/repair-game-colors.mjs
 */
import { createClient } from '@supabase/supabase-js'
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

function parseHeadersRaw(pgn) {
  const headers = {}
  const HEADER_RE = /^\[(\w+)\s+"([^"]*)"\]/gm
  let m
  while ((m = HEADER_RE.exec(pgn)) !== null) headers[m[1]] = m[2]
  return headers
}

function resultFromPgnTag(tag) {
  if (tag === '1-0') return 'white_wins'
  if (tag === '0-1') return 'black_wins'
  if (tag === '1/2-1/2') return 'draw'
  return null
}

async function main() {
  if (DRY) console.log('--dry-run: nothing will be written.\n')

  const { data: players, error: playersErr } = await db.from('players').select('id, chess_com_username')
  if (playersErr) { console.error('Failed to read players:', playersErr.message); process.exit(1) }
  const usernameById = new Map(
    (players ?? []).map((p) => [p.id, p.chess_com_username?.toLowerCase() ?? null])
  )

  const { data: games, error: gamesErr } = await db
    .from('games')
    .select('id, match_id, tournament_match_id, white_player_id, black_player_id, pgn, result')
  if (gamesErr) { console.error('Failed to read games:', gamesErr.message); process.exit(1) }

  let scanned = 0
  let alreadyCorrect = 0
  let repaired = 0
  const unresolvable = []

  for (const g of games ?? []) {
    scanned++
    const headers = parseHeadersRaw(g.pgn)
    const pgnWhite = headers.White?.toLowerCase()
    const pgnBlack = headers.Black?.toLowerCase()
    if (!pgnWhite || !pgnBlack) {
      unresolvable.push(`game ${g.id}: no White/Black header in stored PGN`)
      continue
    }

    const storedWhiteUsername = usernameById.get(g.white_player_id)
    const storedBlackUsername = usernameById.get(g.black_player_id)

    if (storedWhiteUsername === pgnWhite && storedBlackUsername === pgnBlack) {
      alreadyCorrect++
      continue
    }

    if (storedWhiteUsername !== pgnBlack || storedBlackUsername !== pgnWhite) {
      // Doesn't even resolve as a straight swap — usernames don't match either
      // assignment, so don't guess.
      unresolvable.push(
        `game ${g.id}: stored (white=${storedWhiteUsername}, black=${storedBlackUsername}) ` +
        `doesn't match PGN (white=${pgnWhite}, black=${pgnBlack}) or its swap`
      )
      continue
    }

    const newResult = resultFromPgnTag(headers.Result)
    if (!newResult) {
      unresolvable.push(`game ${g.id}: unrecognized PGN Result tag "${headers.Result}"`)
      continue
    }

    const label = g.match_id ? `match ${g.match_id}` : `tournament match ${g.tournament_match_id}`
    console.log(
      `Repairing game ${g.id} (${label}): white/black swapped ` +
      `(${storedWhiteUsername} <-> ${storedBlackUsername}), result ${g.result} -> ${newResult}`
    )

    if (!DRY) {
      const { error } = await db
        .from('games')
        .update({
          white_player_id: g.black_player_id,
          black_player_id: g.white_player_id,
          result: newResult,
        })
        .eq('id', g.id)
      if (error) {
        console.error(`  Failed to update game ${g.id}:`, error.message)
        continue
      }
    }
    repaired++
  }

  console.log(`\nScanned ${scanned} game(s): ${alreadyCorrect} already correct, ${repaired} repaired${DRY ? ' (dry-run)' : ''}.`)
  if (unresolvable.length) {
    console.log(`${unresolvable.length} unresolvable:`)
    for (const u of unresolvable) console.log(`  - ${u}`)
  }
}

await main()
