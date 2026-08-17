/** Standard single-elimination bracket construction.
 *
 *  Note the historic import does NOT use this — those brackets are transcribed
 *  slot-for-slot from the source PDFs, several of which are irregular (e.g.
 *  tournament 14 gave the top 4 seeds two byes and seeds 5-10 one bye). This is
 *  for generating a fresh, well-formed bracket for a NEW tournament.
 */

export interface GeneratedMatch {
  round: number
  slot: number
  /** 1-based seed, or null for an empty half (a bye). */
  seed_a: number | null
  seed_b: number | null
}

/** Seed order for a bracket of `size` (a power of two), so that the top seeds
 *  meet as late as possible: for size 8 this yields 1v8, 4v5, 2v7, 3v6. */
export function seedOrder(size: number): number[] {
  let order = [1, 2]
  while (order.length < size) {
    const n = order.length * 2
    const next: number[] = []
    for (const s of order) {
      next.push(s, n + 1 - s)
    }
    order = next
  }
  return order
}

/** Build all rounds of a single-elimination bracket for `entrantCount` players.
 *  Byes are given to the top seeds by padding up to the next power of two. */
export function generateSingleElim(entrantCount: number): GeneratedMatch[] {
  if (entrantCount < 2) return []

  const size = 2 ** Math.ceil(Math.log2(entrantCount))
  const order = seedOrder(size)
  const matches: GeneratedMatch[] = []

  // Round 1: pair off the seed order, dropping seeds beyond entrantCount.
  for (let i = 0; i < size / 2; i++) {
    const a = order[i * 2]
    const b = order[i * 2 + 1]
    matches.push({
      round: 1,
      slot: i + 1,
      seed_a: a <= entrantCount ? a : null,
      seed_b: b <= entrantCount ? b : null,
    })
  }

  // Later rounds are empty shells; winners get filled in as results are entered.
  let remaining = size / 2
  let round = 2
  while (remaining > 1) {
    remaining = remaining / 2
    for (let i = 0; i < remaining; i++) {
      matches.push({ round, slot: i + 1, seed_a: null, seed_b: null })
    }
    round++
  }

  return matches
}

/** Number of rounds a single-elimination bracket of this size needs. */
export function roundCount(entrantCount: number): number {
  if (entrantCount < 2) return 0
  return Math.ceil(Math.log2(entrantCount))
}
