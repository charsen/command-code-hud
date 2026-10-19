export type ColorName =
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'gray'
  | 'dim'
  | 'bold'

const CODES: Record<ColorName, string> = {
  red: '31',
  green: '32',
  yellow: '33',
  blue: '34',
  magenta: '35',
  cyan: '36',
  gray: '90',
  dim: '2',
  bold: '1',
}

export function paint(text: string, color: ColorName, enabled: boolean): string {
  if (!enabled || text.length === 0) return text
  return `\u001B[${CODES[color]}m${text}\u001B[0m`
}

export function statusColor(percent: number | null | undefined): ColorName {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return 'gray'
  if (percent >= 90) return 'red'
  if (percent >= 70) return 'yellow'
  return 'green'
}

export function colorEnabled(configured: boolean): boolean {
  if (!configured) return false
  return process.env.NO_COLOR === undefined
}
