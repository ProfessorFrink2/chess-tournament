/** Import the transcribed history in data/tournaments/ into Supabase.
 *
 *  Idempotent: keyed on tournament number, season number, and
 *  (tournament, division, bracket_kind, round, slot) for matches. Running it
 *  twice leaves the database in the same state; the second run reports 0 new
 *  rows.
 *
 *  Usage:
 *    node scripts/import-history.mjs --dry-run   # resolve and report, write nothing
 *    node scripts/import-history.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Minimal .env.local reader. dotenv is not a dependency of this project and
// adding one just to read two variables is not worth it.
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
if (!DRY && (!SUPABASE_URL || !SERVICE_ROLE_KEY)) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const db = DRY
  ? null
  : createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const DIR = 'data/tournaments'
const playersDoc = JSON.parse(readFileSync('data/players.json', 'utf8'))
const docs = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')))

const NOT_PLAYERS = new Set(playersDoc.not_players?.entries ?? [])
const keepSeparate = new Set(
  Object.keys(playersDoc.deliberately_separate_from_live ?? {}).filter((k) => !k.startsWith('_'))
)

// ---------------------------------------------------------------------------
// 1. Resolve identities
// ---------------------------------------------------------------------------
// Union by username first, then apply the declared username-change merges, then
// pick one canonical display name per person.

const usernameChanges = Object.entries(playersDoc.username_changes ?? {})
  .filter(([k]) => !k.startsWith('_'))

/** username (lowercased) -> canonical username (lowercased) */
const usernameAlias = new Map()
for (const [, rule] of usernameChanges) {
  const keep = rule.keep.toLowerCase()
  for (const u of rule.usernames) usernameAlias.set(u.toLowerCase(), keep)
}

/** Historic spelling -> the spelling already in the live players table, so a
 *  typo in a source sheet does not create a duplicate person. Applied last. */
const liveOverrides = new Map(
  Object.entries(playersDoc.live_username_overrides ?? {})
    .filter(([k]) => !k.startsWith('_'))
    .map(([from, to]) => [from.toLowerCase(), to.toLowerCase()])
)

function canonUsername(u) {
  if (!u) return null
  const lower = u.toLowerCase()
  const merged = usernameAlias.get(lower) ?? lower
  return liveOverrides.get(merged) ?? merged
}

/** Collect every (name, username) sighting across all tournaments. */
const sightings = []
for (const doc of docs) {
  for (const p of doc.roster ?? []) {
    if (NOT_PLAYERS.has(p.name)) continue
    sightings.push({ tournament: doc.tournament, name: p.name, username: p.username ?? null })
  }
}

/** canonical username -> { displayName, usernames:Set, lastSeen } */
const byUsername = new Map()
const nameOnly = new Map()

const canonicalNameOverrides = Object.fromEntries(
  Object.entries(playersDoc.canonical_names ?? {})
    .filter(([k]) => !k.startsWith('_'))
    .map(([u, n]) => [u.toLowerCase(), n])
)

for (const s of sightings) {
  if (s.username) {
    const key = canonUsername(s.username)
    const rec = byUsername.get(key) ?? {
      key, displayName: s.name, usernames: new Set(), lastSeen: -1,
    }
    rec.usernames.add(s.username)
    // Later tournaments win the display name, unless overridden explicitly.
    if (s.tournament > rec.lastSeen) {
      rec.lastSeen = s.tournament
      rec.displayName = s.name
    }
    byUsername.set(key, rec)
  } else {
    nameOnly.set(s.name, true)
  }
}
for (const [key, rec] of byUsername) {
  if (canonicalNameOverrides[key]) rec.displayName = canonicalNameOverrides[key]
}

/** Per-tournament lookup: name as written -> canonical player key. */
function tournamentIndex(doc) {
  const idx = new Map()
  for (const p of doc.roster ?? []) {
    if (NOT_PLAYERS.has(p.name)) continue
    idx.set(p.name, p.username ? canonUsername(p.username) : `name:${p.name}`)
  }
  return idx
}

const unresolved = []
function resolve(doc, idx, name, where) {
  if (name == null) return null
  const key = idx.get(name)
  if (!key) {
    unresolved.push(`T${doc.tournament} ${where}: "${name}"`)
    return null
  }
  return key
}

// Register any name-only players so they still get a row.
for (const name of nameOnly.keys()) {
  const key = `name:${name}`
  if (!byUsername.has(key)) {
    byUsername.set(key, { key, displayName: name, usernames: new Set(), lastSeen: -1 })
  }
}

