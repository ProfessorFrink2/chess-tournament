/**
 * Sync Season 16 match results from chess.com game archives.
 *
 * Pass 1: game played between the two players on the exact scheduled date.
 * Pass 2: only ONE game between those players within ±30 days of scheduled date.
 *
 * Usage: node scripts/sync-season-16-results.mjs [--dry-run]
 */

import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnv(path = '.env.local') {
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnv()

const DRY = process.argv.includes('--dry-run')
const SEASON_ID = '27a29109-ec8d-4b13-a1d4-4c064867c310'
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ---------------------------------------------------------------------------
// Chess.com API helpers
// ---------------------------------------------------------------------------
const archiveCache = new Map() // "username/2026/07" → games array

async function fetchArchive(username, year, month) {
  const key = `${username.toLowerCase()}/${year}/${String(month).padStart(2, '0')}`
  if (archiveCache.has(key)) return archiveCache.get(key)
  const url = `https://api.chess.com/pub/player/${username.toLowerCase()}/games/${year}/${String(month).padStart(2, '0')}`
  await sleep(300) // respect chess.com rate limits
  let resp
  try {
    resp = await fetch(url, { headers: { 'User-Agent': 'chess-tournament-sync/1.0' } })
  } catch (e) {
    console.warn(`  [fetch error] ${url}: ${e.message}`)
    archiveCache.set(key, [])
    return []
  }
  if (resp.status === 404) {
    archiveCache.set(key, [])
    return []
  }
  if (!resp.ok) {
    console.warn(`  [HTTP ${resp.status}] ${url}`)
    archiveCache.set(key, [])
    return []
  }
  const json = await resp.json()
  const games = json.games ?? []
  archiveCache.set(key, games)
  return games
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/** Return all games between userA and userB in a given month. */
async function gamesInMonth(userA, userB, year, month) {
  const games = await fetchArchive(userA, year, month)
  const bLow = userB.toLowerCase()
  return games.filter(g =>
    (g.white?.username?.toLowerCase() === bLow) ||
    (g.black?.username?.toLowerCase() === bLow)
  )
}

/** Convert chess.com result strings to our DB enum or null.
 *  dbWhiteUser is the chess_com_username of our DB's white_player_id — chess.com
 *  assigns colors independently, so we must check who actually won and map back. */
function toResult(game, dbWhiteUser) {
  const wRes = game.white?.result
  const bRes = game.black?.result
  const DRAW_RESULTS = new Set(['agreed', 'stalemate', 'insufficient', 'timevsinsufficient', '50move', 'repetition', 'bughousecomp'])
  if (DRAW_RESULTS.has(wRes) || DRAW_RESULTS.has(bRes)) return 'draw'

  // Determine who won on chess.com by username
  let winnerUser = null
  if (wRes === 'win' || ['checkmated','timeout','resigned','abandoned'].includes(bRes)) {
    winnerUser = game.white?.username?.toLowerCase()
  } else if (bRes === 'win' || ['checkmated','timeout','resigned','abandoned'].includes(wRes)) {
    winnerUser = game.black?.username?.toLowerCase()
  }
  if (!winnerUser) return null

  // Map to DB result: did the DB white player win?
  return winnerUser === dbWhiteUser.toLowerCase() ? 'white_wins' : 'black_wins'
}

function isoDate(unixSec) {
  return new Date(unixSec * 1000).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Load pending matches
// ---------------------------------------------------------------------------
const { data: matches, error: matchErr } = await db
  .from('matches')
  .select(`
    id, bracket, week_number, scheduled_start, result,
    white_player:white_player_id ( id, display_name, chess_com_username ),
    black_player:black_player_id ( id, display_name, chess_com_username )
  `)
  .eq('season_id', SEASON_ID)
  .eq('result', 'pending')
  .order('week_number')

if (matchErr) { console.error(matchErr.message); process.exit(1) }
console.log(`${matches.length} pending matches to check\n`)

const updates = []
const WINDOW_DAYS = 30

for (const match of matches) {
  const wUser = match.white_player?.chess_com_username
  const bUser = match.black_player?.chess_com_username
  const wName = match.white_player?.display_name
  const bName = match.black_player?.display_name

  if (!wUser || !bUser) {
    console.log(`  SKIP (no chess.com username): ${wName} vs ${bName}`)
    continue
  }

  const scheduledDate = match.scheduled_start?.slice(0, 10) // "2026-07-07"
  const sched = new Date(scheduledDate + 'T00:00:00Z')
  const schedYear = sched.getUTCFullYear()
  const schedMonth = sched.getUTCMonth() + 1

  // Collect candidate months: the scheduled month ± 1
  const monthsToCheck = new Set()
  for (let d = -WINDOW_DAYS; d <= WINDOW_DAYS; d += 28) {
    const t = new Date(sched.getTime() + d * 86400000)
    monthsToCheck.add(`${t.getUTCFullYear()}/${t.getUTCMonth() + 1}`)
  }
  monthsToCheck.add(`${schedYear}/${schedMonth}`)

  // Fetch all games between the pair in those months
  let candidateGames = []
  for (const ym of monthsToCheck) {
    const [y, mo] = ym.split('/').map(Number)
    const g = await gamesInMonth(wUser, bUser, y, mo)
    candidateGames.push(...g)
  }
  // Deduplicate by game URL
  const seen = new Set()
  candidateGames = candidateGames.filter(g => { const k = g.url; if (seen.has(k)) return false; seen.add(k); return true })

  // Pass 1: exact date match
  const pass1 = candidateGames.filter(g => isoDate(g.end_time) === scheduledDate)
  // Pass 2: only one game within ±30 days
  const windowStart = sched.getTime() - WINDOW_DAYS * 86400000
  const windowEnd   = sched.getTime() + WINDOW_DAYS * 86400000
  const pass2 = candidateGames.filter(g => {
    const t = g.end_time * 1000
    return t >= windowStart && t <= windowEnd
  })

  const isLive = (g) => g.url?.includes('/game/live/')

  // Prefer live games over daily in any candidate set
  function preferLive(games) {
    const live = games.filter(isLive)
    return live.length > 0 ? live : games
  }

  // Pick closest game to scheduled date; returns [game] or [] if still tied
  function pickClosest(games) {
    const schedMs = sched.getTime()
    let best = null, bestDist = Infinity
    for (const g of games) {
      const dist = Math.abs(g.end_time * 1000 - schedMs)
      if (dist < bestDist) { bestDist = dist; best = g }
    }
    // Only use if clearly closest (not tied)
    const tied = games.filter(g => Math.abs(g.end_time * 1000 - schedMs) === bestDist)
    return tied.length === 1 ? [best] : []
  }

  let chosen = null
  let method = null

  if (pass1.length === 1) {
    chosen = pass1[0]
    method = 'exact date'
  } else if (pass1.length > 1) {
    const reduced = preferLive(pass1)
    if (reduced.length === 1) {
      chosen = reduced[0]; method = 'exact date (live preferred)'
    } else {
      console.log(`  AMBIGUOUS (${pass1.length} games on exact date): ${wName} vs ${bName} [week ${match.week_number}]`)
      for (const g of pass1) console.log(`    ${isoDate(g.end_time)} ${isLive(g) ? 'live' : 'daily'} ${g.url}`)
      continue
    }
  } else if (pass2.length === 1) {
    chosen = pass2[0]
    method = `only game ±30d (${isoDate(chosen.end_time)})`
  } else if (pass2.length > 1) {
    // Try: live-only first, then closest
    const liveOnly = preferLive(pass2)
    if (liveOnly.length === 1) {
      chosen = liveOnly[0]; method = `live game ±30d (${isoDate(chosen.end_time)})`
    } else {
      const closest = pickClosest(liveOnly)
      if (closest.length === 1) {
        chosen = closest[0]; method = `closest live game ±30d (${isoDate(chosen.end_time)})`
      } else {
        console.log(`  AMBIGUOUS (${pass2.length} games in ±30d window): ${wName} vs ${bName} [week ${match.week_number}]`)
        for (const g of pass2) console.log(`    ${isoDate(g.end_time)} ${isLive(g) ? 'live' : 'daily'} ${g.url}`)
        continue
      }
    }
  } else {
    console.log(`  NO MATCH: ${wName} vs ${bName} [week ${match.week_number}, ${scheduledDate}]`)
    continue
  }

  const result = toResult(chosen, wUser)
  if (!result) {
    console.log(`  UNKNOWN RESULT: ${wName} vs ${bName} — ${chosen.white?.result}/${chosen.black?.result}`)
    continue
  }

  console.log(`  [${method}] ${wName} vs ${bName} → ${result}  ${chosen.url}`)
  updates.push({ id: match.id, result, chess_com_game_url: chosen.url })
}

console.log(`\n${updates.length} matches resolved`)
if (DRY || updates.length === 0) {
  if (DRY) console.log('Dry run — no writes.')
  process.exit(0)
}

// Batch update
for (const u of updates) {
  const { error } = await db.from('matches').update({ result: u.result, chess_com_game_url: u.chess_com_game_url }).eq('id', u.id)
  if (error) console.error(`  Failed ${u.id}: ${error.message}`)
}
console.log('Done.')
