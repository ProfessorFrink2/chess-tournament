import { Chess } from 'chess.js'

/** Games ending in checkmate/resignation/etc. within this many plies (5 full
 *  moves) count as a "Scholar's Mate"-style quick decisive game. */
export const SCHOLARS_MATE_MAX_PLIES = 10

/** Number of consecutive own-moves in the "Bullet Train" fastest-sequence stat. */
const BULLET_TRAIN_WINDOW = 5

export type Color = 'w' | 'b'

export interface TimedMove {
  ply: number
  san: string
  timeSpentSeconds: number | null
}

export interface ColorStats {
  captures: number
  checks: number
  kingWalkSquares: number
  /** Shortest cumulative clock usage across BULLET_TRAIN_WINDOW consecutive
   *  own moves. Null if the player made fewer than that many moves, or clock
   *  data is unavailable. */
  bulletTrainSeconds: number | null
  bulletTrainStartPly: number | null
  /** Longest single move think time. */
  brainFreezeSeconds: number | null
  brainFreezePly: number | null
  brainFreezeSan: string | null
}

export interface ParsedGameStats {
  plyCount: number
  durationSeconds: number | null
  firstCaptureColor: Color | null
  isScholarsMate: boolean
  white: ColorStats
  black: ColorStats
}

function parseClockToSeconds(raw: string): number | null {
  const parts = raw.trim().split(':').map(Number)
  if (parts.some((n) => Number.isNaN(n))) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

/** "600+2" -> { base: 600, increment: 2 }. "600" -> { base: 600, increment: 0 }.
 *  Correspondence controls like "1/259200" aren't a base+increment shape --
 *  returns nulls so downstream clock-usage math is skipped for those games. */
function parseTimeControl(tc: string | undefined | null): { base: number | null; increment: number } {
  if (!tc) return { base: null, increment: 0 }
  const m = tc.match(/^(\d+)(?:\+(\d+))?$/)
  if (!m) return { base: null, increment: 0 }
  return { base: Number(m[1]), increment: m[2] ? Number(m[2]) : 0 }
}

/** Reads PGN headers directly with a regex rather than via chess.js, so
 *  headers are still available even for games chess.js can't load (see
 *  parseGameStats' fallback path below). */
function parseHeadersRaw(pgn: string): Record<string, string> {
  const headers: Record<string, string> = {}
  const HEADER_RE = /^\[(\w+)\s+"([^"]*)"\]/gm
  let m: RegExpExecArray | null
  while ((m = HEADER_RE.exec(pgn)) !== null) headers[m[1]] = m[2]
  return headers
}

interface MoveToken {
  san: string
  clockSeconds: number | null
}

/** Walks the PGN movetext in order, pairing each SAN move with the clock time
 *  (if any) from its trailing `{[%clk h:mm:ss]}` comment. Order matches
 *  chess.js's `history()` ply order. */
function tokenizeMoves(pgn: string): MoveToken[] {
  // Headers are a block of `[Key "Value"]` lines followed by a blank line;
  // movetext comments also contain `]` (e.g. `{[%clk 0:09:58]}`), so we can't
  // just find the last `]` in the whole string to locate the header/movetext
  // boundary -- split on the blank line instead.
  const blankLineIdx = pgn.search(/\n\s*\n/)
  const movetext = blankLineIdx === -1 ? pgn : pgn.slice(blankLineIdx)

  const tokens: MoveToken[] = []
  const TOKEN_RE = /([^\s{}]+)(\s*\{([^}]*)\})?/g
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(movetext)) !== null) {
    const raw = match[1]
    if (!raw) continue
    // Skip move numbers ("1." / "1..."), NAGs ("$1"), and the result token.
    if (/^\d+\.+$/.test(raw)) continue
    if (raw.startsWith('$')) continue
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(raw)) continue

    const comment = match[3] ?? ''
    const clkMatch = comment.match(/\[%clk\s*([\d:.]+)\]/)
    tokens.push({
      san: raw,
      clockSeconds: clkMatch ? parseClockToSeconds(clkMatch[1]) : null,
    })
  }
  return tokens
}

function emptyColorStats(): ColorStats {
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

export function parseGameStats(pgn: string): ParsedGameStats {
  const headers = parseHeadersRaw(pgn)
  const clockTokens = tokenizeMoves(pgn)
  const { base, increment } = parseTimeControl(headers.TimeControl)

  const white = emptyColorStats()
  const black = emptyColorStats()
  const ownMoves: Record<Color, TimedMove[]> = { w: [], b: [] }
  const lastClock: Record<Color, number | null> = { w: base, b: base }
  let firstCaptureColor: Color | null = null
  let plyCount = clockTokens.length

  // chess.js validates the resulting board position (and, for a custom start
  // FEN, its castling rights) even with strict:false, and throws on some real
  // chess.com games it considers invalid -- e.g. certain Chess960 starts. Board-
  // aware stats (captures/checks/king walk) are only available when this
  // succeeds; clock-based stats below fall back to move order alone, so a game
  // chess.js can't load still gets partial stats instead of blocking import.
  let verbose: ReturnType<Chess['history']> | null = null
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
      const color = move.color as Color
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
          // Round to avoid float drift from decimal clock values (e.g. "0:02:59.9").
          ? Math.round(Math.max(0, prevClock + increment - clockSeconds) * 10) / 10
          : null
      if (clockSeconds != null) lastClock[color] = clockSeconds

      ownMoves[color].push({ ply, san: move.san, timeSpentSeconds })
    })
  } else {
    // Move color alternates strictly by ply regardless of variant/start position.
    clockTokens.forEach((token, ply) => {
      const color: Color = ply % 2 === 0 ? 'w' : 'b'
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

  for (const color of ['w', 'b'] as Color[]) {
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
      const sum = Math.round(window.reduce((acc, m) => acc + (m.timeSpentSeconds as number), 0) * 10) / 10
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
