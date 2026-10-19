import type {
  BarStyle,
  HudConfig,
  ItemId,
  Language,
  Placement,
  Preset,
  QuotaPlanId,
  QuotaSource,
} from './types'

export const ITEM_IDS: readonly ItemId[] = [
  'identity',
  'project',
  'title',
  'context',
  'cache',
  'quota',
  'mode',
  'tools',
  'agents',
  'turns',
  'session',
  'version',
]

export const PRESETS: Record<Preset, readonly ItemId[]> = {
  full: ITEM_IDS,
  essential: ['identity', 'project', 'context', 'cache', 'quota', 'tools', 'session', 'version'],
  minimal: ['project', 'context'],
  presentation: ['identity', 'project', 'context'],
}

export const QUOTA_PLANS: Record<
  Exclude<QuotaPlanId, 'custom' | 'none'>,
  { label: string; monthly: number; fiveHour: number; weekly: number }
> = {
  go: { label: 'Go', monthly: 10, fiveHour: 2, weekly: 5 },
  goat: { label: 'GOAT', monthly: 70, fiveHour: 14, weekly: 35 },
  pro: { label: 'Pro', monthly: 80, fiveHour: 16, weekly: 40 },
  max10: { label: 'Max 10x', monthly: 150, fiveHour: 45, weekly: 90 },
  max20: { label: 'Max 20x', monthly: 300, fiveHour: 90, weekly: 180 },
  'team-pro': { label: 'Team Pro', monthly: 40, fiveHour: 12, weekly: 24 },
}

export const QUOTA_PLAN_NAMES = [
  ...Object.keys(QUOTA_PLANS),
  'custom',
  'none',
] as QuotaPlanId[]

export const PRESET_NAMES = Object.keys(PRESETS) as Preset[]

const ITEM_ALIASES: Record<string, ItemId> = {
  identity: 'identity',
  model: 'identity',
  effort: 'identity',
  project: 'project',
  git: 'project',
  cwd: 'project',
  title: 'title',
  name: 'title',
  'session-name': 'title',
  sessionname: 'title',
  context: 'context',
  ctx: 'context',
  cache: 'cache',
  quota: 'quota',
  limits: 'quota',
  usage: 'quota',
  mode: 'mode',
  permission: 'mode',
  permissions: 'mode',
  tools: 'tools',
  tool: 'tools',
  agents: 'agents',
  agent: 'agents',
  subagents: 'agents',
  turns: 'turns',
  turn: 'turns',
  session: 'session',
  tokens: 'session',
  duration: 'session',
  version: 'version',
  ver: 'version',
}

export const DEFAULT_CONFIG: HudConfig = {
  version: 3,
  enabled: true,
  preset: 'full',
  position: 'below-editor',
  language: 'en',
  color: true,
  footer: false,
  items: [...PRESETS.full],
  plan: 'none',
  monthlyCap: 0,
  fiveHourCap: 0,
  weeklyCap: 0,
  cycleDay: 0,
  quotaSource: 'auto',
  barStyle: 'half',
}

export function normalizeBarStyle(value: unknown): BarStyle | undefined {
  return value === 'block' || value === 'half' || value === 'none' ? value : undefined
}

export function normalizePlan(value: unknown): QuotaPlanId | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if ((QUOTA_PLAN_NAMES as string[]).includes(normalized)) {
    return normalized as QuotaPlanId
  }
  if (normalized === 'max-10' || normalized === 'max10x') return 'max10'
  if (normalized === 'max-20' || normalized === 'max20x') return 'max20'
  if (normalized === 'teampro' || normalized === 'team') return 'team-pro'
  return undefined
}

export function normalizeQuotaSource(value: unknown): QuotaSource | undefined {
  return value === 'auto' || value === 'exact' || value === 'local' || value === 'manual'
    ? value
    : undefined
}

export function applyPlan(config: HudConfig, plan: QuotaPlanId): HudConfig {
  if (plan === 'custom' || plan === 'none') {
    return {
      ...config,
      plan,
      monthlyCap: plan === 'none' ? 0 : config.monthlyCap,
      fiveHourCap: plan === 'none' ? 0 : config.fiveHourCap,
      weeklyCap: plan === 'none' ? 0 : config.weeklyCap,
    }
  }
  const preset = QUOTA_PLANS[plan]
  return {
    ...config,
    plan,
    monthlyCap: preset.monthly,
    fiveHourCap: preset.fiveHour,
    weeklyCap: preset.weekly,
  }
}

