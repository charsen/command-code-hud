import { stripAnsi } from './format'
import { normalizePlan, QUOTA_PLANS } from './config'
import type {
  ExactQuota,
  HudConfig,
  QuotaPlanId,
  QuotaView,
  UsageSample,
  WindowMeter,
} from './types'

export const FIVE_HOUR_MS = 5 * 60 * 60 * 1000
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const ROLLING_MONTH_MS = 30 * 24 * 60 * 60 * 1000
export const EXACT_TTL_MS = 30 * 60 * 1000

function meter(used: number, cap: number, resetAt: number | null): WindowMeter {
  return {
    used: Math.max(0, used),
    cap: Math.max(0, cap),
    percent: cap > 0 ? Math.round((Math.max(0, used) / cap) * 100) : null,
    resetAt,
  }
}

export function rollWindow(
  samples: readonly UsageSample[],
  now: number,
  durationMs: number,
  cap: number,
): WindowMeter {
  const ordered = [...samples].sort((left, right) => left.at - right.at)
  let anchor: number | null = null
  let used = 0
  for (const sample of ordered) {
    if (sample.at > now) continue
    if (anchor === null || sample.at >= anchor + durationMs) {
      anchor = sample.at
      used = 0
    }
    used += sample.cost
  }
  if (anchor === null) return meter(0, cap, null)
  const resetAt = anchor + durationMs
  if (now >= resetAt) return meter(0, cap, null)
  return meter(used, cap, resetAt)
}

export function periodStart(now: number, cycleDay: number): number {
  const date = new Date(now)
  const day = Math.min(28, Math.max(1, Math.round(cycleDay)))
  const year = date.getFullYear()
  const month = date.getMonth()
  const candidate = new Date(year, month, day, 0, 0, 0, 0).getTime()
  if (date.getDate() >= day) return candidate
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
}

function nextPeriodStart(start: number, cycleDay: number): number {
  const date = new Date(start)
  const day = Math.min(28, Math.max(1, Math.round(cycleDay)))
  return new Date(date.getFullYear(), date.getMonth() + 1, day, 0, 0, 0, 0).getTime()
}

export function sumSamples(samples: readonly UsageSample[], since: number, now: number): number {
  let total = 0
  for (const sample of samples) {
    if (sample.at >= since && sample.at <= now) total += sample.cost
  }
  return total
}

function exactMeter(
  percent: number | undefined,
  cap: number,
  resetText: string | undefined,
  used?: number,
  resetAt?: number,
): WindowMeter {
  const safePercent =
    percent === undefined || !Number.isFinite(percent) ? null : Math.max(0, percent)
  const safeCap = Math.max(0, cap)
  const safeUsed =
    used !== undefined && Number.isFinite(used)
      ? Math.max(0, used)
      : safePercent !== null && safeCap > 0
        ? (safePercent / 100) * safeCap
        : 0
  return {
    used: safeUsed,
    cap: safeCap,
    percent: safePercent,
    resetAt: resetAt !== undefined && Number.isFinite(resetAt) ? resetAt : null,
    ...(resetText ? { resetText } : {}),
  }
}

export function exactQuotaView(exact: ExactQuota, config: HudConfig): QuotaView {
  const monthlyCap =
    exact.monthlyCap !== undefined && exact.monthlyCap > 0
      ? exact.monthlyCap
      : config.monthlyCap
  return {
    source: 'exact',
    fiveHour: exactMeter(
      exact.fiveHourPercent,
      config.fiveHourCap,
      exact.fiveHourReset,
      undefined,
      exact.fiveHourResetAt,
    ),
    weekly: exactMeter(
      exact.weeklyPercent,
      config.weeklyCap,
      exact.weeklyReset,
      undefined,
      exact.weeklyResetAt,
    ),
    monthly: exactMeter(
      exact.monthlyPercent,
      monthlyCap,
      exact.monthlyReset,
      exact.monthlyUsed,
      exact.monthlyResetAt,
    ),
    capturedAt: exact.capturedAt,
  }
}

export function localQuotaView(
  config: HudConfig,
  samples: readonly UsageSample[],
  now: number,
): QuotaView | undefined {
  if (config.plan === 'none') return undefined
  if (config.fiveHourCap <= 0 && config.weeklyCap <= 0 && config.monthlyCap <= 0) {
    return undefined
  }
  const calendar = config.cycleDay > 0
  const start = calendar ? periodStart(now, config.cycleDay) : now - ROLLING_MONTH_MS
  const monthlyUsed = sumSamples(samples, start, now)
  return {
    source: 'local',
    fiveHour: rollWindow(samples, now, FIVE_HOUR_MS, config.fiveHourCap),
    weekly: rollWindow(samples, now, WEEK_MS, config.weeklyCap),
    monthly: meter(
      monthlyUsed,
      config.monthlyCap,
      calendar ? nextPeriodStart(start, config.cycleDay) : null,
    ),
  }
}

