import { colorEnabled } from './colors'
import {
  applyPlan,
  applyPreset,
  DEFAULT_CONFIG,
  disableItems,
  enableItems,
  itemUsage,
  normalizeBarStyle,
  normalizeConfig,
  normalizeLanguage,
  normalizePlan,
  normalizePosition,
  normalizePreset,
  parseItems,
  PRESET_NAMES,
  quotaCapsLabel,
  QUOTA_PLANS,
} from './config'
import { formatMoney, formatResetIn } from './format'
import { collectGitStatus } from './git'
import {
  interceptFetch,
  type CapturedFetch,
  type CapturedRequest,
} from './network'
import {
  buildQuotaView,
  creditsToExact,
  inferPlanFromText,
  parseUsageOverlay,
  periodStart,
  WEEK_MS,
} from './quota'
import { renderHud } from './render'
import {
  addTurn,
  createStats,
  fromPersisted,
  recordAgentUsage,
  recordCompaction,
  recordTool,
  toPersisted,
} from './stats'
import type {
  CommandContext,
  CommandOutputProps,
  ContextUsage,
  Disposable,
  EventPayload,
  ExactQuota,
  GitStatus,
  HudConfig,
  HudStats,
  ModApi,
  QuotaView,
  UsageSample,
  WindowMeter,
} from './types'
import { storeDelete, storeSet } from './store'
import { scanUsageSamples, type TranscriptCache } from './transcripts'
import { hasUsage } from './usage'
import { VERSION } from './version'

const CONFIG_KEY = 'config'
const EXACT_QUOTA_KEY = 'quota.exact'
const NETWORK_QUOTA_KEY = 'quota.network'
const NETWORK_REQUEST_KEY = 'quota.request'
const BOOT_KEY = 'boot'
const STATS_CUSTOM_TYPE = 'command-code-hud/stats'

let config: HudConfig = { ...DEFAULT_CONFIG, items: [...DEFAULT_CONFIG.items] }
let stats: HudStats = createStats()
let git: GitStatus | undefined
let permissionMode: string | null = null
let lastUsageRaw: unknown
let widget: Disposable | undefined
let gitInFlight = false
let lastPersistedStats = ''
let exactQuota: ExactQuota | undefined
let usageSamples: UsageSample[] = []
let quotaView: QuotaView | undefined
let quotaScanInFlight = false
let quotaScanQueued = false
let apiQuotaInFlight = false
let quotaRequest: CapturedRequest | undefined
let transcriptsRoot: string | undefined
const transcriptCache: TranscriptCache = new Map()
const activeAgents = new Map<string, { type: string; since: number }>()
const activeTools = new Map<string, string>()

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function safeContext(cmd: ModApi): ContextUsage | undefined {
  try {
    return cmd.getContextUsage()
  } catch {
    return undefined
  }
}

function snapshot(cmd: ModApi, width: number): string[] {
  return renderHud({
    config,
    cwd: cmd.cwd,
    model: cmd.getModel(),
    effort: cmd.getEffort(),
    sessionName: cmd.getSessionName(),
    context: safeContext(cmd),
    stats,
    git,
    permissionMode,
    quota: quotaView,
    activeAgents: [...activeAgents.values()],
    activeTool: [...activeTools.values()].slice(0, 2).join(', ') || null,
    isIdle: cmd.isIdle(),
    now: Date.now(),
    width,
    color: colorEnabled(config.color),
    version: VERSION,
  })
}

function refresh(cmd: ModApi): void {
  try {
    quotaView = buildQuotaView(config, usageSamples, exactQuota, Date.now())
    if (!config.enabled) {
      cmd.ui.setStatus(null)
      cmd.ui.refreshWidgets()
      return
    }
    if (config.footer) {
      const percent = safeContext(cmd)?.percent ?? null
      cmd.ui.setStatus(percent === null ? null : `HUD ctx ${percent}%`)
    } else {
      cmd.ui.setStatus(null)
    }
    cmd.ui.refreshWidgets()
  } catch {
    // A rendering failure must never take the host down.
  }
}

function resetWidget(cmd: ModApi): void {
  widget?.dispose()
  widget = cmd.ui.widget({
    placement: config.position,
    render: ({ width }) => (config.enabled ? snapshot(cmd, width) : []),
  })
}

