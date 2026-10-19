import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, applyPlan } from '../src/config'
import {
  buildQuotaView,
  creditsToExact,
  exactQuotaView,
  FIVE_HOUR_MS,
  inferPlanFromCaps,
  inferPlanFromText,
  localQuotaView,
  parseUsageOverlay,
  periodStart,
  rollWindow,
} from '../src/quota'
import type { ExactQuota, UsageSample } from '../src/types'

const NOW = new Date('2026-10-19T12:00:00Z').getTime()
const HOUR = 60 * 60 * 1000

function sample(id: string, hoursAgo: number, cost: number): UsageSample {
  return { id, at: NOW - hoursAgo * HOUR, cost }
}

describe('rollWindow', () => {
  it('anchors on the first request of the active window', () => {
    const meter = rollWindow(
      [sample('a', 4, 1), sample('b', 2, 2), sample('c', 1, 3)],
      NOW,
      FIVE_HOUR_MS,
      20,
    )
    expect(meter.used).toBe(6)
    expect(meter.percent).toBe(30)
    expect(meter.resetAt).toBe(NOW - 4 * HOUR + FIVE_HOUR_MS)
  })

  it('reports zero once the window has elapsed', () => {
    const meter = rollWindow([sample('a', 8, 4)], NOW, FIVE_HOUR_MS, 20)
    expect(meter.used).toBe(0)
    expect(meter.resetAt).toBeNull()
  })

  it('ignores future samples', () => {
    const meter = rollWindow([sample('a', -1, 4)], NOW, FIVE_HOUR_MS, 20)
    expect(meter.used).toBe(0)
  })
})

describe('periodStart', () => {
  it('starts at the configured cycle day', () => {
    const start = periodStart(NOW, 1)
    expect(new Date(start).getDate()).toBe(1)
    const custom = periodStart(NOW, 25)
    expect(new Date(custom).getDate()).toBe(25)
    expect(custom).toBeLessThan(NOW)
  })
})

describe('localQuotaView', () => {
  it('builds the three local meters from weighted samples', () => {
    const config = applyPlan(DEFAULT_CONFIG, 'goat')
    const view = localQuotaView(
      config,
      [sample('a', 4, 3), sample('b', 2, 4), sample('c', 48, 10)],
      NOW,
    )
    expect(view).toBeDefined()
    expect(view?.source).toBe('local')
    expect(view?.fiveHour.used).toBe(7)
    expect(view?.weekly.used).toBe(17)
    expect(view?.monthly.used).toBe(17)
    expect(view?.fiveHour.percent).toBe(50)
  })

  it('returns nothing without a plan', () => {
    expect(localQuotaView(DEFAULT_CONFIG, [], NOW)).toBeUndefined()
  })

  it('uses a rolling 30d monthly window when no cycle day is set', () => {
    const config = { ...applyPlan(DEFAULT_CONFIG, 'goat'), cycleDay: 0 }
    const view = localQuotaView(
      config,
      [sample('old', 40 * 24, 5), sample('recent', 10 * 24, 2)],
      NOW,
    )
    expect(view?.monthly.used).toBe(2)
    expect(view?.monthly.resetAt).toBeNull()
  })
})

describe('exact quota', () => {
  const exact: ExactQuota = {
    fiveHourPercent: 32,
    weeklyPercent: 41,
    monthlyPercent: 55,
    fiveHourReset: '3h 12m',
    weeklyReset: '2d 4h',
    capturedAt: NOW - 5 * 60_000,
  }

  it('maps exact percentages into meters', () => {
    const config = applyPlan(DEFAULT_CONFIG, 'pro')
    const view = exactQuotaView(exact, config)
    expect(view.source).toBe('exact')
    expect(view.fiveHour.percent).toBe(32)
    expect(view.weekly.percent).toBe(41)
    expect(view.monthly.percent).toBe(55)
    expect(view.fiveHour.resetText).toBe('3h 12m')
  })

  it('prefers fresh exact data in auto mode', () => {
    const config = applyPlan(DEFAULT_CONFIG, 'pro')
    const view = buildQuotaView(config, [], exact, NOW)
    expect(view?.source).toBe('exact')
  })

  it('falls back to local data when the snapshot is stale', () => {
    const config = applyPlan(DEFAULT_CONFIG, 'pro')
    const stale = { ...exact, capturedAt: NOW - 31 * 60_000 }
    const view = buildQuotaView(config, [sample('a', 1, 8)], stale, NOW)
    expect(view?.source).toBe('local')
    expect(view?.fiveHour.used).toBe(8)
  })

  it('respects an exact-only source', () => {
    const config = { ...applyPlan(DEFAULT_CONFIG, 'pro'), quotaSource: 'exact' as const }
    expect(buildQuotaView(config, [], undefined, NOW)).toBeUndefined()
  })

  it('keeps a manual snapshot even when it is stale', () => {
    const config = { ...applyPlan(DEFAULT_CONFIG, 'pro'), quotaSource: 'manual' as const }
    const stale = { ...exact, capturedAt: NOW - 24 * 60 * 60_000 }
    expect(buildQuotaView(config, [], stale, NOW)?.source).toBe('exact')
  })
})

