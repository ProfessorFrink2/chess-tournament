/** Generate a round-robin schedule for a list of player IDs.
 *  Returns an array of weekly rounds; each round is an array of [white, black] pairs.
 *  Uses the circle (polygon) algorithm, which gives each player exactly one game per round.
 */
export function generateRoundRobin(playerIds: string[]): Array<Array<[string, string]>> {
  const ids = [...playerIds]
  // Pad to even count with a "bye" sentinel
  if (ids.length % 2 !== 0) ids.push('BYE')
  const n = ids.length
  const rounds: Array<Array<[string, string]>> = []

  for (let round = 0; round < n - 1; round++) {
    const pairs: Array<[string, string]> = []
    for (let i = 0; i < n / 2; i++) {
      const white = ids[i]
      const black = ids[n - 1 - i]
      if (white !== 'BYE' && black !== 'BYE') {
        // Alternate colors each round by checking round parity
        pairs.push(round % 2 === 0 ? [white, black] : [black, white])
      }
    }
    rounds.push(pairs)
    // Rotate all except the first element
    const last = ids.pop()!
    ids.splice(1, 0, last)
  }

  return rounds
}

/** Add days to a Date and return a new Date. */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** Format a Date as YYYY-MM-DD for Supabase. */
export function toDateString(date: Date): string {
  return date.toISOString().split('T')[0]
}
