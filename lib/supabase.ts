import { createClient } from '@supabase/supabase-js'

// Browser singleton — one instance so auth session persists across components
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://placeholder'
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder'

export const supabase = createClient(url, anonKey)

export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
