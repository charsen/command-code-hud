import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  formatTokens,
  progressBar,
  safeText,
  stripAnsi,
  truncateAnsi,
  visibleWidth,
} from '../src/format'

describe('formatTokens', () => {
  it('formats plain and compact values', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_500)).toBe('1.5K')
    expect(formatTokens(32_400)).toBe('32.4K')
    expect(formatTokens(7_600_000)).toBe('7.6M')
    expect(formatTokens(1_050_000_000)).toBe('1.1B')
  })
})

describe('formatDuration', () => {
  it('formats minutes, hours and days', () => {
    expect(formatDuration(30_000)).toBe('<1m')
    expect(formatDuration(90_000)).toBe('1m')
    expect(formatDuration(3 * 3_600_000 + 14 * 60_000)).toBe('3h 14m')
    expect(formatDuration(26 * 3_600_000)).toBe('1d 2h')
  })
})

describe('progressBar', () => {
  it('fills proportionally and clamps', () => {
    expect(progressBar(0, 10)).toBe('░░░░░░░░░░')
    expect(progressBar(50, 10)).toBe('█████░░░░░')
    expect(progressBar(120, 10)).toBe('██████████')
  })

  it('supports the slim half-block style', () => {
    expect(progressBar(50, 10, 'half')).toBe('▄▄▄▄▄▁▁▁▁▁')
    expect(progressBar(21, 10, 'half')).toBe('▄▄▁▁▁▁▁▁▁▁')
    expect(progressBar(50, 10, 'none')).toBe('')
  })
})

describe('width helpers', () => {
  it('counts wide CJK characters as two columns', () => {
    expect(visibleWidth('上下文')).toBe(6)
    expect(visibleWidth('\u001B[31mabc\u001B[0m')).toBe(3)
  })

  it('truncates ANSI text without leaking styles', () => {
    const result = truncateAnsi('\u001B[31mhello world\u001B[0m', 6)
    expect(result).toContain('…')
    expect(visibleWidth(result)).toBe(6)
    expect(result.endsWith('\u001B[0m')).toBe(true)
    expect(stripAnsi(result)).toBe('hello…')
  })

  it('leaves short text untouched', () => {
    expect(truncateAnsi('abc', 10)).toBe('abc')
    expect(truncateAnsi('abc', 0)).toBe('')
  })
})

describe('safeText', () => {
  it('removes control characters and collapses whitespace', () => {
    expect(safeText('a\n\tb   c')).toBe('a b c')
  })
})
