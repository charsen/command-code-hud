import { describe, expect, it } from 'vitest'
import { addUsage, cacheHitRate, EMPTY_USAGE, normalizeUsage } from '../src/usage'

describe('normalizeUsage', () => {
  it('reads snake_case provider usage', () => {
    expect(
      normalizeUsage({
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 40,
        cache_creation_input_tokens: 10,
      }),
    ).toEqual({ input: 100, output: 50, cacheRead: 40, cacheWrite: 10, total: 150 })
  })

  it('reads camelCase usage and an explicit total', () => {
    expect(
      normalizeUsage({
        inputTokens: 1_000,
        outputTokens: 200,
        cacheReadTokens: 800,
        totalTokens: 1_200,
      }),
    ).toEqual({ input: 1_000, output: 200, cacheRead: 800, cacheWrite: 0, total: 1_200 })
  })

  it('reads nested usage without mixing input and output totals', () => {
    expect(
      normalizeUsage({
        input: { tokens: 100, total: 120, cache_read_tokens: 60 },
        output: { tokens: 20, total: 25 },
      }),
    ).toEqual({ input: 100, output: 20, cacheRead: 60, cacheWrite: 0, total: 120 })
  })

  it('derives the total from input and output', () => {
    expect(normalizeUsage({ input_tokens: 10, output_tokens: 5 })).toEqual({
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      total: 15,
    })
  })

  it('ignores empty and non-numeric payloads', () => {
    expect(normalizeUsage(undefined)).toEqual(EMPTY_USAGE)
    expect(normalizeUsage({ note: 'n/a' })).toEqual(EMPTY_USAGE)
    expect(normalizeUsage({ input_tokens: '12', output_tokens: 3 })).toEqual({
      input: 12,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
      total: 15,
    })
  })
})

describe('addUsage', () => {
  it('accumulates totals', () => {
    const first = addUsage(EMPTY_USAGE, { input_tokens: 10, output_tokens: 5 })
    const second = addUsage(first, { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 10 })
    expect(second).toEqual({
      input: 30,
      output: 10,
      cacheRead: 10,
      cacheWrite: 0,
      total: 40,
    })
  })
})

describe('cacheHitRate', () => {
  it('returns the share of cached input', () => {
    expect(
      cacheHitRate({ input: 1_000, output: 10, cacheRead: 950, cacheWrite: 0, total: 1_010 }),
    ).toBe(95)
  })

  it('returns null without cache data', () => {
    expect(cacheHitRate(EMPTY_USAGE)).toBeNull()
  })
})
