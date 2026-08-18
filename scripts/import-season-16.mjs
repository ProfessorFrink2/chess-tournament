/** Import Season 16 schedule (A Group 1, A Group 2, B Division) into Supabase.
 *  Idempotent — safe to re-run.
 *  Usage: node scripts/import-season-16.mjs [--dry-run]
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
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!DRY && (!SUPABASE_URL || !SERVICE_ROLE_KEY)) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const db = DRY ? null : createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ---------------------------------------------------------------------------
// Player IDs (from DB)
// ---------------------------------------------------------------------------
const P = {
  // A Division Group 2
  Ryan:      'ba73a2af-d915-44dd-a9a1-92bbe94995a7',
  JeffA:     'dac576c9-e634-4f28-b350-c7d5a32e6cee',
  Ben:       'b254800c-7799-4b7b-a726-32098adfe0ff',
  ShawnB:    '78d7b49e-9c88-4d20-8bd5-e302d9c92e1a',
  Andy:      '1eb64ecc-1cc4-4a6e-ac7e-243831656e05',
  Steve:     'fe914fb3-04e0-4221-a7b1-34af9a0ea6f8',
  Max:       'a31ccffe-c709-492e-94dd-18497f49044f',
  Aitor:     'c9117b63-8008-433e-8466-53e7248d960e',
  AndrewK:   'e7794bbc-0e79-4f23-ae64-400163ef4abe',
  Connor:    '4d6c6a21-1028-4a29-9e60-6a56921b533e',
  Michael:   '34e9db7b-dc5f-47c4-8543-fd4ae25c335b',
  // A Division Group 1
  Taras:     '3468142d-4cfe-4d01-8518-2ba4a1398aab',
  Terry:     'd0edc49b-4ba8-4037-9749-892324c0dfde',
  Bogdan:    'f14ca093-d71a-4135-81da-73cdbdc75705',
  Andriy:    'd806d9a7-721a-4a41-b2da-4971525c8336',
  Josh:      'd9014441-3ee1-441d-899d-5b21a55a1d61',
  Axel:      '085b7fd2-e13d-4b62-9c50-09402876f96b',
  Nathan:    '02eebb29-11bc-45f9-a99b-d1d8b92d1fdd',
  Jamie:     '6f3b8cd6-b735-41f8-87eb-5ef35d6c72c0',
  Rob:       '140b67f6-932b-4038-8bee-358461a22884',
  Pablo:     'dcc95e57-19c6-4909-877e-e838d9d363a5',
  Alicia:    '46ff317c-adb1-40c8-a13a-98c41f196e0d',
  // B Division
  Donell:    '1538c4b2-eee6-468f-bb2a-7d8146f2f423',
  Keyes:     'b72824ae-86a8-48d6-b72f-27b8dde8386b',
  Alejandra: 'd21dd6d0-2e12-4383-8c20-5149e00eae8b',
  Shapes:    '929a33e4-5e29-43ad-b7f2-6360dc86bea5',
  Brendan:   '680dfe6f-90e2-45b8-a191-030e807188d6',
  Matt:      'b098ed70-e1d1-42f2-a996-c6d9aba63c66',
  Keith:     'c8f80daf-83cf-47c6-b0fc-fa5daa26d862',
  AndrewC:   'f7cbe4ff-9618-48fb-8f15-5ab249f0e0dd',
  MarkS:     'b983f3e1-5a69-49cb-8504-f948139b25dc',
  Rich:      '732c91e9-f6f3-45d3-af59-0e11726f90a8',
  Dan:       'f74548c1-4436-4f20-8833-90af275fc6d9',
  Natno:     'b70d6957-e00a-47f5-b75f-94ce791403ca',
  ChrisE:    '8d565a07-73df-4df6-a6d4-800f71b160e0',
  Lenny:     '8839b220-6240-4f6c-a7ba-cbc474161bfb',
}

// ---------------------------------------------------------------------------
// Week dates
// ---------------------------------------------------------------------------
const WEEKS = {
  1:  '2026-07-07',
  2:  '2026-07-14',
  3:  '2026-07-21',
  4:  '2026-07-28',
  5:  '2026-08-04',
  6:  '2026-08-11',
  7:  '2026-08-18',
  8:  '2026-08-25',
  9:  '2026-09-01',
  10: '2026-09-08',
  11: '2026-09-15',
}

// Helper: build a match row (bye = null for player)
function m(week, w, b) {
  if (!w || !b) return null // skip bye rows
  return { week_number: week, white_player_id: w, black_player_id: b }
}

// ---------------------------------------------------------------------------
// A Division Group 2 schedule (Ryan, Jeff A, Ben, Shawn B, Andy, Steve, Max, Aitor, Andrew K, Connor, Michael)
// ---------------------------------------------------------------------------
const A2 = [
  m(1,  P.Ryan, P.JeffA),   m(1,  P.Ben, P.ShawnB),  m(1,  P.Steve, P.Michael), m(1,  P.Max, P.Connor),    m(1,  P.Aitor, P.AndrewK),
  m(2,  P.ShawnB, P.Michael), m(2, P.JeffA, P.Connor), m(2, P.Ben, P.AndrewK),  m(2, P.Andy, P.Aitor),     m(2, P.Steve, P.Max),
  m(3,  P.Ryan, P.Andy),    m(3,  P.Steve, P.Ben),    m(3,  P.Max, P.JeffA),     m(3,  P.Aitor, P.ShawnB),  m(3,  P.Connor, P.Michael),
  m(4,  P.Ryan, P.ShawnB),  m(4,  P.Ben, P.Michael),  m(4,  P.Andy, P.Connor),   m(4,  P.Steve, P.AndrewK), m(4,  P.Max, P.Aitor),
  m(5,  P.Ryan, P.Aitor),   m(5,  P.AndrewK, P.Max),  m(5,  P.Connor, P.Steve),  m(5,  P.Michael, P.Andy),  m(5,  P.ShawnB, P.JeffA),
  m(6,  P.Ryan, P.Max),     m(6,  P.Aitor, P.Steve),  m(6,  P.AndrewK, P.Andy),  m(6,  P.Connor, P.Ben),    m(6,  P.Michael, P.JeffA),
  m(7,  P.Ryan, P.Connor),  m(7,  P.Michael, P.AndrewK), m(7, P.ShawnB, P.Max),  m(7,  P.JeffA, P.Steve),   m(7,  P.Ben, P.Andy),
  m(8,  P.Ryan, P.Steve),   m(8,  P.Max, P.Andy),     m(8,  P.Aitor, P.Ben),     m(8,  P.AndrewK, P.JeffA), m(8,  P.Connor, P.ShawnB),
  m(9,  P.Max, null),       // Max bye
  m(9,  P.Aitor, P.Michael), m(9, P.AndrewK, P.Connor), m(9, P.Ryan, P.Ben),     m(9,  P.Andy, P.JeffA),    m(9,  P.Steve, P.ShawnB),
  m(10, P.Ryan, P.Michael), m(10, P.ShawnB, P.AndrewK), m(10, P.JeffA, P.Aitor), m(10, P.Ben, P.Max),       m(10, P.Andy, P.Steve),
  m(11, P.Ryan, P.AndrewK), m(11, P.Connor, P.Aitor), m(11, P.Michael, P.Max),   m(11, P.ShawnB, P.Andy),   m(11, P.JeffA, P.Ben),
].filter(Boolean)

// ---------------------------------------------------------------------------
// A Division Group 1 schedule (Taras, Terry, Bogdan, Andriy, Josh, Axel, Nathan, Jamie, Rob, Pablo, Alicia)
// ---------------------------------------------------------------------------
const A1 = [
  m(1,  P.Taras, P.Terry),   m(1,  P.Bogdan, P.Andriy), m(1,  P.Josh, P.Pablo),   m(1,  P.Axel, P.Alicia),   m(1,  P.Jamie, P.Rob),
  m(2,  P.Taras, P.Rob),     m(2,  P.Nathan, P.Jamie),  m(2,  P.Pablo, P.Axel),    m(2,  P.Andriy, P.Josh),   m(2,  P.Terry, P.Bogdan),
  m(3,  P.Taras, P.Josh),    m(3,  P.Axel, P.Bogdan),   m(3,  P.Jamie, P.Andriy),  m(3,  P.Rob, P.Pablo),     m(3,  P.Nathan, P.Alicia),
  m(4,  P.Taras, null),      // Taras bye
  m(4,  P.Jamie, P.Axel),    m(4,  P.Rob, P.Josh),      m(4,  P.Nathan, P.Bogdan), m(4,  P.Alicia, P.Terry),  m(4,  P.Pablo, P.Andriy),
  m(5,  P.Taras, P.Jamie),   m(5,  P.Nathan, P.Axel),   m(5,  P.Alicia, P.Josh),   m(5,  P.Pablo, P.Bogdan),  m(5,  P.Andriy, P.Terry),
  m(6,  P.Taras, P.Nathan),  m(6,  P.Alicia, P.Rob),    m(6,  P.Pablo, P.Jamie),   m(6,  P.Terry, P.Axel),    m(6,  P.Bogdan, P.Josh),
  m(7,  P.Taras, P.Alicia),  m(7,  P.Pablo, P.Nathan),  m(7,  P.Andriy, P.Rob),    m(7,  P.Terry, P.Jamie),   m(7,  P.Josh, P.Axel),
  m(8,  P.Taras, P.Axel),    m(8,  P.Jamie, P.Bogdan),  m(8,  P.Rob, P.Terry),     m(8,  P.Nathan, P.Andriy), m(8,  P.Alicia, P.Pablo),
  m(9,  P.Taras, P.Andriy),  m(9,  P.Terry, P.Pablo),   m(9,  P.Bogdan, P.Alicia), m(9,  P.Josh, P.Nathan),   m(9,  P.Axel, P.Rob),
  m(10, P.Taras, P.Pablo),   m(10, P.Andriy, P.Alicia), m(10, P.Terry, P.Nathan),  m(10, P.Bogdan, P.Rob),    m(10, P.Josh, P.Jamie),
  m(11, P.Taras, P.Bogdan),  m(11, P.Josh, P.Terry),    m(11, P.Axel, P.Andriy),   m(11, P.Jamie, P.Alicia),  m(11, P.Rob, P.Nathan),
].filter(Boolean)

// ---------------------------------------------------------------------------
// B Division schedule (14 players, 7 games/week)
// ---------------------------------------------------------------------------
const B = [
  m(1,  P.Donell, P.Keith),    m(1,  P.MarkS, P.Brendan),  m(1,  P.Dan, P.Alejandra),  m(1,  P.ChrisE, P.Keyes),
  m(1,  P.Lenny, P.Shapes),    m(1,  P.Natno, P.Matt),      m(1,  P.Rich, P.AndrewC),
  m(2,  P.Donell, P.Alejandra),m(2,  P.Brendan, P.Keyes),   m(2,  P.Keith, P.Shapes),   m(2,  P.MarkS, P.Matt),
  m(2,  P.Dan, P.AndrewC),     m(2,  P.ChrisE, P.Rich),     m(2,  P.Lenny, P.Natno),
  m(3,  P.Donell, P.Keyes),    m(3,  P.Alejandra, P.Shapes),m(3,  P.Brendan, P.Matt),   m(3,  P.Keith, P.AndrewC),
  m(3,  P.MarkS, P.Rich),      m(3,  P.Dan, P.Natno),       m(3,  P.ChrisE, P.Lenny),
  m(4,  P.Donell, P.Shapes),   m(4,  P.Keyes, P.Matt),      m(4,  P.Alejandra, P.AndrewC),m(4, P.Brendan, P.Rich),
  m(4,  P.Keith, P.Natno),     m(4,  P.MarkS, P.Lenny),     m(4,  P.Dan, P.ChrisE),
  m(5,  P.Donell, P.Lenny),    m(5,  P.Natno, P.ChrisE),    m(5,  P.Rich, P.Dan),        m(5,  P.AndrewC, P.MarkS),
  m(5,  P.Matt, P.Keith),      m(5,  P.Shapes, P.Brendan),  m(5,  P.Keyes, P.Alejandra),
  m(6,  P.Donell, P.Dan),      m(6,  P.ChrisE, P.MarkS),    m(6,  P.Lenny, P.Keith),     m(6,  P.Natno, P.Brendan),
  m(6,  P.Rich, P.Alejandra),  m(6,  P.AndrewC, P.Keyes),   m(6,  P.Matt, P.Shapes),
  m(7,  P.Donell, P.Natno),    m(7,  P.Rich, P.Lenny),       m(7,  P.AndrewC, P.ChrisE), m(7,  P.Matt, P.Dan),
  m(7,  P.Shapes, P.MarkS),    m(7,  P.Keyes, P.Keith),      m(7,  P.Alejandra, P.Brendan),
  m(8,  P.Donell, P.AndrewC),  m(8,  P.Matt, P.Rich),        m(8,  P.Shapes, P.Natno),   m(8,  P.Keyes, P.Lenny),
  m(8,  P.Alejandra, P.ChrisE),m(8,  P.Brendan, P.Dan),      m(8,  P.Keith, P.MarkS),
  m(9,  P.Donell, P.MarkS),    m(9,  P.Dan, P.Keith),         m(9,  P.ChrisE, P.Brendan), m(9,  P.Lenny, P.Alejandra),
  m(9,  P.Natno, P.Keyes),     m(9,  P.Rich, P.Shapes),       m(9,  P.AndrewC, P.Matt),
  m(10, P.Donell, P.Brendan),  m(10, P.Keith, P.Alejandra),   m(10, P.MarkS, P.Keyes),    m(10, P.Dan, P.Shapes),
  m(10, P.ChrisE, P.Matt),     m(10, P.Lenny, P.AndrewC),     m(10, P.Natno, P.Rich),
  m(11, P.Donell, P.Rich),     m(11, P.AndrewC, P.Natno),     m(11, P.Matt, P.Lenny),     m(11, P.Shapes, P.ChrisE),
  m(11, P.Keyes, P.Dan),       m(11, P.Alejandra, P.MarkS),   m(11, P.Brendan, P.Keith),
].filter(Boolean)

console.log(`A Division Group 1: ${A1.length} matches`)
console.log(`A Division Group 2: ${A2.length} matches`)
console.log(`B Division: ${B.length} matches`)

if (DRY) {
  console.log('Dry run — no writes.')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Create or fetch the season
// ---------------------------------------------------------------------------
let { data: existing } = await db.from('seasons').select('id').eq('number', 16).maybeSingle()
let seasonId
if (existing) {
  seasonId = existing.id
  console.log(`Season 16 already exists: ${seasonId}`)
} else {
  const { data: created, error } = await db.from('seasons').insert({
    number: 16,
    name: 'Season 16',
    start_date: '2026-07-07',
    end_date: '2026-09-15',
    is_active: true,
    is_finished: false,
    is_historic: false,
  }).select('id').single()
  if (error) { console.error('Season insert failed:', error.message); process.exit(1) }
  seasonId = created.id
  console.log(`Created Season 16: ${seasonId}`)
}

// ---------------------------------------------------------------------------
// Insert matches (idempotent: skip if same season+bracket+week+white+black exists)
// ---------------------------------------------------------------------------
const { data: existingMatches } = await db
  .from('matches')
  .select('bracket, week_number, white_player_id, black_player_id')
  .eq('season_id', seasonId)

const existingSet = new Set(
  (existingMatches ?? []).map((r) => `${r.bracket}|${r.week_number}|${r.white_player_id}|${r.black_player_id}`)
)

const toInsert = []
for (const row of A1) {
  const key = `A|${row.week_number}|${row.white_player_id}|${row.black_player_id}`
  if (!existingSet.has(key)) toInsert.push({ season_id: seasonId, bracket: 'A', result: 'pending', scheduled_start: WEEKS[row.week_number], scheduled_end: WEEKS[row.week_number], ...row })
}
for (const row of A2) {
  const key = `A|${row.week_number}|${row.white_player_id}|${row.black_player_id}`
  if (!existingSet.has(key)) toInsert.push({ season_id: seasonId, bracket: 'A', result: 'pending', scheduled_start: WEEKS[row.week_number], scheduled_end: WEEKS[row.week_number], ...row })
}
for (const row of B) {
  const key = `B|${row.week_number}|${row.white_player_id}|${row.black_player_id}`
  if (!existingSet.has(key)) toInsert.push({ season_id: seasonId, bracket: 'B', result: 'pending', scheduled_start: WEEKS[row.week_number], scheduled_end: WEEKS[row.week_number], ...row })
}

if (toInsert.length === 0) {
  console.log('All matches already present — nothing to insert.')
  process.exit(0)
}

const { error: insertError } = await db.from('matches').insert(toInsert)
if (insertError) { console.error('Match insert failed:', insertError.message); process.exit(1) }
console.log(`Inserted ${toInsert.length} matches.`)
