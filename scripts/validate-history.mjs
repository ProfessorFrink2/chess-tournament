/** Structural checks on the transcribed history in data/tournaments/.
 *
 *  Runs with no database and no network. The point is to catch transcription
 *  slips -- a winner who is not in the match, a name that appears in a bracket
 *  but nowhere in the roster, points that do not match wins/draws -- before any
 *  of it reaches Supabase.
 *
 *  Usage: node scripts/validate-history.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'data/tournaments'
const errors = []
const warnings = []

function err(t, msg) { errors.push(`T${t}: ${msg}`) }
function warn(t, msg) { warnings.push(`T${t}: ${msg}`) }

/** Every bracket in a division, with the entrant list that belongs to it.
 *  A consolation has its own field; winners and losers share the main draw's. */
function bracketsOf(div) {
  const out = []
  const main = div.entrants ?? []
  if (div.matches) out.push(['championship', div.matches, main])
  if (div.consolation?.matches) {
    out.push(['consolation', div.consolation.matches, div.consolation.entrants ?? []])
  }
  if (div.winners) out.push(['winners', div.winners, main])
  if (div.losers) out.push(['losers', div.losers, main])
  return out
}

function entrantsOf(div) {
  return [...(div.entrants ?? []), ...(div.consolation?.entrants ?? [])]
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
const seenNumbers = new Set()
const globalNameToUsernames = new Map()

for (const file of files) {
  const doc = JSON.parse(readFileSync(join(DIR, file), 'utf8'))
  const t = doc.tournament

  if (seenNumbers.has(t)) err(t, `duplicate tournament number (${file})`)
  seenNumbers.add(t)
  if (String(t).padStart(2, '0') + '.json' !== file) {
    err(t, `filename ${file} does not match tournament number ${t}`)
  }

  // --- roster: one username per name, consistently, across the whole set ---
  for (const p of doc.roster ?? []) {
    if (!p.name) err(t, 'roster entry with no name')
    if (p.username) {
      if (!globalNameToUsernames.has(p.name)) globalNameToUsernames.set(p.name, new Map())
      const m = globalNameToUsernames.get(p.name)
      m.set(p.username, [...(m.get(p.username) ?? []), t])
    }
  }

  // --- standings arithmetic and rank ordering ---
  for (const [division, rows] of Object.entries(doc.standings ?? {})) {
    rows.forEach((r, i) => {
      const expected = r.wins * 2 + r.draws
      if (r.points !== expected) {
        err(t, `${division} ${r.name}: points ${r.points} but ${r.wins}W+${r.draws}D = ${expected}`)
      }
      if (r.rank !== i + 1) {
        err(t, `${division} ${r.name}: rank ${r.rank} at array position ${i + 1}`)
      }
    })
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].points > rows[i - 1].points) {
        err(t, `${division}: ${rows[i].name} (${rows[i].points}pts) ranked below ${rows[i - 1].name} (${rows[i - 1].points}pts)`)
      }
    }
    const names = rows.map((r) => r.name)
    if (new Set(names).size !== names.length) err(t, `${division}: duplicate name in standings`)
  }

  // --- known names: roster + standings + entrants ---
  const known = new Set([
    ...(doc.roster ?? []).map((p) => p.name),
    ...Object.values(doc.standings ?? {}).flat().map((r) => r.name),
  ])

  for (const [divKey, div] of Object.entries(doc.divisions ?? {})) {
    const entrantNames = new Set(entrantsOf(div).map((e) => e.name))
    for (const n of entrantNames) {
      if (!known.has(n)) err(t, `${divKey}: entrant "${n}" is in no roster or standings table`)
    }

    // Placements must be entrants, and places must be 1..n with no gaps/dupes.
    const allPlacements = [
      ...(div.placements ?? []),
      ...(div.consolation?.placements ?? []),
    ]
    for (const p of div.placements ?? []) {
      if (!entrantNames.has(p.name)) err(t, `${divKey}: placement "${p.name}" is not an entrant`)
    }
    // A duplicate place is normally a transcription slip, but tournament 8's
    // source genuinely prints 9th twice with no 8th. A division may declare
    // that anomaly explicitly and have it reported as a warning instead.
    const places = (div.placements ?? []).map((p) => p.place)
    if (new Set(places).size !== places.length) {
      const declared = doc._placement_anomaly?.[divKey]
      if (declared) warn(t, `${divKey}: duplicate placement position — declared source anomaly: ${declared}`)
      else err(t, `${divKey}: duplicate placement position`)
    }
    void allPlacements

    for (const [kind, matches, bracketEntrants] of bracketsOf(div)) {
      const seen = new Set()
      const pairings = new Map()
      // A HOLE in the seed sequence -- a seed missing from the bracket while a
      // higher seed number is present -- means a match was mis-transcribed and
      // dropped somebody. A missing TAIL is normal: tournament 3's playoff
      // divisions were round robins where only the top 6 reached the knockout,
      // so seeds 7+ legitimately play no bracket match.
      if (matches.length && kind !== 'winners' && kind !== 'losers') {
        const played = new Set(matches.flatMap((m) => [m.a, m.b]).filter(Boolean))
        const seeded = bracketEntrants.filter((e) => e.seed != null)
        const maxPlayedSeed = Math.max(
          0,
          ...seeded.filter((e) => played.has(e.name)).map((e) => e.seed)
        )
        for (const e of seeded) {
          if (!played.has(e.name) && e.seed < maxPlayedSeed) {
            err(t, `${divKey} ${kind}: seed ${e.seed} ("${e.name}") plays in no match, but seed ${maxPlayedSeed} does — a match is missing or mis-transcribed`)
          }
        }
      }
      for (const m of matches) {
        const key = `${kind}:${m.round}:${m.slot}`
        if (seen.has(key)) err(t, `${divKey}: duplicate match position ${key}`)
        seen.add(key)

        for (const side of ['a', 'b']) {
          const n = m[side]
          if (n && !entrantNames.has(n)) {
            err(t, `${divKey} ${key}: player "${n}" is not an entrant of this division`)
          }
        }
        if (m.a && m.b && m.a === m.b) err(t, `${divKey} ${key}: same player on both sides`)

        // The same two players meeting twice in one knockout bracket is almost
        // always a duplicated row rather than a real rematch.
        if (m.a && m.b) {
          const pair = [m.a, m.b].sort().join(' vs ')
          if (pairings.has(pair)) {
            err(t, `${divKey} ${kind}: "${pair}" appears twice (${pairings.get(pair)} and R${m.round}.${m.slot})`)
          }
          pairings.set(pair, `R${m.round}.${m.slot}`)
        }

        if (m.winner != null && m.winner !== m.a && m.winner !== m.b) {
          err(t, `${divKey} ${key}: winner "${m.winner}" did not play in this match`)
        }
        if (m.winner == null) {
          warn(t, `${divKey} ${key}: no winner recorded (${m.a ?? '?'} vs ${m.b ?? '?'})`)
        }

        // Scores, where present, must agree with the winner.
        if (m.score_a != null && m.score_b != null) {
          if (m.score_a === m.score_b) {
            err(t, `${divKey} ${key}: tied score ${m.score_a}-${m.score_b} but a winner is recorded`)
          }
          const scoreWinner = m.score_a > m.score_b ? m.a : m.b
          if (m.winner && scoreWinner !== m.winner) {
            err(t, `${divKey} ${key}: score ${m.score_a}-${m.score_b} contradicts winner "${m.winner}"`)
          }
        }
      }

      // The last round of a championship bracket should decide the champion.
      if (kind === 'championship' && matches.length && div.placements?.length) {
        const finals = matches.filter((m) => !m.medal_game)
        if (finals.length) {
          const lastRound = Math.max(...finals.map((m) => m.round))
          const final = finals.find((m) => m.round === lastRound)
          const champion = div.placements.find((p) => p.place === 1)?.name
          if (champion && final?.winner && final.winner !== champion) {
            err(t, `${divKey}: final winner "${final.winner}" but placement 1 is "${champion}"`)
          }
        }
      }
    }
  }
}

