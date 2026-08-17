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

/** Verify the bearer token on a request belongs to an admin.
 *
 *  Routes that use createServiceClient() bypass RLS entirely, so they must
 *  check this themselves — the database will not do it for them.
 *  Returns null when authorized, or a 401/403 Response to return as-is. */
export async function requireAdmin(req: Request): Promise<Response | null> {
  const token = req.headers.get('authorization')?.replace(/^Bearer /i, '')
  if (!token) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const db = createServiceClient()
  const { data: { user }, error } = await db.auth.getUser(token)
  if (error || !user) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: profile } = await db
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if ((profile as { role?: string } | null)?.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403 })
  }
  return null
}
