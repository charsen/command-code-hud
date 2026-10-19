import type { UsageTotals } from './types'

export const EMPTY_USAGE: UsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
}

const INPUT_KEYS = [
  'inputtokens',
  'inputtoken',
  'prompttokens',
  'prompttoken',
  'inputtotal',
  'input',
  'prompt',
  'prompttotal',
]

const OUTPUT_KEYS = [
  'outputtokens',
  'outputtoken',
  'completiontokens',
  'completiontoken',
  'outputtotal',
  'output',
  'completion',
]

const CACHE_READ_KEYS = [
  'cachereadtokens',
  'cachereadinputtokens',
  'inputcachereadtokens',
  'inputcachedtokens',
  'cachereadtoken',
  'cachedinputtokens',
  'cachedinputtoken',
  'promptcachedtokens',
  'promptcachehittokens',
  'cachereadinput',
  'cacheread',
]

const CACHE_WRITE_KEYS = [
  'cachewritetokens',
  'cachewriteinputtokens',
  'inputcachewritetokens',
  'cachecreationinputtokens',
  'cachecreationtokens',
  'cachewritetoken',
  'cachewriteinput',
  'cachewrite',
]

const TOTAL_KEYS = ['totaltokens', 'totaltoken', 'total']

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, '')
}

function flattenNumbers(
  value: unknown,
  out: Map<string, number>,
  depth = 0,
  prefix = '',
): void {
  if (depth > 4 || value === null || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const path = `${prefix}${normalizeKey(key)}`
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      if (!out.has(path)) out.set(path, entry)
    } else if (typeof entry === 'string' && /^\d+(?:\.\d+)?$/.test(entry)) {
      if (!out.has(path)) out.set(path, Number(entry))
    } else if (entry && typeof entry === 'object') {
      flattenNumbers(entry, out, depth + 1, path)
    }
  }
}

function pick(values: Map<string, number>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = values.get(key)
    if (value !== undefined) return value
  }
  return undefined
}

export function normalizeUsage(raw: unknown): UsageTotals {
  const values = new Map<string, number>()
  flattenNumbers(raw, values)
  if (values.size === 0) return { ...EMPTY_USAGE }

  const input = pick(values, INPUT_KEYS)
  const output = pick(values, OUTPUT_KEYS)
  const cacheRead = pick(values, CACHE_READ_KEYS)
  const cacheWrite = pick(values, CACHE_WRITE_KEYS)
  const total = pick(values, TOTAL_KEYS)

  let resolvedInput = Math.max(0, input ?? 0)
  let resolvedOutput = Math.max(0, output ?? 0)
  let resolvedTotal = Math.max(0, total ?? 0)

  if (resolvedTotal === 0 && (resolvedInput > 0 || resolvedOutput > 0)) {
    resolvedTotal = resolvedInput + resolvedOutput
  }
  if (resolvedInput === 0 && resolvedTotal > resolvedOutput) {
    resolvedInput = resolvedTotal - resolvedOutput
  }
  if (resolvedTotal === 0 && resolvedInput === 0 && resolvedOutput === 0) {
    return { ...EMPTY_USAGE }
  }

  return {
    input: resolvedInput,
    output: resolvedOutput,
    cacheRead: Math.max(0, cacheRead ?? 0),
    cacheWrite: Math.max(0, cacheWrite ?? 0),
    total: resolvedTotal || resolvedInput + resolvedOutput,
  }
}

export function addUsage(base: UsageTotals, raw: unknown): UsageTotals {
  const next = normalizeUsage(raw)
  return {
    input: base.input + next.input,
    output: base.output + next.output,
    cacheRead: base.cacheRead + next.cacheRead,
    cacheWrite: base.cacheWrite + next.cacheWrite,
    total: base.total + next.total,
  }
}

export function cacheHitRate(usage: UsageTotals): number | null {
  if (usage.input <= 0 || usage.cacheRead <= 0) return null
  return Math.min(100, Math.round((usage.cacheRead / usage.input) * 100))
}

export function hasUsage(usage: UsageTotals): boolean {
  return usage.input > 0 || usage.output > 0 || usage.total > 0
}