console.log(`Resolved ${byUsername.size} distinct players from ${sightings.length} sightings.`)

// ---------------------------------------------------------------------------
// 2. Flatten each tournament into rows
// ---------------------------------------------------------------------------

/** Yield [bracket_kind, matches[]] for each bracket inside a division block. */
function bracketsOf(div) {
  const out = []
  if (div.matches) out.push(['championship', div.matches, div.entrants ?? []])
  if (div.consolation?.matches) {
    out.push(['consolation', div.consolation.matches, div.consolation.entrants ?? []])
  }
  if (div.winners) out.push(['winners', div.winners, div.entrants ?? []])
  if (div.losers) out.push(['losers', div.losers, div.entrants ?? []])
  return out
}

const plan = []
for (const doc of docs) {
  const idx = tournamentIndex(doc)

  const standings = []
  for (const [division, rows] of Object.entries(doc.standings ?? {})) {
    for (const r of rows) {
      if (NOT_PLAYERS.has(r.name)) continue
      const key = resolve(doc, idx, r.name, `standings ${division}`)
      if (key) {
        standings.push({
          division, playerKey: key, rank: r.rank,
          wins: r.wins, draws: r.draws, losses: r.losses, points: r.points,
        })
      }
    }
  }

  const divisions = []
  const entrants = []
  const matches = []

  for (const [divKey, div] of Object.entries(doc.divisions ?? {})) {
    // "_overall" is the sentinel for a tournament with no divisions at all.
    const division = divKey === '_overall' ? null : divKey
    if (division) divisions.push({ division, format: div.format ?? doc.format })

    const placementByName = new Map()
    for (const p of div.placements ?? []) placementByName.set(p.name, p.place)
    const consolationPlacement = new Map()
    for (const p of div.consolation?.placements ?? []) consolationPlacement.set(p.name, p.place)

    // Entrants are scoped to a bracket, not just a division: tournament 10's A
    // division had a championship and a consolation, each with its own 1st.
    const seenEntrant = new Set()
    const addEntrant = (e, placements, bracketKind) => {
      if (NOT_PLAYERS.has(e.name)) return
      const key = resolve(doc, idx, e.name, `${divKey} ${bracketKind} entrants`)
      if (!key) return
      const dedupe = `${bracketKind}:${key}`
      if (seenEntrant.has(dedupe)) return
      seenEntrant.add(dedupe)
      entrants.push({
        division, bracket_kind: bracketKind, playerKey: key,
        seed: e.seed ?? null,
        final_placement: placements.get(e.name) ?? null,
        wins: e.wins ?? null, draws: e.draws ?? null,
        losses: e.losses ?? null, points: e.points ?? null,
      })
    }
    for (const e of div.entrants ?? []) addEntrant(e, placementByName, 'championship')
    for (const e of div.consolation?.entrants ?? []) {
      addEntrant(e, consolationPlacement, 'consolation')
    }

    for (const [kind, list] of bracketsOf(div)) {
      for (const m of list) {
        matches.push({
          division, bracket_kind: kind,
          round: m.round, slot: m.slot,
          player_a: resolve(doc, idx, m.a, `${divKey} ${kind} R${m.round}.${m.slot}`),
          player_b: resolve(doc, idx, m.b, `${divKey} ${kind} R${m.round}.${m.slot}`),
          seed_a: m.seed_a ?? null, seed_b: m.seed_b ?? null,
          score_a: m.score_a ?? null, score_b: m.score_b ?? null,
          winner: m.winner ? resolve(doc, idx, m.winner, `${divKey} ${kind} winner`) : null,
          is_medal_game: m.medal_game === true,
          label: m.label ?? null,
        })
      }
    }
  }

  plan.push({ doc, standings, divisions, entrants, matches })
}

if (unresolved.length) {
  console.error(`\n${unresolved.length} unresolved player reference(s) — refusing to import:`)
  for (const u of unresolved) console.error('  x ' + u)
  process.exit(1)
}

const totals = plan.reduce(
  (a, p) => ({
    standings: a.standings + p.standings.length,
    divisions: a.divisions + p.divisions.length,
    entrants: a.entrants + p.entrants.length,
    matches: a.matches + p.matches.length,
  }),
  { standings: 0, divisions: 0, entrants: 0, matches: 0 }
)
console.log(
  `Planned: ${plan.length} tournaments, ${totals.divisions} divisions, ` +
  `${totals.standings} standings rows, ${totals.entrants} entrants, ${totals.matches} matches.`
)