export function quotaCapsLabel(config: HudConfig): string {
  if (config.plan === 'none') return 'none'
  const caps = `$${config.monthlyCap}/$${config.fiveHourCap}/$${config.weeklyCap}`
  const label = config.plan === 'custom' ? 'custom' : QUOTA_PLANS[config.plan].label
  return `${label} (month/5h/week ${caps})`
}

export function normalizePreset(value: unknown): Preset | undefined {
  return typeof value === 'string' && (PRESET_NAMES as string[]).includes(value)
    ? (value as Preset)
    : undefined
}

export function normalizeLanguage(value: unknown): Language | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['en', 'en-us', 'english'].includes(normalized)) return 'en'
  if (['zh', 'zh-hans', 'zh-cn', 'cn', 'chinese'].includes(normalized)) return 'zh-Hans'
  return undefined
}

export function normalizePosition(value: unknown): Placement | undefined {
  if (value === 'above-editor' || value === 'above') return 'above-editor'
  if (value === 'below-editor' || value === 'below') return 'below-editor'
  return undefined
}

export function normalizeItem(value: unknown): ItemId | undefined {
  if (typeof value !== 'string') return undefined
  return ITEM_ALIASES[value.trim().toLowerCase()]
}

export function parseItems(values: readonly string[]): ItemId[] {
  const out: ItemId[] = []
  for (const value of values) {
    for (const token of value.split(/[\s,]+/)) {
      if (!token) continue
      const item = normalizeItem(token)
      if (item && !out.includes(item)) out.push(item)
    }
  }
  return out
}

export function normalizeConfig(raw: unknown): HudConfig {
  const config: HudConfig = { ...DEFAULT_CONFIG, items: [...DEFAULT_CONFIG.items] }
  if (!raw || typeof raw !== 'object') return config
  const value = raw as Record<string, unknown>
  if (typeof value.enabled === 'boolean') config.enabled = value.enabled
  if (typeof value.color === 'boolean') config.color = value.color
  if (typeof value.footer === 'boolean') config.footer = value.footer

  const preset = normalizePreset(value.preset)
  if (preset) config.preset = preset
  else if (value.preset === 'custom') config.preset = 'custom'

  const position = normalizePosition(value.position)
  if (position) config.position = position

  const language = normalizeLanguage(value.language)
  if (language) config.language = language

  if (Array.isArray(value.items)) {
    const items: ItemId[] = []
    for (const entry of value.items) {
      const item = normalizeItem(entry)
      if (item && !items.includes(item)) items.push(item)
    }
    config.items = items
  }

  const plan = normalizePlan(value.plan)
  if (plan) config.plan = plan
  const quotaSource = normalizeQuotaSource(value.quotaSource)
  if (quotaSource) config.quotaSource = quotaSource
  const barStyle = normalizeBarStyle(value.barStyle)
  if (barStyle) config.barStyle = barStyle
  if (typeof value.monthlyCap === 'number' && Number.isFinite(value.monthlyCap)) {
    config.monthlyCap = Math.max(0, value.monthlyCap)
  }
  if (typeof value.fiveHourCap === 'number' && Number.isFinite(value.fiveHourCap)) {
    config.fiveHourCap = Math.max(0, value.fiveHourCap)
  }
  if (typeof value.weeklyCap === 'number' && Number.isFinite(value.weeklyCap)) {
    config.weeklyCap = Math.max(0, value.weeklyCap)
  }
  if (typeof value.cycleDay === 'number' && Number.isFinite(value.cycleDay)) {
    config.cycleDay = Math.min(28, Math.max(0, Math.round(value.cycleDay)))
  }
  // Old configs defaulted the calendar to day 1. Migrate that implicit default
  // to "rolling 30d"; an explicit day is preserved once the config is v3.
  if (value.version !== 3 && config.cycleDay === 1) config.cycleDay = 0

  return config
}

export function applyPreset(config: HudConfig, preset: Preset): HudConfig {
  return {
    ...config,
    preset,
    items: [...PRESETS[preset]],
  }
}

export function setItems(config: HudConfig, items: readonly ItemId[]): HudConfig {
  return {
    ...config,
    preset: 'custom',
    items: [...new Set(items)],
  }
}

export function enableItems(config: HudConfig, items: readonly ItemId[]): HudConfig {
  return setItems(config, [...config.items, ...items])
}

export function disableItems(config: HudConfig, items: readonly ItemId[]): HudConfig {
  return setItems(
    config,
    config.items.filter(item => !items.includes(item)),
  )
}

export function hasItem(config: HudConfig, item: ItemId): boolean {
  return config.items.includes(item)
}

export function itemUsage(): string {
  return ITEM_IDS.join(', ')
}