export function buildQuotaView(
  config: HudConfig,
  samples: readonly UsageSample[],
  exact: ExactQuota | undefined,
  now: number,
): QuotaView | undefined {
  if (!config.items.includes('quota')) return undefined

  if (config.quotaSource === 'exact' || config.quotaSource === 'manual') {
    return exact ? exactQuotaView(exact, config) : undefined
  }

  const fresh = exact !== undefined && now - exact.capturedAt <= EXACT_TTL_MS
  if (config.quotaSource === 'auto' && fresh && exact) {
    return exactQuotaView(exact, config)
  }

  return localQuotaView(config, samples, now)
}

function labelledPercent(text: string, label: string): number | undefined {
  const match = new RegExp(
    `(?:${label})[^\\n%]{0,80}?(\\d{1,3})\\s*%`,
    'i',
  ).exec(text)
  return match ? Number(match[1]) : undefined
}

function resetText(text: string, label: string): string | undefined {
  const match = new RegExp(
    `(?:${label})[^\\n]{0,120}?resets?\\s+(?:in|at)\\s+([^·|,)\\n]+)`,
    'i',
  ).exec(text)
  return match?.[1]?.trim()
}

const PLAN_PATTERNS: Array<[RegExp, QuotaPlanId]> = [
  [/\bmax\s*20\s*x\b/i, 'max20'],
  [/\bmax\s*10\s*x\b/i, 'max10'],
  [/\bteam\s*pro\b/i, 'team-pro'],
  [/\bgoat\b/i, 'goat'],
  [/\bgo\b/i, 'go'],
  [/\bpro\b/i, 'pro'],
]

export function inferPlanFromText(text: string): QuotaPlanId | undefined {
  const clean = stripAnsi(text)
  const direct = normalizePlan(clean)
  if (direct && direct !== 'none') return direct
  for (const [pattern, plan] of PLAN_PATTERNS) {
    if (pattern.test(clean)) return plan
  }
  return undefined
}

export function planLabel(plan: QuotaPlanId): string {
  if (plan === 'none' || plan === 'custom') return plan
  return QUOTA_PLANS[plan].label
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function percentOf(used: number | undefined, cap: number | undefined): number | undefined {
  if (used === undefined || cap === undefined || cap <= 0) return undefined
  return Math.round((Math.max(0, used) / cap) * 100)
}

export function inferPlanFromCaps(
  fiveHourCap: number | undefined,
  weeklyCap: number | undefined,
): QuotaPlanId | undefined {
  if (fiveHourCap === undefined || weeklyCap === undefined) return undefined
  for (const [plan, caps] of Object.entries(QUOTA_PLANS)) {
    if (
      Math.abs(caps.fiveHour - fiveHourCap) < 0.01 &&
      Math.abs(caps.weekly - weeklyCap) < 0.01
    ) {
      return plan as QuotaPlanId
    }
  }
  return undefined
}

export function creditsToExact(
  raw: unknown,
  monthlyCapHint = 0,
  now = Date.now(),
): { exact: ExactQuota; plan?: QuotaPlanId } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const payload = raw as Record<string, unknown>
  const windows =
    payload.windowLimits && typeof payload.windowLimits === 'object'
      ? (payload.windowLimits as Record<string, unknown>)
      : {}
  const five =
    windows.fiveHour && typeof windows.fiveHour === 'object'
      ? (windows.fiveHour as Record<string, unknown>)
      : undefined
  const weekly =
    windows.weekly && typeof windows.weekly === 'object'
      ? (windows.weekly as Record<string, unknown>)
      : undefined

  const fiveUsed = numeric(five?.used)
  const fiveCap = numeric(five?.cap)
  const fiveResetAt = numeric(five?.resetAt)
  const weeklyUsed = numeric(weekly?.used)
  const weeklyCap = numeric(weekly?.cap)
  const weeklyResetAt = numeric(weekly?.resetAt)

  const credits =
    payload.credits && typeof payload.credits === 'object'
      ? (payload.credits as Record<string, unknown>)
      : undefined
  const monthlyCredits = numeric(credits?.monthlyCredits)

  const plan = inferPlanFromCaps(fiveCap, weeklyCap)
  const monthlyCap =
    plan !== undefined && plan !== 'custom' && plan !== 'none'
      ? QUOTA_PLANS[plan].monthly
      : monthlyCapHint
  const monthlyUsed =
    monthlyCap > 0 && monthlyCredits !== undefined
      ? Math.max(0, monthlyCap - monthlyCredits)
      : undefined
  const monthlyPercent =
    monthlyUsed !== undefined ? percentOf(monthlyUsed, monthlyCap) : undefined

  const fiveHourPercent = percentOf(fiveUsed, fiveCap)
  const weeklyPercent = percentOf(weeklyUsed, weeklyCap)
  if (
    fiveHourPercent === undefined &&
    weeklyPercent === undefined &&
    monthlyPercent === undefined &&
    monthlyCredits === undefined
  ) {
    return undefined
  }

  return {
    plan,
    exact: {
      ...(fiveHourPercent !== undefined ? { fiveHourPercent } : {}),
      ...(weeklyPercent !== undefined ? { weeklyPercent } : {}),
      ...(monthlyPercent !== undefined ? { monthlyPercent } : {}),
      ...(fiveResetAt !== undefined ? { fiveHourResetAt: fiveResetAt } : {}),
      ...(weeklyResetAt !== undefined ? { weeklyResetAt: weeklyResetAt } : {}),
      ...(monthlyUsed !== undefined ? { monthlyUsed } : {}),
      ...(monthlyCap > 0 ? { monthlyCap } : {}),
      ...(monthlyCredits !== undefined ? { credits: monthlyCredits } : {}),
      capturedAt: now,
    },
  }
}