function persistConfig(cmd: ModApi): Promise<void> {
  return storeSet(cmd, CONFIG_KEY, config)
}

function persistStats(cmd: ModApi): void {
  const data = toPersisted(stats)
  const serialized = JSON.stringify(data)
  if (serialized === lastPersistedStats) return
  lastPersistedStats = serialized
  try {
    cmd.session?.appendCustomEntry({
      customType: STATS_CUSTOM_TYPE,
      data,
    })
  } catch {
    // Session persistence is best-effort; the HUD keeps working without it.
  }
}

function seedStats(session: ModApi['session']): void {
  const seeded = fromPersisted(
    session?.getCustomEntries({ customType: STATS_CUSTOM_TYPE }).at(-1)?.data,
  )
  if (seeded) {
    stats = seeded
    lastPersistedStats = JSON.stringify(toPersisted(stats))
  }
}

async function refreshGit(cmd: ModApi): Promise<void> {
  if (gitInFlight) return
  gitInFlight = true
  try {
    git = await collectGitStatus(options => cmd.exec(options), cmd.cwd)
  } finally {
    gitInFlight = false
    refresh(cmd)
  }
}

function normalizeExactQuota(raw: unknown): ExactQuota | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  if (typeof value.capturedAt !== 'number' || !Number.isFinite(value.capturedAt)) {
    return undefined
  }
  return raw as ExactQuota
}

async function scanQuota(cmd: ModApi): Promise<void> {
  if (!config.items.includes('quota') || config.plan === 'none' || config.quotaSource === 'exact') {
    if (usageSamples.length > 0) usageSamples = []
    refresh(cmd)
    return
  }
  if (quotaScanInFlight) {
    quotaScanQueued = true
    return
  }
  quotaScanInFlight = true
  try {
    const now = Date.now()
    const since = Math.min(periodStart(now, config.cycleDay), now - WEEK_MS) - 60_000
    usageSamples = await scanUsageSamples(since, transcriptCache, transcriptsRoot)
  } catch {
    // Local usage is an estimate; keep the last good scan on failure.
  } finally {
    quotaScanInFlight = false
    refresh(cmd)
    if (quotaScanQueued) {
      quotaScanQueued = false
      void scanQuota(cmd)
    }
  }
}

function looksLikeUsageText(text: string): boolean {
  return (
    /(5\s*-?\s*h|week|month|credits?|usage limit)/i.test(text) &&
    /(%|\$\s*\d)/.test(text)
  )
}

function applyCreditsSnapshot(cmd: ModApi, raw: unknown): boolean {
  if (config.quotaSource === 'manual') return false
  const parsed = creditsToExact(raw, config.monthlyCap)
  if (!parsed) return false
  if (parsed.plan && parsed.plan !== config.plan) {
    config = applyPlan(config, parsed.plan)
    void persistConfig(cmd)
  }
  exactQuota = parsed.exact
  void storeSet(cmd, EXACT_QUOTA_KEY, parsed.exact)
  refresh(cmd)
  return true
}

function registerNetworkCapture(cmd: ModApi): void {
  interceptFetch((capture: CapturedFetch) => {
    if (capture.request && /billing\/credits/i.test(capture.url)) {
      quotaRequest = capture.request
      try {
        void storeSet(cmd, NETWORK_REQUEST_KEY, {
          url: capture.request.url,
          method: capture.request.method,
          headerNames: Object.keys(capture.request.headers),
          hasAuthorization: Object.keys(capture.request.headers).some(
            key => key.toLowerCase() === 'authorization',
          ),
          at: Date.now(),
        })
      } catch {
        // Header names are diagnostic only.
      }
    }
    if (capture.body === undefined) return
    try {
      let parsed = false
      try {
        parsed = applyCreditsSnapshot(cmd, JSON.parse(capture.body) as unknown)
      } catch {
        parsed = false
      }
      void storeSet(cmd, NETWORK_QUOTA_KEY, {
        url: capture.url,
        status: capture.status,
        parsed,
        body: capture.body.slice(0, 50_000),
        at: Date.now(),
      })
    } catch {
      // Capture is best-effort.
    }
  })
}

