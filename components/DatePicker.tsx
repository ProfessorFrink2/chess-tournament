'use client'

import { useState, useRef, useEffect } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'

interface Props {
  value: string        // YYYY-MM-DD or ''
  onChange: (value: string) => void
  placeholder?: string
}

function toDate(s: string): Date | undefined {
  if (!s) return undefined
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function toStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function DatePicker({ value, onChange, placeholder = 'Pick a date' }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const selected = toDate(value)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-white hover:border-gray-500 focus:outline-none focus:border-gray-400"
      >
        {value || <span className="text-gray-500">{placeholder}</span>}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-2">
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={(day) => {
              if (day) { onChange(toStr(day)); setOpen(false) }
            }}
            defaultMonth={selected ?? new Date()}
            classNames={{
              root: 'text-white text-sm',
              month_caption: 'flex justify-between items-center px-1 pb-2 font-medium',
              nav: 'flex gap-1',
              button_previous: 'p-1 rounded hover:bg-gray-700 text-white',
              button_next: 'p-1 rounded hover:bg-gray-700 text-white',
              weeks: 'mt-1',
              weekdays: 'flex mb-1',
              weekday: 'w-8 text-center text-xs text-gray-500',
              week: 'flex',
              day: 'w-8 h-8',
              day_button: 'w-8 h-8 rounded hover:bg-gray-700 text-center text-xs focus:outline-none',
              selected: 'bg-white !text-gray-900 rounded font-bold',
              today: 'text-amber-400 font-semibold',
              outside: 'text-gray-600',
              disabled: 'text-gray-700 cursor-not-allowed',
            }}
          />
        </div>
      )}
    </div>
  )
}
