import { paint, statusColor } from './colors'
import { hasItem } from './config'
import {
  barChars,
  formatDuration,
  formatMoney,
  formatPercent,
  formatResetIn,
  formatTokens,
  joinParts,
  safeText,
  truncateAnsi,
  visibleWidth,
} from './format'
import { message } from './i18n'
import { topTools } from './stats'
import type { GitStatus, QuotaView, RenderInput, WindowMeter } from './types'
import { cacheHitRate, hasUsage } from './usage'

function coloredBar(input: RenderInput, percent: number, width = 10): string {
  const chars = barChars(input.config.barStyle)
  if (!chars.filled) return ''
  const clamped = Math.min(100, Math.max(0, percent))
  const filled = Math.round((clamped / 100) * width)
  return `${paint(chars.filled.repeat(filled), statusColor(percent), input.color)}${paint(
    chars.empty.repeat(width - filled),
    'gray',
    input.color,
  )}`
}

function projectName(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.split('/').filter(Boolean).at(-1) ?? normalized
}

function compactModel(model: string): string {
  const parts = model.split('/')
  return parts.length > 1 ? (parts.at(-1) ?? model) : model
}

function gitSuffix(git: GitStatus | null | undefined, color: boolean): string | null {
  if (!git) return null
  const star = git.dirty ? paint('*', 'yellow', color) : ''
  const branch = `${paint(safeText(git.branch), 'cyan', color)}${star}`
  const entries: Array<[string, number, Parameters<typeof paint>[1]]> = [
    ['M', git.modified, 'yellow'],
    ['A', git.added, 'green'],
    ['D', git.deleted, 'red'],
    ['R', git.renamed, 'cyan'],
    ['C', git.copied, 'blue'],
    ['T', git.typeChanged, 'magenta'],
    ['!', git.conflicted, 'red'],
    ['?', git.untracked, 'dim'],
  ]
  const stats = entries
    .filter(([, count]) => count > 0)
    .map(([label, count, accent]) => paint(`${label}${count}`, accent, color))
  return joinParts([`${paint('git:(', 'dim', color)}${branch}${paint(')', 'dim', color)}`, ...stats], ' ')
}

function rowIdentity(input: RenderInput): string | null {
  const parts: string[] = []
  if (hasItem(input.config, 'identity')) {
    const model = safeText(compactModel(input.model ?? 'model'))
    const effort = input.effort ? ` ${safeText(input.effort)}` : ''
    parts.push(paint(`[${model}${effort}]`, input.stats.running ? 'magenta' : 'cyan', input.color))
  }
  if (hasItem(input.config, 'project')) {
    parts.push(paint(projectName(input.cwd), 'magenta', input.color))
    const git = gitSuffix(input.git, input.color)
    if (git) parts.push(git)
  }
  if (hasItem(input.config, 'title') && input.sessionName) {
    parts.push(paint(safeText(input.sessionName), 'dim', input.color))
  }
  return parts.length > 0 ? parts.join(' │ ') : null
}

function rowContext(input: RenderInput): string | null {
  const language = input.config.language
  const parts: string[] = []

  if (hasItem(input.config, 'context')) {
    const usage = input.context
    const label = paint(message(language, 'context'), 'dim', input.color)
    if (!usage) {
      parts.push(`${label} —`)
    } else if (usage.percent === null) {
      const bar = coloredBar(input, 0)
      parts.push(`${label} ${bar ? `${bar} ` : ''}—`)
    } else {
      const percent = formatPercent(usage.percent)
      const bar = coloredBar(input, usage.percent)
      const tokens =
        usage.tokens === null
          ? ''
          : ` · ${formatTokens(usage.tokens)}/${formatTokens(usage.contextWindow)}`
      parts.push(`${label} ${bar ? `${bar} ` : ''}${percent}${tokens}`)
    }
  }

  if (hasItem(input.config, 'cache')) {
    const rate = cacheHitRate(input.stats.usage)
    if (rate !== null && input.stats.usage.cacheRead > 0) {
      const rateText = rate >= 100 ? '' : ` · ${rate}%`
      parts.push(
        `${paint(message(language, 'cache'), 'dim', input.color)} ${formatTokens(input.stats.usage.cacheRead)}${rateText}`,
      )
    }
  }

  return parts.length > 0 ? parts.join(' │ ') : null
}

function quotaWindow(
  input: RenderInput,
  label: string,
  meter: WindowMeter,
  showMoney: boolean,
): string | null {
  if (meter.percent === null) return null
  const bar = coloredBar(input, meter.percent)
  let suffix = ` ${meter.percent}%`
  if (meter.resetAt !== null) {
    const reset = formatResetIn(meter.resetAt, input.now)
    if (reset) suffix += ` · ${reset}`
  } else if (meter.resetText) {
    suffix += ` · ${meter.resetText}`
  }
  if (showMoney && meter.cap > 0 && meter.used > 0) {
    suffix += ` (${formatMoney(meter.used)}/${formatMoney(meter.cap)})`
  }
  return `${paint(label, 'dim', input.color)}: ${bar ? `${bar} ` : ''}${suffix.trimStart()}`
}

