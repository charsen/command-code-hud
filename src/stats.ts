import type { HudStats, PersistedStats, UsageTotals } from './types'
import { addUsage, EMPTY_USAGE, normalizeUsage } from './usage'

export function createStats(now = Date.now()): HudStats {
  return {
    startedAt: now,
    running: false,
    turns: 0,
    compactions: 0,
    compactionTokens: 0,
    toolErrors: 0,
    tools: {},
    usage: { ...EMPTY_USAGE },
    agentTokens: 0,
  }
}

export function addTurn(stats: HudStats, usage: unknown): HudStats {
  return {
    ...stats,
    turns: stats.turns + 1,
    usage: addUsage(stats.usage, usage),
  }
}

export function addModelUsage(stats: HudStats, usage: unknown): HudStats {
  return {
    ...stats,
    usage: addUsage(stats.usage, usage),
  }
}

export function recordTool(stats: HudStats, name: string, isError: boolean): HudStats {
  return {
    ...stats,
    toolErrors: stats.toolErrors + (isError ? 1 : 0),
    tools: {
      ...stats.tools,
      [name]: (stats.tools[name] ?? 0) + 1,
    },
  }
}

export function recordCompaction(stats: HudStats, tokensSaved: unknown): HudStats {
  const saved = typeof tokensSaved === 'number' && Number.isFinite(tokensSaved) ? tokensSaved : 0
  return {
    ...stats,
    compactions: stats.compactions + 1,
    compactionTokens: stats.compactionTokens + Math.max(0, saved),
  }
}

export function recordAgentUsage(stats: HudStats, tokensUsed: unknown): HudStats {
  const used = typeof tokensUsed === 'number' && Number.isFinite(tokensUsed) ? tokensUsed : 0
  return {
    ...stats,
    agentTokens: stats.agentTokens + Math.max(0, used),
  }
}

export function topTools(stats: HudStats, limit = 3): Array<{ name: string; count: number }> {
  return Object.entries(stats.tools)
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, limit)
}

export function toPersisted(stats: HudStats): PersistedStats {
  return {
    startedAt: stats.startedAt,
    turns: stats.turns,
    compactions: stats.compactions,
    compactionTokens: stats.compactionTokens,
    toolErrors: stats.toolErrors,
    usage: { ...stats.usage },
    agentTokens: stats.agentTokens,
  }
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function readUsage(value: unknown): UsageTotals {
  if (!value || typeof value !== 'object') return { ...EMPTY_USAGE }
  const usage = value as Record<string, unknown>
  return {
    input: finiteNumber(usage.input),
    output: finiteNumber(usage.output),
    cacheRead: finiteNumber(usage.cacheRead),
    cacheWrite: finiteNumber(usage.cacheWrite),
    total: finiteNumber(usage.total),
  }
}

export function fromPersisted(raw: unknown, now = Date.now()): HudStats | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  return {
    startedAt:
      typeof value.startedAt === 'number' && Number.isFinite(value.startedAt)
        ? value.startedAt
        : now,
    running: false,
    turns: finiteNumber(value.turns),
    compactions: finiteNumber(value.compactions),
    compactionTokens: finiteNumber(value.compactionTokens),
    toolErrors: finiteNumber(value.toolErrors),
    tools: {},
    usage: readUsage(value.usage),
    agentTokens: finiteNumber(value.agentTokens),
  }
}

export function normalizeTurnUsage(raw: unknown): UsageTotals {
  return normalizeUsage(raw)
}