const REPLAY_BLOCKED_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'accept-encoding',
])

async function refreshQuotaFromApi(cmd: ModApi): Promise<void> {
  if (!quotaRequest || apiQuotaInFlight) return
  apiQuotaInFlight = true
  try {
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(quotaRequest.headers)) {
      if (!REPLAY_BLOCKED_HEADERS.has(key.toLowerCase())) headers[key] = value
    }
    const response = await fetch(quotaRequest.url, {
      method: quotaRequest.method || 'GET',
      headers,
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) quotaRequest = undefined
      return
    }
    applyCreditsSnapshot(cmd, (await response.json()) as unknown)
  } catch {
    // Offline or expired credentials: keep the last snapshot.
  } finally {
    apiQuotaInFlight = false
  }
}

function registerUsageCapture(cmd: ModApi): void {
  cmd.ui.override('command_output', (props: CommandOutputProps, next) => {
    const message = typeof props.message === 'string' ? props.message : ''
    let details = ''
    if (typeof props.details === 'string') details = props.details
    else if (props.details && typeof props.details === 'object') {
      try {
        details = JSON.stringify(props.details)
      } catch {
        details = ''
      }
    }
    const text = details ? `${message}\n${details}` : message
    if (looksLikeUsageText(text)) {
      const parsed = parseUsageOverlay(text)
      if (parsed) {
        exactQuota = parsed
        void storeSet(cmd, EXACT_QUOTA_KEY, parsed)
        if (config.plan === 'none') {
          const plan = inferPlanFromText(text)
          if (plan) {
            config = applyPlan(config, plan)
            void persistConfig(cmd)
            void scanQuota(cmd)
          }
        }
        refresh(cmd)
      }
    }
    return next()
  })
}

function applySessionFlags(cmd: ModApi): void {
  const preset = normalizePreset(cmd.getFlag('hud-preset'))
  if (preset) config = applyPreset(config, preset)

  const language = normalizeLanguage(cmd.getFlag('hud-lang'))
  if (language) config = { ...config, language }

  const position = normalizePosition(cmd.getFlag('hud-position'))
  if (position) config = { ...config, position }

  const plan = normalizePlan(cmd.getFlag('hud-plan'))
  if (plan) config = applyPlan(config, plan)

  const root = cmd.getFlag('hud-transcripts')
  if (typeof root === 'string' && root.length > 0) transcriptsRoot = root
}

function finishTool(payload: EventPayload, name: string): void {
  const id = stringField(payload.toolCallId)
  if (id) {
    activeTools.delete(id)
    return
  }
  for (const [key, value] of activeTools) {
    if (value === name) {
      activeTools.delete(key)
      break
    }
  }
}

function registerEvents(cmd: ModApi): void {
  cmd.hooks({
    onSessionStart: ({ source }, context) => {
      stats = createStats()
      lastPersistedStats = ''
      seedStats(context?.session ?? cmd.session)
      if (source === 'startup') {
        permissionMode = null
        activeAgents.clear()
        activeTools.clear()
        git = undefined
      }
      refresh(cmd)
      void refreshGit(cmd)
      void scanQuota(cmd)
    },
    onSessionEnd: () => {
      cmd.ui.setStatus(null)
    },
  })

  cmd.on('run_start', () => {
    stats = { ...stats, running: true }
    refresh(cmd)
  })

  cmd.on('run_end', () => {
    stats = { ...stats, running: false }
    persistStats(cmd)
    refresh(cmd)
    void refreshGit(cmd)
    void scanQuota(cmd)
  })

  cmd.on('turn_end', (payload: EventPayload) => {
    stats = addTurn(stats, payload.usage)
    lastUsageRaw = payload.usage
    persistStats(cmd)
    refresh(cmd)
  })

  cmd.on('model_request_end', (payload: EventPayload) => {
    lastUsageRaw = payload.usage
  })

  cmd.on('tool_running', (payload: EventPayload) => {
    const name = stringField(payload.toolName) ?? 'tool'
    activeTools.set(stringField(payload.toolCallId) ?? name, name)
    refresh(cmd)
  })

  cmd.on('tool_completed', (payload: EventPayload) => {
    const name = stringField(payload.toolName) ?? 'tool'
    stats = recordTool(stats, name, false)
    finishTool(payload, name)
    refresh(cmd)
  })

  cmd.on('tool_errored', (payload: EventPayload) => {
    const name = stringField(payload.toolName) ?? 'tool'
    stats = recordTool(stats, name, true)
    finishTool(payload, name)
    refresh(cmd)
  })

  cmd.on('permission_mode_changed', (payload: EventPayload) => {
    permissionMode = stringField(payload.mode) ?? null
    refresh(cmd)
  })

  cmd.on('session_titled', () => {
    refresh(cmd)
  })

  cmd.on('compaction_done', (payload: EventPayload) => {
    stats = recordCompaction(stats, payload.tokensSaved)
    persistStats(cmd)
    refresh(cmd)
  })

  cmd.on('subagent_start', (payload: EventPayload) => {
    const id = stringField(payload.toolCallId) ?? `agent-${activeAgents.size}`
    activeAgents.set(id, {
      type: stringField(payload.subagentType) ?? 'agent',
      since: Date.now(),
    })
    refresh(cmd)
  })

  cmd.on('subagent_stop', (payload: EventPayload) => {
    const id = stringField(payload.toolCallId)
    if (id) activeAgents.delete(id)
    else {
      const first = activeAgents.keys().next()
      if (!first.done) activeAgents.delete(first.value)
    }
    stats = recordAgentUsage(stats, payload.tokensUsed)
    refresh(cmd)
  })
}

