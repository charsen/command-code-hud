import { describe, expect, it } from 'vitest'
import {
  addTurn,
  createStats,
  fromPersisted,
  recordAgentUsage,
  recordCompaction,
  recordTool,
  toPersisted,
  topTools,
} from '../src/stats'

describe('stats', () => {
  it('starts empty with a session start time', () => {
    const stats = createStats(1_000)
    expect(stats.startedAt).toBe(1_000)
    expect(stats.turns).toBe(0)
    expect(stats.tools).toEqual({})
  })

  it('accumulates turn usage', () => {
    const first = addTurn(createStats(), { input_tokens: 100, output_tokens: 20 })
    const second = addTurn(first, { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 40 })
    expect(second.turns).toBe(2)
    expect(second.usage).toEqual({
      input: 150,
      output: 30,
      cacheRead: 40,
      cacheWrite: 0,
      total: 180,
    })
  })

  it('counts tools, errors and returns the most used', () => {
    let stats = createStats()
    stats = recordTool(stats, 'shell_command', false)
    stats = recordTool(stats, 'shell_command', false)
    stats = recordTool(stats, 'read_file', false)
    stats = recordTool(stats, 'shell_command', true)
    expect(stats.tools).toEqual({ shell_command: 3, read_file: 1 })
    expect(stats.toolErrors).toBe(1)
    expect(topTools(stats, 2)).toEqual([
      { name: 'shell_command', count: 3 },
      { name: 'read_file', count: 1 },
    ])
  })

  it('records compactions and subagent tokens', () => {
    const compacted = recordCompaction(createStats(), 12_000)
    expect(compacted.compactions).toBe(1)
    expect(compacted.compactionTokens).toBe(12_000)
    expect(recordAgentUsage(compacted, 3_000).agentTokens).toBe(3_000)
  })

  it('round-trips persisted stats', () => {
    const stats = recordCompaction(
      addTurn(createStats(5_000), { input_tokens: 10, output_tokens: 2 }),
      1_000,
    )
    const restored = fromPersisted(toPersisted(stats), 9_000)
    expect(restored).toBeDefined()
    expect(restored?.turns).toBe(1)
    expect(restored?.usage.total).toBe(12)
    expect(restored?.compactions).toBe(1)
    expect(restored?.startedAt).toBe(5_000)
    expect(restored?.running).toBe(false)
  })

  it('ignores invalid persisted values', () => {
    expect(fromPersisted(undefined)).toBeUndefined()
    expect(fromPersisted({ turns: 'many', usage: null })?.turns).toBe(0)
  })
})