function rowQuota(input: RenderInput): string | null {
  if (!hasItem(input.config, 'quota')) return null
  const language = input.config.language
  if (!input.quota) {
    return `${paint(message(language, 'quota'), 'dim', input.color)}: ${paint(
      message(language, 'quotaHint'),
      'dim',
      input.color,
    )}`
  }
  const quota: QuotaView = input.quota
  const monthLabel =
    quota.source === 'local' && input.config.cycleDay === 0
      ? message(language, 'rolling30')
      : message(language, 'month')
  const parts = [
    quotaWindow(input, message(language, 'fiveHour'), quota.fiveHour, false),
    quotaWindow(input, message(language, 'weekly'), quota.weekly, false),
    quotaWindow(input, monthLabel, quota.monthly, true),
  ].filter((part): part is string => Boolean(part))
  if (parts.length === 0) return null
  const source =
    quota.source === 'local'
      ? paint(` (${message(language, 'localEstimate')})`, 'dim', input.color)
      : ''
  return `${paint(message(language, 'quota'), 'dim', input.color)}${source} ${parts.join(' │ ')}`
}

function rowActivity(input: RenderInput): string | null {
  const language = input.config.language
  const parts: string[] = []

  if (hasItem(input.config, 'mode') && input.permissionMode) {
    const value = safeText(input.permissionMode)
    const accent =
      value === 'yolo' ? 'red' : value === 'plan' ? 'cyan' : value === 'accept-edits' ? 'green' : 'yellow'
    parts.push(`${paint(message(language, 'mode'), 'dim', input.color)}: ${paint(value, accent, input.color)}`)
  }

  if (hasItem(input.config, 'tools')) {
    const tools: string[] = []
    if (input.activeTool) {
      tools.push(paint(`◐ ${safeText(input.activeTool)}`, 'yellow', input.color))
    }
    for (const tool of topTools(input.stats, 3)) {
      tools.push(
        `${paint('✓', 'green', input.color)} ${safeText(tool.name)} ${paint(`×${tool.count}`, 'dim', input.color)}`,
      )
    }
    if (input.stats.toolErrors > 0) {
      tools.push(paint(`✗${input.stats.toolErrors}`, 'red', input.color))
    }
    if (tools.length > 0) {
      parts.push(`${paint(message(language, 'tools'), 'dim', input.color)}: ${tools.join(' ')}`)
    }
  }

  if (hasItem(input.config, 'agents') && (input.activeAgents.length > 0 || input.stats.agentTokens > 0)) {
    const counts = new Map<string, number>()
    for (const agent of input.activeAgents) {
      counts.set(agent.type, (counts.get(agent.type) ?? 0) + 1)
    }
    const summary = [...counts.entries()]
      .map(([type, count]) => `${paint(safeText(type), 'cyan', input.color)}×${count}`)
      .join(' ')
    const tokens =
      input.stats.agentTokens > 0 ? ` · ${formatTokens(input.stats.agentTokens)}` : ''
    parts.push(
      `${paint(message(language, 'agents'), 'dim', input.color)}: ${summary || '—'}${tokens}`,
    )
  }

  return parts.length > 0 ? parts.join(' │ ') : null
}

function rowSession(input: RenderInput): string | null {
  const language = input.config.language
  const parts: string[] = []

  if (hasItem(input.config, 'session')) {
    const segments: string[] = []
    if (input.stats.startedAt !== null) {
      const elapsed = formatDuration(Math.max(0, input.now - input.stats.startedAt))
      segments.push(`⏱ ${elapsed}`)
    }
    if (hasUsage(input.stats.usage)) {
      const usage = input.stats.usage
      const rate = cacheHitRate(usage)
      const detail = [
        `${message(language, 'in')} ${formatTokens(usage.input)}`,
        `${message(language, 'cache')} ${formatTokens(usage.cacheRead)}${rate === null || rate >= 100 ? '' : ` · ${rate}%`}`,
        `${message(language, 'out')} ${formatTokens(usage.output)}`,
      ]
      segments.push(
        `${paint(message(language, 'tokens'), 'dim', input.color)} ${formatTokens(usage.total)} (${detail.join(' · ')})`,
      )
    }
    if (segments.length > 0) parts.push(segments.join(' │ '))
  }

  if (hasItem(input.config, 'turns') && input.stats.turns > 0) {
    parts.push(`${paint(message(language, 'turns'), 'dim', input.color)} ${input.stats.turns}`)
  }

  if (hasItem(input.config, 'session') && input.stats.compactions > 0) {
    const saved =
      input.stats.compactionTokens > 0
        ? ` · ${formatTokens(input.stats.compactionTokens)} ${message(language, 'hit')}`
        : ''
    parts.push(
      `${paint(message(language, 'compactions'), 'dim', input.color)} ${input.stats.compactions}${saved}`,
    )
  }

  return parts.length > 0 ? parts.join(' │ ') : null
}

export function renderHud(input: RenderInput): string[] {
  const width = Math.max(20, input.width)
  const rows = [
    rowIdentity(input),
    rowContext(input),
    rowQuota(input),
    rowActivity(input),
    rowSession(input),
  ].filter((row): row is string => Boolean(row))

  if (rows.length === 0) return []
  if (!hasItem(input.config, 'version')) {
    return rows.map(row => truncateAnsi(row, width))
  }

  const version = paint(
    `${message(input.config.language, 'hud')} ${input.version}`,
    'dim',
    input.color,
  )
  const versionWidth = visibleWidth(version)
  const last = rows.pop() as string
  const body = rows.map(row => truncateAnsi(row, width))

  if (width <= versionWidth) {
    return [...body, truncateAnsi(version, width)]
  }

  const available = width - versionWidth - 1
  const left = available > 0 ? truncateAnsi(last, available) : ''
  const gap = Math.max(1, width - visibleWidth(left) - versionWidth)
  return [...body, truncateAnsi(`${left}${' '.repeat(gap)}${version}`, width)]
}