function meterText(meter: WindowMeter, now: number): string {
  if (meter.percent === null) return '—'
  if (meter.resetAt !== null) {
    const reset = formatResetIn(meter.resetAt, now)
    return `${meter.percent}%${reset ? ` (${reset})` : ''}`
  }
  return `${meter.percent}%${meter.resetText ? ` (${meter.resetText})` : ''}`
}

function parseQuotaSet(tokens: readonly string[], now = Date.now()): ExactQuota | undefined {
  const values = new Map<string, string>()
  const positional: string[] = []
  for (const token of tokens) {
    const index = token.indexOf('=')
    if (index > 0) {
      values.set(token.slice(0, index).toLowerCase(), token.slice(index + 1))
    } else if (token) {
      positional.push(token)
    }
  }

  const numberFrom = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const raw = values.get(key)
      if (raw === undefined || raw === '') continue
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) return parsed
    }
    return undefined
  }

  const positionalNumber = (index: number): number | undefined => {
    const raw = positional[index]
    if (raw === undefined) return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
  }

  let fiveHourPercent = numberFrom('5h', '5', 'fivehour', 'five')
  let weeklyPercent = numberFrom('1w', 'w', 'week', 'weekly')
  let monthlyPercent = numberFrom('month', 'm', 'monthly')
  if (fiveHourPercent === undefined) fiveHourPercent = positionalNumber(0)
  if (weeklyPercent === undefined) weeklyPercent = positionalNumber(1)
  if (monthlyPercent === undefined) monthlyPercent = positionalNumber(2)

  const monthlyUsed = numberFrom('used', 'monthused', 'spent')
  const monthlyCap = numberFrom('cap', 'monthcap', 'limit')
  if (monthlyPercent === undefined && monthlyUsed !== undefined && monthlyCap && monthlyCap > 0) {
    monthlyPercent = Math.round((monthlyUsed / monthlyCap) * 100)
  }

  if (
    fiveHourPercent === undefined &&
    weeklyPercent === undefined &&
    monthlyPercent === undefined
  ) {
    return undefined
  }

  const reset = (key: string): string | undefined => {
    const value = values.get(key)
    return value ? value : undefined
  }

  return {
    ...(fiveHourPercent !== undefined ? { fiveHourPercent } : {}),
    ...(weeklyPercent !== undefined ? { weeklyPercent } : {}),
    ...(monthlyPercent !== undefined ? { monthlyPercent } : {}),
    ...(monthlyUsed !== undefined ? { monthlyUsed } : {}),
    ...(monthlyCap !== undefined ? { monthlyCap } : {}),
    ...(reset('reset5h') ? { fiveHourReset: reset('reset5h') } : {}),
    ...(reset('reset1w') ? { weeklyReset: reset('reset1w') } : {}),
    ...(reset('resetmonth') ? { monthlyReset: reset('resetmonth') } : {}),
    capturedAt: now,
  }
}