describe('parseUsageOverlay', () => {
  it('parses the documented /usage meters', () => {
    const parsed = parseUsageOverlay(
      [
        'Usage limits',
        '5-hour ███░░░░░░░ 32% · resets in 3h 12m',
        'Weekly ████░░░░░░ 41% · resets in 2d 4h',
        'Credits $12.50',
      ].join('\n'),
      NOW,
    )
    expect(parsed?.fiveHourPercent).toBe(32)
    expect(parsed?.weeklyPercent).toBe(41)
    expect(parsed?.fiveHourReset).toBe('3h 12m')
    expect(parsed?.weeklyReset).toBe('2d 4h')
    expect(parsed?.credits).toBe(12.5)
    expect(parsed?.capturedAt).toBe(NOW)
  })

  it('parses ANSI-wrapped output and monthly money', () => {
    const parsed = parseUsageOverlay(
      '\u001B[2mMonthly\u001B[0m 75% · resets in 12d\n$23.40 of $80.00/mo',
      NOW,
    )
    expect(parsed?.monthlyPercent).toBe(75)
    expect(parsed?.monthlyUsed).toBe(23.4)
    expect(parsed?.monthlyCap).toBe(80)
  })

  it('ignores unrelated command output', () => {
    expect(parseUsageOverlay('Compacted 3 messages', NOW)).toBeUndefined()
  })
})

describe('creditsToExact', () => {
  const payload = {
    credits: {
      belowThreshold: false,
      creditThreshold: 0,
      monthlyCredits: 60,
      purchasedCredits: 0,
      freeCredits: 0,
    },
    windowLimits: {
      limited: true,
      exceeded: null,
      fiveHour: {
        used: 2,
        cap: 14,
        exceeded: false,
        resetAt: NOW + 3_600_000,
      },
      weekly: {
        used: 7,
        cap: 35,
        exceeded: false,
        resetAt: NOW + 5 * 86_400_000,
      },
    },
  }

  it('parses the billing/credits payload and infers the plan', () => {
    const parsed = creditsToExact(payload, 0, NOW)
    expect(parsed?.plan).toBe('goat')
    expect(parsed?.exact.fiveHourPercent).toBe(14)
    expect(parsed?.exact.weeklyPercent).toBe(20)
    expect(parsed?.exact.monthlyPercent).toBe(14)
    expect(parsed?.exact.fiveHourResetAt).toBe(NOW + 3_600_000)
    expect(parsed?.exact.weeklyResetAt).toBe(NOW + 5 * 86_400_000)
    expect(parsed?.exact.monthlyUsed).toBeCloseTo(10, 3)
    expect(parsed?.exact.monthlyCap).toBe(70)
    expect(parsed?.exact.capturedAt).toBe(NOW)
  })

  it('maps caps to a plan', () => {
    expect(inferPlanFromCaps(14, 35)).toBe('goat')
    expect(inferPlanFromCaps(16, 40)).toBe('pro')
    expect(inferPlanFromCaps(2, 5)).toBe('go')
    expect(inferPlanFromCaps(1, 1)).toBeUndefined()
  })

  it('uses the configured monthly cap when the plan is unknown', () => {
    const parsed = creditsToExact(
      {
        credits: { monthlyCredits: 40 },
        windowLimits: { fiveHour: { used: 5, cap: 10, resetAt: NOW + 1000 } },
      },
      80,
      NOW,
    )
    expect(parsed?.plan).toBeUndefined()
    expect(parsed?.exact.monthlyPercent).toBe(50)
    expect(parsed?.exact.monthlyUsed).toBe(40)
  })

  it('returns undefined for unrelated payloads', () => {
    expect(creditsToExact({ ok: true }, 0, NOW)).toBeUndefined()
  })
})

describe('inferPlanFromText', () => {
  it('maps plan labels to quota plans', () => {
    expect(inferPlanFromText('Plan: GOAT')).toBe('goat')
    expect(inferPlanFromText('Max 10x plan')).toBe('max10')
    expect(inferPlanFromText('Max 20x plan')).toBe('max20')
    expect(inferPlanFromText('Team Pro subscription')).toBe('team-pro')
    expect(inferPlanFromText('Plan: Pro')).toBe('pro')
    expect(inferPlanFromText('Plan: Go')).toBe('go')
  })

  it('does not match unrelated words', () => {
    expect(inferPlanFromText('Compacted 3 messages')).toBeUndefined()
  })
})