function money(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

export function parseUsageOverlay(text: string, now = Date.now()): ExactQuota | undefined {
  const clean = stripAnsi(text).replace(/\r/g, '')
  if (!/(5\s*-?\s*h|week|month|credits?|usage limit)/i.test(clean)) return undefined
  const lines = clean.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length === 0) return undefined

  const fiveHourPattern = '5\\s*-?\\s*h(?:our)?s?|five[-\\s]?hour'
  const weeklyPattern = 'week(?:ly)?|7\\s*-?\\s*d(?:ay)?s?|1\\s*w'
  const monthlyPattern = 'month(?:ly)?|30\\s*-?\\s*d(?:ay)?s?|\\bmo\\b'

  const fiveHourPercent = labelledPercent(clean, fiveHourPattern)
  const weeklyPercent = labelledPercent(clean, weeklyPattern)
  const monthlyPercent = labelledPercent(clean, monthlyPattern)

  let monthlyUsed: number | undefined
  let monthlyCap: number | undefined
  for (const line of lines) {
    if (!/month|credits?|\bmo\b/i.test(line)) continue
    const match = /\$\s*([\d,.]+)\s*(?:of|\/)\s*\$?\s*([\d,.]+)/i.exec(line)
    if (match) {
      monthlyUsed = money(match[1])
      monthlyCap = money(match[2])
      break
    }
  }

  let credits: number | undefined
  for (const line of lines) {
    if (!/credits?|balance/i.test(line)) continue
    const match = /\$\s*([\d,.]+)/.exec(line)
    if (match) {
      credits = money(match[1])
      break
    }
  }

  if (
    fiveHourPercent === undefined &&
    weeklyPercent === undefined &&
    monthlyPercent === undefined &&
    credits === undefined
  ) {
    return undefined
  }

  return {
    ...(fiveHourPercent !== undefined ? { fiveHourPercent } : {}),
    ...(weeklyPercent !== undefined ? { weeklyPercent } : {}),
    ...(monthlyPercent !== undefined ? { monthlyPercent } : {}),
    ...(monthlyUsed !== undefined ? { monthlyUsed } : {}),
    ...(monthlyCap !== undefined ? { monthlyCap } : {}),
    ...(credits !== undefined ? { credits } : {}),
    ...(resetText(clean, fiveHourPattern)
      ? { fiveHourReset: resetText(clean, fiveHourPattern) }
      : {}),
    ...(resetText(clean, weeklyPattern)
      ? { weeklyReset: resetText(clean, weeklyPattern) }
      : {}),
    ...(resetText(clean, monthlyPattern)
      ? { monthlyReset: resetText(clean, monthlyPattern) }
      : {}),
    capturedAt: now,
  }
}