function quotaStatus(now = Date.now()): string {
  const view = buildQuotaView(config, usageSamples, exactQuota, now)
  const captured = exactQuota
    ? new Date(exactQuota.capturedAt).toLocaleString()
    : 'none'
  if (!view) {
    return `quota: no data · plan ${quotaCapsLabel(config)} · source ${config.quotaSource} · run /usage once (auto capture) or /hud quota set 5h=.. 1w=..`
  }
  const monthly =
    view.monthly.cap > 0 && view.monthly.used > 0
      ? ` ${formatMoney(view.monthly.used)}/${formatMoney(view.monthly.cap)}`
      : ''
  return [
    `quota: ${view.source}`,
    `plan ${quotaCapsLabel(config)}`,
    `cycle ${config.cycleDay > 0 ? config.cycleDay : '30d'}`,
    `5h ${meterText(view.fiveHour, now)}`,
    `1w ${meterText(view.weekly, now)}`,
    `month ${meterText(view.monthly, now)}${monthly}`,
    `exact ${captured}`,
  ].join(' · ')
}

function statusMessage(cmd: ModApi): string {
  const context = safeContext(cmd)
  const contextText =
    context?.percent === null || context?.percent === undefined
      ? '—'
      : `${context.percent}%`
  return [
    `HUD v${VERSION}`,
    config.enabled ? 'on' : 'off',
    `preset ${config.preset}`,
    config.position,
    config.language,
    `ctx ${contextText}`,
    `plan ${quotaCapsLabel(config)}`,
    `quota ${quotaView?.source ?? 'none'}`,
    `items ${config.items.join(',') || 'none'}`,
    `usage ${hasUsage(stats.usage) ? 'tracked' : 'none'}`,
  ].join(' · ')
}

function helpMessage(): string {
  return [
    'usage: /hud [status|preset <full|essential|minimal|presentation>|lang <en|zh>|on|off|toggle|enable <items>|disable <items>|position <above|below>|color <on|off>|bar <block|half|none>|footer <on|off>|plan <plan>|quota [show|set|refresh|auto|exact|local|cycle <1-28>|clear]|reset|debug]',
    `items: ${itemUsage()}`,
    `plans: ${Object.keys(QUOTA_PLANS).join(', ')}, custom, none`,
  ].join('\n')
}

