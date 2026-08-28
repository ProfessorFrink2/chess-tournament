/** One-time backfill: recompute `games.stats` for every existing row so it
 *  picks up the new `avgMoveTimeSeconds` field added to ColorStats in
 *  lib/pgn.ts. Re-derives everything from the `pgn` already stored in
 *  Postgres -- no chess.com API calls needed.
 *
 *  Idempotent: pure recomputation + overwrite, safe to re-run.
 *
 *  Usage:
 *    node scripts/backfill-move-times.mjs --dry-run   # report only, write nothing
 *    node scripts/backfill-move-times.mjs
 *
 *  Note: this file duplicates lib/pgn.ts's parseGameStats() in plain JS,
 *  same convention as scripts/backfill-games.mjs, because scripts/ has no
 *  TypeScript loader configured. Keep the two in sync if parsing changes.
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
    avgMoveTimeSeconds: null,
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

    const timedSeconds = []
    for (const m of moves) {
      if (m.timeSpentSeconds != null && (stats.brainFreezeSeconds == null || m.timeSpentSeconds > stats.brainFreezeSeconds)) {
        stats.brainFreezeSeconds = m.timeSpentSeconds
        stats.brainFreezePly = m.ply
        stats.brainFreezeSan = m.san
      }
      if (m.timeSpentSeconds != null) timedSeconds.push(m.timeSpentSeconds)
    }
    if (timedSeconds.length > 0) {
      stats.avgMoveTimeSeconds =
        Math.round((timedSeconds.reduce((a, b) => a + b, 0) / timedSeconds.length) * 10) / 10
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

const { data: games, error } = await db.from('games').select('id, pgn')
if (error) {
  console.error('Failed to read games:', error.message)
  process.exit(1)
}

console.log(`${DRY ? '[dry-run] ' : ''}Recomputing stats for ${games?.length ?? 0} game(s)...`)

let updated = 0
let withTiming = 0
let failed = 0

for (const g of games ?? []) {
  try {
    const stats = parseGameStats(g.pgn)
    if (stats.white.avgMoveTimeSeconds != null || stats.black.avgMoveTimeSeconds != null) {
      withTiming++
    }
    if (!DRY) {
      const { error: updateError } = await db.from('games').update({ stats }).eq('id', g.id)
      if (updateError) throw new Error(updateError.message)
    }
    updated++
  } catch (e) {
    failed++
    console.error(`  Failed on game ${g.id}: ${e.message}`)
  }
}

console.log(`\n${DRY ? 'Would update' : 'Updated'} ${updated} game(s), ${withTiming} with move-timing data, ${failed} failed.`)
