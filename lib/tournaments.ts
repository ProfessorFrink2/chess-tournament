import { createClient } from '@supabase/supabase-js'

/** Read-only client for public tournament data (RLS allows anon select). */
export function createReadClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export const MEDALS = ['🥇', '🥈', '🥉'] as const

export const FORMAT_LABELS: Record<string, string> = {
  single_elim: 'Single elimination',
  double_elim: 'Double elimination',
  round_robin: 'Round robin',
  random_wheel: 'Random wheel',
  mixed: 'Mixed',
}

/** Which field of entrants a bracket draws from.
 *
 *  A consolation bracket is a separate competition with its own winner. The
 *  winners and losers sides of a double elimination are two sheets of the SAME
 *  competition, so they share one entrant list and one podium — tournament 12's
 *  B division champion came through the losers side and is still the champion.
 */
export function entrantBracketFor(kind: string): 'championship' | 'consolation' {
  return kind === 'consolation' ? 'consolation' : 'championship'
}

export const BRACKET_KIND_LABELS: Record<string, string> = {
  championship: 'Championship',
  consolation: 'Consolation',
  winners: 'Winners side',
  losers: 'Losers side',
}

/** Player-facing name for a division.
 *
 *  A bare letter reads better prefixed ("A" -> "Division A"), but the historic
 *  data also has divisions that are already full names -- city names from
 *  tournament 3's group stage, and qualified names like "A (Bogdan)" or
 *  "B (X)" -- which are shown verbatim. */
export function divisionLabel(division: string | null): string {
  if (!division) return 'Overall'
  return /^[A-Z]$/.test(division) ? `Division ${division}` : division
}