export async function handleHudCommand(
  cmd: ModApi,
  args: string,
): Promise<{ message: string }> {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const sub = (tokens.shift() ?? 'status').toLowerCase()

  const changed = async (message: string): Promise<{ message: string }> => {
    await persistConfig(cmd)
    refresh(cmd)
    return { message }
  }

  switch (sub) {
    case 'status':
      return { message: statusMessage(cmd) }

    case 'preset': {
      const preset = normalizePreset(tokens[0])
      if (!preset) {
        return { message: `preset must be one of: ${PRESET_NAMES.join(', ')}` }
      }
      config = applyPreset(config, preset)
      return changed(`HUD preset: ${preset} · items ${config.items.join(',')}`)
    }

    case 'plan': {
      const target = tokens[0]
      if (!target) return { message: `plan: ${quotaCapsLabel(config)}` }
      const plan = normalizePlan(target)
      if (!plan) {
        return {
          message: `plan must be one of: ${Object.keys(QUOTA_PLANS).join(', ')}, custom, none`,
        }
      }
      if (plan === 'custom') {
        const values = tokens.slice(1).map(Number)
        if (values.length < 3 || values.some(value => !Number.isFinite(value) || value < 0)) {
          return { message: 'usage: /hud plan custom <monthly> <5h> <weekly>' }
        }
        config = {
          ...config,
          plan: 'custom',
          monthlyCap: values[0] ?? 0,
          fiveHourCap: values[1] ?? 0,
          weeklyCap: values[2] ?? 0,
        }
      } else {
        config = applyPlan(config, plan)
      }
      void scanQuota(cmd)
      return changed(`HUD plan: ${quotaCapsLabel(config)}`)
    }

    case 'quota': {
      const sub = (tokens[0] ?? 'show').toLowerCase()
      if (sub === 'clear') {
        exactQuota = undefined
        quotaRequest = undefined
        config = { ...config, quotaSource: 'auto' }
        await persistConfig(cmd)
        await storeDelete(cmd, EXACT_QUOTA_KEY)
        await storeDelete(cmd, NETWORK_QUOTA_KEY)
        await storeDelete(cmd, NETWORK_REQUEST_KEY)
        refresh(cmd)
        return { message: 'HUD quota snapshot cleared (auto capture may recreate it)' }
      }
      if (sub === 'auto' || sub === 'exact' || sub === 'local') {
        config = { ...config, quotaSource: sub }
        void scanQuota(cmd)
        return changed(`HUD quota source: ${sub}`)
      }
      if (sub === 'cycle') {
        const raw = (tokens[1] ?? '').toLowerCase()
        if (raw === 'auto' || raw === '0' || raw === '') {
          config = { ...config, cycleDay: 0 }
          void scanQuota(cmd)
          return changed('HUD monthly window: rolling 30d')
        }
        const day = Number(raw)
        if (!Number.isInteger(day) || day < 1 || day > 28) {
          return { message: 'usage: /hud quota cycle <1-28|auto>' }
        }
        config = { ...config, cycleDay: day }
        void scanQuota(cmd)
        return changed(`HUD monthly cycle day: ${day}`)
      }
      if (sub === 'refresh') {
        void scanQuota(cmd)
        void refreshQuotaFromApi(cmd)
        return { message: 'HUD quota refresh started' }
      }
      if (sub === 'set') {
        const parsed = parseQuotaSet(tokens.slice(1))
        if (!parsed) {
          return {
            message:
              'usage: /hud quota set 5h=32 1w=41 [month=29] [used=23.4 cap=80] [reset5h=3h12m reset1w=2d4h]',
          }
        }
        exactQuota = parsed
        config = { ...config, quotaSource: 'manual' }
        await persistConfig(cmd)
        await storeSet(cmd, EXACT_QUOTA_KEY, parsed)
        refresh(cmd)
        return { message: `HUD quota set · ${quotaStatus()}` }
      }
      return { message: quotaStatus() }
    }

    case 'lang':
    case 'language': {
      const language = normalizeLanguage(tokens[0])
      if (!language) return { message: 'lang must be en or zh' }
      config = { ...config, language }
      return changed(`HUD language: ${language}`)
    }

    case 'on':
      config = { ...config, enabled: true }
      return changed('HUD on')

    case 'off':
      config = { ...config, enabled: false }
      return changed('HUD off')

    case 'toggle':
      config = { ...config, enabled: !config.enabled }
      return changed(`HUD ${config.enabled ? 'on' : 'off'}`)

    case 'enable': {
      const items = parseItems(tokens)
      if (items.length === 0) return { message: `usage: /hud enable <${itemUsage()}>` }
      config = enableItems(config, items)
      return changed(`HUD enabled: ${items.join(',')}`)
    }

    case 'disable': {
      const items = parseItems(tokens)
      if (items.length === 0) return { message: `usage: /hud disable <${itemUsage()}>` }
      config = disableItems(config, items)
      return changed(`HUD disabled: ${items.join(',')}`)
    }

    case 'position': {
      const position = normalizePosition(tokens[0])
      if (!position) return { message: 'position must be above or below' }
      config = { ...config, position }
      await persistConfig(cmd)
      resetWidget(cmd)
      refresh(cmd)
      return { message: `HUD position: ${position}` }
    }

    case 'color': {
      const value = (tokens[0] ?? '').toLowerCase()
      if (value !== 'on' && value !== 'off') return { message: 'color must be on or off' }
      config = { ...config, color: value === 'on' }
      return changed(`HUD color: ${value}`)
    }

    case 'bar': {
      const style = normalizeBarStyle((tokens[0] ?? '').toLowerCase())
      if (!style) return { message: 'bar must be block, half or none' }
      config = { ...config, barStyle: style }
      return changed(`HUD bar: ${style}`)
    }

    case 'footer': {
      const value = (tokens[0] ?? '').toLowerCase()
      if (value !== 'on' && value !== 'off') return { message: 'footer must be on or off' }
      config = { ...config, footer: value === 'on' }
      return changed(`HUD footer: ${value}`)
    }

    case 'reset':
      config = { ...DEFAULT_CONFIG, items: [...DEFAULT_CONFIG.items] }
      await persistConfig(cmd)
      resetWidget(cmd)
      refresh(cmd)
      return { message: 'HUD reset to defaults' }

    case 'debug':
      return {
        message: JSON.stringify({
          version: VERSION,
          config,
          model: cmd.getModel(),
          effort: cmd.getEffort(),
          context: safeContext(cmd),
          permissionMode,
          quotaRequest: quotaRequest
            ? {
                url: quotaRequest.url,
                method: quotaRequest.method,
                headerNames: Object.keys(quotaRequest.headers),
              }
            : null,
          lastUsage: lastUsageRaw,
          stats: toPersisted(stats),
          tools: stats.tools,
          agents: [...activeAgents.values()],
          git,
        }),
      }

    default:
      return { message: helpMessage() }
  }
}

