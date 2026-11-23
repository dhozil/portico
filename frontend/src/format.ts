import type { Num } from './types'

const ATTO = 10n ** 18n

export function atto(value: Num | undefined | null): bigint {
  if (value === undefined || value === null) return 0n
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(Math.round(value))
  const text = String(value).trim()
  if (!/^-?\d+$/.test(text)) return 0n
  return BigInt(text)
}

export function gen(value: Num | undefined | null, maxDigits = 4): string {
  const raw = atto(value)
  const negative = raw < 0n
  const abs = negative ? -raw : raw
  const whole = abs / ATTO
  const fraction = abs % ATTO
  if (fraction === 0n) return (negative ? '-' : '') + whole.toLocaleString('en-US')
  const full = fraction.toString().padStart(18, '0')
  let shown = full.slice(0, maxDigits).replace(/0+$/, '')
  if (shown.length === 1) shown = full.slice(0, 2)
  return (negative ? '-' : '') + whole.toLocaleString('en-US') + '.' + shown
}

export function genCompact(value: Num | undefined | null): string {
  const raw = atto(value)
  const whole = Number(raw / ATTO)
  if (whole >= 1_000_000) return (whole / 1_000_000).toFixed(1) + 'M'
  if (whole >= 1_000) return (whole / 1_000).toFixed(1) + 'k'
  return gen(raw, 2)
}

export function parseGen(input: string): bigint {
  const text = input.trim().replace(/,/g, '')
  if (!/^\d*(\.\d*)?$/.test(text) || text === '' || text === '.') return 0n
  const [whole, fraction = ''] = text.split('.')
  const padded = (fraction + '0'.repeat(18)).slice(0, 18)
  return BigInt(whole || '0') * ATTO + BigInt(padded || '0')
}

export function pct(value: Num | undefined | null, digits = 0): string {
  return (Number(atto(value)) / 100).toFixed(digits) + '%'
}

export function num(value: Num | undefined | null): number {
  return Number(atto(value))
}

export function short(value: string | undefined | null): string {
  if (!value) return '—'
  if (value.length <= 14) return value
  return value.slice(0, 6) + '…' + value.slice(-4)
}

export function shortId(value: string | undefined | null): string {
  if (!value) return '—'
  return value
}

export function stampDate(value: Num | undefined | null): string {
  const seconds = num(value)
  if (!seconds) return '—'
  return new Date(seconds * 1000).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function stampDateTime(value: Num | undefined | null): string {
  const seconds = num(value)
  if (!seconds) return '—'
  return new Date(seconds * 1000).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function countdown(value: Num | undefined | null): string {
  const seconds = num(value) - Math.floor(Date.now() / 1000)
  if (seconds <= 0) return 'closed'
  const days = Math.floor(seconds / 86_400)
  if (days >= 1) return days + 'd left'
  const hours = Math.floor(seconds / 3_600)
  if (hours >= 1) return hours + 'h left'
  return Math.max(1, Math.floor(seconds / 60)) + 'm left'
}

export function sameAddress(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false
  return a.toLowerCase() === b.toLowerCase()
}

export function plural(value: number, one: string, many = one + 's'): string {
  return value + ' ' + (value === 1 ? one : many)
}

export function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase()
}