// --- one name must not map to two usernames without an explicit rule ---
const playersDoc = JSON.parse(readFileSync('data/players.json', 'utf8'))
const declared = new Set(
  Object.keys(playersDoc.username_changes ?? {}).filter((k) => !k.startsWith('_'))
)
const excused = []
for (const [name, unameMap] of globalNameToUsernames) {
  if (unameMap.size <= 1) continue
  const detail = [...unameMap.entries()].map(([u, ts]) => `${u} (T${ts.join(',')})`).join(' vs ')
  if (declared.has(name)) {
    excused.push(`${name}: ${detail}`)
  } else {
    err('-', `"${name}" maps to multiple usernames with no rule in data/players.json: ${detail}`)
  }
}
// A declared rule that no longer matches any data is a stale rule.
for (const name of declared) {
  if ((globalNameToUsernames.get(name)?.size ?? 0) <= 1) {
    err('-', `data/players.json declares a username change for "${name}" but the data no longer shows one`)
  }
}
if (excused.length) {
  console.log(`\n${excused.length} declared username change(s), merged per data/players.json:`)
  for (const e of excused) console.log('  = ' + e)
}

console.log(`Checked ${files.length} tournaments: ${files.join(', ')}`)
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s) — expected gaps, not failures:`)
  for (const w of warnings) console.log('  ! ' + w)
}
if (errors.length) {
  console.error(`\n${errors.length} ERROR(S):`)
  for (const e of errors) console.error('  x ' + e)
  process.exit(1)
}
console.log('\nAll structural checks passed.')
