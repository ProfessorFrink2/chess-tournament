import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://zrtkcdpuqlnqonlaoaac.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpydGtjZHB1cWxucW9ubGFvYWFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTgwMjExNCwiZXhwIjoyMTAxMzc4MTE0fQ.LbmFaT1H0YdcTHDxJ-MW2zD2EVX7XQ3SARPH9Y_ch04'

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// Display name → chess.com username → bracket
const players = [
  // A Bracket
  { name: 'Taras',     username: 'Dambl',               bracket: 'A' },
  { name: 'Josh',      username: 'chessicaaffair',       bracket: 'A' },
  { name: 'Axel',      username: 'ax359',                bracket: 'A' },
  { name: 'Bogdan',    username: 'Bohdan7770',            bracket: 'A' },
  { name: 'Terry',     username: 'temcgrat',              bracket: 'A' },
  { name: 'Jamie',     username: 'CowMaster66',           bracket: 'A' },
  { name: 'Andriy',    username: 'SYROTEI',               bracket: 'A' },
  { name: 'Rob',       username: 'Robmon13',              bracket: 'A' },
  { name: 'Pablo',     username: 'PapsR',                 bracket: 'A' },
  { name: 'Nathan',    username: 'fgrrghg',               bracket: 'A' },
  { name: 'Alicia',    username: 'ahensch',               bracket: 'A' },
  { name: 'Ryan',      username: 'rlon30',                bracket: 'A' },
  { name: 'Andy',      username: 'randongles',            bracket: 'A' },
  { name: 'Steve',     username: 'ScubaStavi',            bracket: 'A' },
  { name: 'Ben',       username: 'smithbwa',              bracket: 'A' },
  { name: 'Max',       username: 'Gaksym',                bracket: 'A' },
  { name: 'Jeff A',    username: 'jeffsappendix1',        bracket: 'A' },
  { name: 'Aitor',     username: 'Aitorgaldos',           bracket: 'A' },
  { name: 'Shawn B',   username: 'shawnmatthewbell',      bracket: 'A' },
  { name: 'Andrew K',  username: 'andrewrk93',            bracket: 'A' },
  { name: 'Connor',    username: 'ItsPreem',              bracket: 'A' },
  { name: 'Michael',   username: 'KnotYourCaptain',       bracket: 'A' },

  // B Bracket
  { name: 'Donell',         username: 'DONDON3333',          bracket: 'B' },
  { name: 'Keyes',          username: 'Bishopstip',          bracket: 'B' },
  { name: 'Alejandra',      username: 'aOlli',               bracket: 'B' },
  { name: 'Shapes',         username: 'shapesies',           bracket: 'B' },
  { name: 'Brendan',        username: 'Bthompson35',         bracket: 'B' },
  { name: 'Matt',           username: 'marrmalian',          bracket: 'B' },
  { name: 'Keith',          username: 'Sliggg',              bracket: 'B' },
  { name: 'Andrew Champo',  username: 'ElChampoLibre',       bracket: 'B' },
  { name: 'Mark S',         username: 'bobark',              bracket: 'B' },
  { name: 'Rich',           username: 'ohwhenthesaints01',   bracket: 'B' },
  { name: 'Dan',            username: 'djdanidu',            bracket: 'B' },
  { name: 'Natno',          username: 'Fancycheckers2020',   bracket: 'B' },
  { name: 'Chris E',        username: 'WearyBagel',          bracket: 'B' },
  { name: 'Lenny',          username: 'kmitchell2',          bracket: 'B' },
]

let created = 0
let skipped = 0

for (const p of players) {
  const email = `${p.username.toLowerCase()}@chess.local`

  // Create auth user
  const { data: userData, error: userError } = await db.auth.admin.createUser({
    email,
    password: 'changeme123',
    email_confirm: true,
  })

  if (userError) {
    if (userError.message.includes('already been registered')) {
      console.log(`⏭  Skipped ${p.name} (${p.username}) — already exists`)
      skipped++
      continue
    }
    console.error(`✗  ${p.name}: ${userError.message}`)
    continue
  }

  const userId = userData.user.id

  // Insert player row (profile is auto-created by trigger)
  const { error: playerError } = await db.from('players').insert({
    user_id: userId,
    chess_com_username: p.username.toLowerCase(),
    display_name: p.name,
    bracket: p.bracket,
  })

  if (playerError) {
    console.error(`✗  ${p.name} player row: ${playerError.message}`)
  } else {
    console.log(`✓  ${p.name} (${p.username}) → ${p.bracket} bracket`)
    created++
  }
}

console.log(`\nDone. Created: ${created}, Skipped: ${skipped}`)
