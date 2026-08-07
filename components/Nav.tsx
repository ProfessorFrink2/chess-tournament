'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Nav() {
  const [user, setUser] = useState<{ email: string; role: string } | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data } = await supabase
        .from('profiles')
        .select('email, role')
        .eq('id', session.user.id)
        .single()
      if (data) setUser(data)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) { setUser(null); return }
      supabase
        .from('profiles')
        .select('email, role')
        .eq('id', session.user.id)
        .single()
        .then(({ data }) => { if (data) setUser(data) })
    })
    return () => subscription.unsubscribe()
  }, [])

  return (
    <nav className="border-b border-gray-800 bg-gray-900">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg text-white tracking-tight">
          ♟ Chess Tournament
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/" className="text-gray-400 hover:text-white transition-colors">Brackets</Link>
          {user && (
            <Link href="/player" className="text-gray-400 hover:text-white transition-colors">My Matches</Link>
          )}
          {user?.role === 'admin' && (
            <Link href="/admin" className="text-amber-400 hover:text-amber-300 transition-colors">Admin</Link>
          )}
          {user ? (
            <button
              onClick={() => supabase.auth.signOut()}
              className="text-gray-400 hover:text-white transition-colors"
            >
              Sign out
            </button>
          ) : (
            <>
              <Link href="/auth/login" className="text-gray-400 hover:text-white transition-colors">Sign in</Link>
              <Link href="/auth/signup" className="bg-white text-gray-900 px-3 py-1 rounded text-sm font-medium hover:bg-gray-100 transition-colors">
                Join
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
