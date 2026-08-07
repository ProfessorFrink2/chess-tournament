import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET() {
  const db = createServiceClient()
  const { data, error } = await db
    .from('profiles')
    .select('id, role')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const adminIds = (data ?? [])
    .filter((p: { id: string; role: string }) => p.role === 'admin')
    .map((p: { id: string; role: string }) => p.id)

  return NextResponse.json({ adminIds })
}
