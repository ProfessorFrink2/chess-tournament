/**
 * Dumps all tables to backups/YYYY-MM-DD.json and prunes files older than 7 days.
 * Run via: node scripts/backup-db.mjs
 * Called daily by .github/workflows/backup.yml
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

function loadEnv(p = '.env.local') {
  if (!existsSync(p)) return
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
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

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('Missing SUPABASE env vars'); process.exit(1) }

const TABLES = [
  'seasons',
  'players',
  'profiles',
  'matches',
  'season_standings',
  'tournaments',
  'tournament_divisions',
  'tournament_entrants',
  'tournament_matches',
]

async function fetchAll(table) {
  let rows = [], from = 0, PAGE = 1000
  while (true) {
    const res = await fetch(
      `${URL}/rest/v1/${table}?select=*&limit=${PAGE}&offset=${from}`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Range-Unit': 'items' } }
    )
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
    const page = await res.json()
    rows = rows.concat(page)
    if (page.length < PAGE) break
    from += PAGE
  }
  return rows
}

const today = new Date().toISOString().split('T')[0]
const outDir = 'backups'

const snapshot = {}
for (const table of TABLES) {
  process.stdout.write(`  ${table}… `)
  const rows = await fetchAll(table)
  snapshot[table] = rows
  console.log(`${rows.length} rows`)
}

writeFileSync(join(outDir, `${today}.json`), JSON.stringify(snapshot, null, 2))
console.log(`\nWrote backups/${today}.json`)

// Prune files older than 7 days
const files = readdirSync(outDir)
  .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  .sort()
const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
for (const f of files) {
  if (f.slice(0, 10) < cutoff) {
    unlinkSync(join(outDir, f))
    console.log(`Pruned ${f}`)
  }
}
