'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function SignupPage() {
  const router = useRouter()
  const [step, setStep] = useState<'account' | 'profile'>('account')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [chessUsername, setChessUsername] = useState('')
  const [chessValid, setChessValid] = useState<boolean | null>(null)
  const [validating, setValidating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleAccountSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    setStep('profile')
    setLoading(false)
  }

  async function validateChessUsername() {
    if (!chessUsername) return
    setValidating(true)
    setChessValid(null)
    const res = await fetch(`/api/chess-com/validate?username=${encodeURIComponent(chessUsername)}`)
    const { valid } = await res.json()
    setChessValid(valid)
    setValidating(false)
  }

  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!chessValid) { setError('Please validate your chess.com username first'); return }
    setLoading(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Not authenticated'); setLoading(false); return }

    const res = await fetch('/api/players/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, chessUsername, displayName }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Failed to save profile'); setLoading(false); return }
    router.push('/')
  }

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-6">Join the Tournament</h1>

      {step === 'account' ? (
        <form onSubmit={handleAccountSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-gray-500"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-gray-900 font-medium py-2 rounded hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleProfileSubmit} className="space-y-4">
          <p className="text-sm text-gray-400">Account created! Now set up your player profile.</p>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Display name</label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">chess.com username</label>
            <div className="flex gap-2">
              <input
                type="text"
                required
                value={chessUsername}
                onChange={(e) => { setChessUsername(e.target.value); setChessValid(null) }}
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white focus:outline-none focus:border-gray-500"
              />
              <button
                type="button"
                onClick={validateChessUsername}
                disabled={validating || !chessUsername}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {validating ? '…' : 'Verify'}
              </button>
            </div>
            {chessValid === true && <p className="text-green-400 text-xs mt-1">✓ Valid chess.com account</p>}
            {chessValid === false && <p className="text-red-400 text-xs mt-1">✗ Username not found on chess.com</p>}
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading || !chessValid}
            className="w-full bg-white text-gray-900 font-medium py-2 rounded hover:bg-gray-100 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Saving…' : 'Finish setup'}
          </button>
        </form>
      )}
    </div>
  )
}
