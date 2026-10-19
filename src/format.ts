const ANSI_PATTERN = /\u001B\[[0-9;]*m/g

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '')
}

function isCombining(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  )
}

function isWide(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )
}

export function charWidth(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0
  if (codePoint === 0 || isCombining(codePoint)) return 0
  if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0
  return isWide(codePoint) ? 2 : 1
}

export function visibleWidth(value: string): number {
  let width = 0
  for (const character of stripAnsi(value)) width += charWidth(character)
  return width
}

export function truncateAnsi(value: string, width: number): string {
  if (width <= 0) return ''
  if (visibleWidth(value) <= width) return value
  if (width === 1) return '…'

  let output = ''
  let used = 0
  let index = 0
  let sawAnsi = false
  const target = width - 1

  while (index < value.length) {
    if (value[index] === '\u001B') {
      const match = /^\u001B\[[0-9;]*m/.exec(value.slice(index))
      if (match) {
        output += match[0]
        sawAnsi = true
        index += match[0].length
        continue
      }
    }
    const character = String.fromCodePoint(value.codePointAt(index) ?? 0)
    const characterWidth = charWidth(character)
    if (used + characterWidth > target) break
    output += character
    used += characterWidth
    index += character.length
  }

  return `${output}…${sawAnsi ? '\u001B[0m' : ''}`
}

export function formatTokens(value: number): string {
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }
  if (absolute >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  }
  return String(Math.round(value))
}

export function formatDuration(milliseconds: number): string {
  const safe = Math.max(0, milliseconds)
  if (safe < 60_000) return '<1m'
  const minutes = Math.floor(safe / 60_000)
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const remaining = minutes % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (remaining > 0 && days === 0) parts.push(`${remaining}m`)
  return parts.join(' ') || '<1m'
}

export function barChars(style: 'block' | 'half' | 'none'): {
  filled: string
  empty: string
} {
  if (style === 'none') return { filled: '', empty: '' }
  if (style === 'half') return { filled: '▄', empty: '▁' }
  return { filled: '█', empty: '░' }
}

export function progressBar(
  percent: number,
  width: number,
  style: 'block' | 'half' | 'none' = 'block',
): string {
  const safeWidth = Math.max(1, width)
  const clamped = Math.min(100, Math.max(0, percent))
  const filled = Math.round((clamped / 100) * safeWidth)
  const chars = barChars(style)
  if (!chars.filled) return ''
  return `${chars.filled.repeat(filled)}${chars.empty.repeat(safeWidth - filled)}`
}

export function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return '$0'
  const absolute = Math.abs(value)
  if (absolute >= 100) return `$${value.toFixed(0)}`
  if (absolute >= 10) return `$${value.toFixed(1).replace(/\.0$/, '')}`
  return `$${value.toFixed(2)}`
}

export function formatResetIn(resetAt: number | null, now: number): string | null {
  if (resetAt === null) return null
  if (resetAt <= now) return 'now'
  return formatDuration(resetAt - now)
}

export function formatPercent(percent: number | null | undefined): string {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return '—'
  return `${Math.round(percent)}%`
}

export function safeText(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127 ? ' ' : character
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

export function joinParts(parts: ReadonlyArray<string | null | undefined>, separator = ' │ '): string {
  return parts.filter((part): part is string => Boolean(part)).join(separator)
}