export default function commandCodeHud(cmd: ModApi): void {
  const storedConfig = cmd.store.get<Record<string, unknown>>(CONFIG_KEY)
  config = normalizeConfig(storedConfig)
  stats = createStats()

  cmd.addFlag('hud-preset', {
    type: 'string',
    description: 'Start the HUD with a preset (full, essential, minimal, presentation).',
  })
  cmd.addFlag('hud-lang', {
    type: 'string',
    description: 'HUD language (en or zh).',
  })
  cmd.addFlag('hud-position', {
    type: 'string',
    description: 'HUD placement (above or below the editor).',
  })
  cmd.addFlag('hud-plan', {
    type: 'string',
    description: 'Quota plan for local estimates (go, goat, pro, max10, max20, team-pro).',
  })
  cmd.addFlag('hud-transcripts', {
    type: 'string',
    description: 'Override the transcript root used for local quota estimates.',
  })

  exactQuota = normalizeExactQuota(cmd.store.get(EXACT_QUOTA_KEY))
  void storeSet(cmd, BOOT_KEY, { version: VERSION, at: Date.now() })
  applySessionFlags(cmd)
  if (storedConfig && storedConfig.version !== config.version) {
    void persistConfig(cmd)
  }

  const cached = cmd.store.get<{ body?: string; at?: number }>(NETWORK_QUOTA_KEY)
  if (
    config.quotaSource !== 'manual' &&
    cached?.body &&
    typeof cached.at === 'number' &&
    Date.now() - cached.at <= 30 * 60_000
  ) {
    try {
      const parsed = creditsToExact(JSON.parse(cached.body) as unknown, config.monthlyCap)
      if (parsed && (!exactQuota || parsed.exact.capturedAt > exactQuota.capturedAt)) {
        exactQuota = parsed.exact
        if (parsed.plan) {
          config = applyPlan(config, parsed.plan)
          void persistConfig(cmd)
        }
      }
    } catch {
      // A stale or malformed cached body is ignored.
    }
  }

  resetWidget(cmd)
  registerUsageCapture(cmd)
  registerNetworkCapture(cmd)
  registerEvents(cmd)

  cmd.addCommand({
    name: 'hud',
    description: 'Configure the Command Code HUD',
    argumentHint:
      '[status|preset <name>|lang <en|zh>|on|off|toggle|enable <items>|disable <items>|position <above|below>|color <on|off>|footer <on|off>|reset|debug]',
    handler: (context: CommandContext) => handleHudCommand(cmd, context.args),
  })

  cmd.addShortcut('alt+h', {
    description: 'Toggle the Command Code HUD',
    handler: () => {
      config = { ...config, enabled: !config.enabled }
      void persistConfig(cmd)
      refresh(cmd)
      return { message: `HUD ${config.enabled ? 'on' : 'off'}` }
    },
  })

  cmd.clock.every(30_000, () => {
    if (!config.enabled) return
    refresh(cmd)
    void refreshGit(cmd)
  })

  cmd.clock.every(5 * 60_000, () => {
    void scanQuota(cmd)
  })

  cmd.clock.every(5 * 60_000, () => {
    void refreshQuotaFromApi(cmd)
  })

  refresh(cmd)
  void scanQuota(cmd)
}