if (DRY) {
  // Report how each historic player will land against the live table, if we
  // can reach it. Read-only.
  if (SUPABASE_URL && SERVICE_ROLE_KEY) {
    const probe = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const { data: live, error } = await probe
      .from('players').select('display_name, chess_com_username')
    if (error) {
      console.log(`\n(could not read live players: ${error.message})`)
    } else {
      const liveByU = new Map(
        (live ?? []).filter((p) => p.chess_com_username)
          .map((p) => [p.chess_com_username.toLowerCase(), p])
      )
      const matched = []
      const fresh = []
      for (const rec of byUsername.values()) {
        const uname = rec.key.startsWith('name:') ? null : rec.key
        const hit = uname ? liveByU.get(uname) : null
        if (hit) matched.push(`${rec.displayName} -> live "${hit.display_name}" (${uname})`)
        else fresh.push(`${rec.displayName} (${uname ?? 'no username'})`)
      }
      console.log(`\nAgainst the live players table (${live.length} rows):`)
      console.log(`  ${matched.length} historic players match an existing row`)
      console.log(`  ${fresh.length} will be created as new historic players`)
      const renames = matched.filter((m) => {
        const [h, rest] = m.split(' -> live "')
        return h !== rest.split('" (')[0]
      })
      if (renames.length) {
        console.log(`\n  Matched by username but named differently (live name is kept):`)
        for (const r of renames) console.log('    ' + r)
      }
      for (const name of keepSeparate) {
        console.log(`\n  Declared separate from the live player of the same name: ${name}`)
      }
    }
  }

  console.log('\n--dry-run: nothing written.')
  for (const p of plan) {
    console.log(
      `  T${String(p.doc.tournament).padStart(2)}  ${p.doc.name.padEnd(32)} ` +
      `season=${p.doc.season ? p.doc.season.number : '-'}  ` +
      `div=${p.divisions.length} standings=${p.standings.length} ` +
      `entrants=${p.entrants.length} matches=${p.matches.length}`
    )
  }
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 3. Write
// ---------------------------------------------------------------------------

function fail(step, error) {
  console.error(`\nFAILED at ${step}: ${error.message ?? error}`)
  process.exit(1)
}

/** Upsert players, returning canonical key -> player uuid. */
async function upsertPlayers() {
  const { data: existing, error } = await db
    .from('players')
    .select('id, display_name, chess_com_username')
  if (error) fail('reading players', error)

  const byUname = new Map()
  const byName = new Map()
  for (const p of existing ?? []) {
    if (p.chess_com_username) byUname.set(p.chess_com_username.toLowerCase(), p)
    if (!byName.has(p.display_name)) byName.set(p.display_name, [])
    byName.get(p.display_name).push(p)
  }

  const ids = new Map()
  const toInsert = []

  for (const rec of byUsername.values()) {
    const uname = rec.key.startsWith('name:') ? null : rec.key
    let hit = uname ? byUname.get(uname) : null

    if (!hit && keepSeparate.has(rec.displayName)) {
      // Explicitly declared as a different person from the same-named live
      // player. Never fall back to the display name for these.
      console.log(
        `  keeping "${rec.displayName}" (${uname ?? 'no username'}) separate from the live player of the same name`
      )
    } else if (!hit) {
      // Fall back to display name, but only when it is unambiguous AND the
      // existing row has no conflicting username.
      const candidates = (byName.get(rec.displayName) ?? []).filter(
        (p) => !p.chess_com_username || p.chess_com_username.toLowerCase() === uname
      )
      if (candidates.length > 1) {
        fail(
          'resolving players',
          `"${rec.displayName}" matches ${candidates.length} existing rows with no username to tell them apart. ` +
          `Resolve by hand before importing.`
        )
      }
      hit = candidates[0]
    }

    if (hit) ids.set(rec.key, hit.id)
    else toInsert.push({ rec, row: {
      display_name: rec.displayName,
      chess_com_username: uname,
      is_historic: true,
    } })
  }

  if (toInsert.length) {
    const { data, error: insErr } = await db
      .from('players')
      .insert(toInsert.map((t) => t.row))
      .select('id, display_name, chess_com_username')
    if (insErr) fail('inserting players', insErr)
    // Match inserted rows back to their keys.
    for (const row of data) {
      const key = row.chess_com_username ? row.chess_com_username.toLowerCase() : `name:${row.display_name}`
      ids.set(key, row.id)
    }
  }

  console.log(`Players: ${toInsert.length} created, ${ids.size - toInsert.length} already present.`)
  return ids
}

async function upsertSeason(spec) {
  if (!spec) return null
  const { data: found, error } = await db
    .from('seasons').select('id').eq('number', spec.number).maybeSingle()
  if (error) fail('reading season', error)
  if (found) return found.id

  const { data, error: insErr } = await db
    .from('seasons')
    .insert({
      name: spec.name, number: spec.number,
      is_active: false, is_finished: true, is_historic: true,
    })
    .select('id').single()
  if (insErr) fail('inserting season', insErr)
  return data.id
}

async function upsertTournament(doc, seasonId) {
  const { data: found, error } = await db
    .from('tournaments').select('id').eq('number', doc.tournament).maybeSingle()
  if (error) fail('reading tournament', error)

  const row = {
    season_id: seasonId,
    name: doc.name,
    format: doc.format,
    is_active: false,
    is_finished: true,
    // Transcription notes are provenance, not tournament content. They live in
    // data/tournaments/NN.json and VERIFICATION.md; the notes column is left
    // free for an admin's own notes on a real tournament.
    notes: null,
  }

  if (found) {
    const { error: upErr } = await db.from('tournaments').update(row).eq('id', found.id)
    if (upErr) fail('updating tournament', upErr)
    return found.id
  }
  const { data, error: insErr } = await db
    .from('tournaments').insert({ ...row, number: doc.tournament }).select('id').single()
  if (insErr) fail('inserting tournament', insErr)
  return data.id
}

/** Replace all child rows for a tournament, so a re-run converges. */
async function replaceChildren(table, tournamentId, rows) {
  const { error: delErr } = await db.from(table).delete().eq('tournament_id', tournamentId)
  if (delErr) fail(`clearing ${table}`, delErr)
  if (!rows.length) return 0
  const { error: insErr } = await db.from(table).insert(rows)
  if (insErr) fail(`inserting ${table}`, insErr)
  return rows.length
}

const playerIds = await upsertPlayers()
const pid = (key) => (key ? (playerIds.get(key) ?? null) : null)

let created = { standings: 0, divisions: 0, entrants: 0, matches: 0 }

for (const p of plan) {
  const seasonId = await upsertSeason(p.doc.season)
  const tournamentId = await upsertTournament(p.doc, seasonId)

  if (seasonId) {
    const { error: delErr } = await db
      .from('season_standings').delete().eq('season_id', seasonId)
    if (delErr) fail('clearing season_standings', delErr)
    if (p.standings.length) {
      const { error } = await db.from('season_standings').insert(
        p.standings.map((s) => ({
          season_id: seasonId, division: s.division, player_id: pid(s.playerKey),
          rank: s.rank, wins: s.wins, draws: s.draws, losses: s.losses, points: s.points,
        }))
      )
      if (error) fail('inserting season_standings', error)
      created.standings += p.standings.length
    }
  }

  created.divisions += await replaceChildren(
    'tournament_divisions', tournamentId,
    p.divisions.map((d) => ({ tournament_id: tournamentId, division: d.division, format: d.format }))
  )
  created.entrants += await replaceChildren(
    'tournament_entrants', tournamentId,
    p.entrants.map((e) => ({
      tournament_id: tournamentId, division: e.division,
      bracket_kind: e.bracket_kind, player_id: pid(e.playerKey),
      seed: e.seed, final_placement: e.final_placement,
      wins: e.wins, draws: e.draws, losses: e.losses, points: e.points,
    }))
  )
  created.matches += await replaceChildren(
    'tournament_matches', tournamentId,
    p.matches.map((m) => ({
      tournament_id: tournamentId, division: m.division, bracket_kind: m.bracket_kind,
      round: m.round, slot: m.slot,
      player_a_id: pid(m.player_a), player_b_id: pid(m.player_b),
      seed_a: m.seed_a, seed_b: m.seed_b,
      score_a: m.score_a, score_b: m.score_b,
      winner_id: pid(m.winner),
      is_medal_game: m.is_medal_game, label: m.label,
    }))
  )

  console.log(`  T${String(p.doc.tournament).padStart(2)} ${p.doc.name} — ok`)
}

console.log(
  `\nDone. ${created.divisions} divisions, ${created.standings} standings rows, ` +
  `${created.entrants} entrants, ${created.matches} matches.`
)
