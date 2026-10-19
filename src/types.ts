export type Language = 'en' | 'zh-Hans'

export type Placement = 'above-editor' | 'below-editor'

export type ItemId =
  | 'identity'
  | 'project'
  | 'title'
  | 'context'
  | 'cache'
  | 'quota'
  | 'mode'
  | 'tools'
  | 'agents'
  | 'turns'
  | 'session'
  | 'version'

export type Preset = 'full' | 'essential' | 'minimal' | 'presentation'

export type QuotaPlanId =
  | 'go'
  | 'goat'
  | 'pro'
  | 'max10'
  | 'max20'
  | 'team-pro'
  | 'custom'
  | 'none'

export type QuotaSource = 'auto' | 'exact' | 'local' | 'manual'

export type BarStyle = 'block' | 'half' | 'none'

export interface HudConfig {
  version: 3
  enabled: boolean
  preset: Preset | 'custom'
  position: Placement
  language: Language
  color: boolean
  footer: boolean
  items: ItemId[]
  plan: QuotaPlanId
  monthlyCap: number
  fiveHourCap: number
  weeklyCap: number
  cycleDay: number
  quotaSource: QuotaSource
  barStyle: BarStyle
}

export interface UsageSample {
  id: string
  at: number
  cost: number
}

export interface WindowMeter {
  used: number
  cap: number
  percent: number | null
  resetAt: number | null
  resetText?: string
}

export interface ExactQuota {
  fiveHourPercent?: number
  weeklyPercent?: number
  monthlyPercent?: number
  fiveHourReset?: string
  weeklyReset?: string
  monthlyReset?: string
  fiveHourResetAt?: number
  weeklyResetAt?: number
  monthlyResetAt?: number
  monthlyUsed?: number
  monthlyCap?: number
  credits?: number
  capturedAt: number
}

export interface QuotaView {
  source: 'exact' | 'local'
  fiveHour: WindowMeter
  weekly: WindowMeter
  monthly: WindowMeter
  capturedAt?: number
}

export interface ContextUsage {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

export interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface HudStats {
  startedAt: number | null
  running: boolean
  turns: number
  compactions: number
  compactionTokens: number
  toolErrors: number
  tools: Record<string, number>
  usage: UsageTotals
  agentTokens: number
}

export interface PersistedStats {
  startedAt: number | null
  turns: number
  compactions: number
  compactionTokens: number
  toolErrors: number
  usage: UsageTotals
  agentTokens: number
}

export interface GitStatus {
  branch: string
  dirty: boolean
  added: number
  modified: number
  deleted: number
  renamed: number
  copied: number
  typeChanged: number
  conflicted: number
  untracked: number
}

export interface ActiveAgent {
  type: string
  since: number
}

export interface Disposable {
  dispose(): void
}

export interface CommandContext {
  args: string
  cwd: string
  ui: unknown
  exec: (options: ExecOptions) => Promise<ExecResult>
}

export interface ExecOptions {
  command: string
  args?: string[]
  cwd?: string
  signal?: AbortSignal
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

export interface ModSessionApi {
  getCustomEntries: (options: { customType: string }) => ReadonlyArray<{ data?: unknown }>
  appendCustomEntry: (options: { customType: string; data?: unknown }) => unknown
}

export interface ModStoreApi {
  get: <T>(key: string) => T | undefined
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
}

export interface ModClockApi {
  every: (milliseconds: number, callback: () => void) => Disposable
  after: (milliseconds: number, callback: () => void) => Disposable
}

export interface CommandOutputProps {
  message?: string
  details?: unknown
  isError?: boolean
}

export interface ModUiApi {
  setStatus: (text: string | null) => Disposable
  widget: (options: {
    placement: Placement
    render: (props: { width: number }) => unknown[]
  }) => Disposable
  refreshWidgets: () => void
  override: (
    component: 'command_output' | 'spinner' | 'tool_row' | 'user_message',
    render: (
      props: CommandOutputProps,
      next: () => unknown[] | undefined,
    ) => unknown[] | undefined,
  ) => Disposable
  toast?: (text: string) => void
  capabilities?: { status?: boolean }
}

export type EventPayload = Record<string, unknown>

export interface ModHooks {
  onSessionStart?: (
    input: { source: string },
    context?: { session?: ModSessionApi },
  ) => void
  onSessionEnd?: (
    input: { reason: string },
    context?: { session?: ModSessionApi },
  ) => void
}

export interface ModApi {
  name: string
  cwd: string
  session?: ModSessionApi
  ui: ModUiApi
  store: ModStoreApi
  clock: ModClockApi
  addFlag: (
    name: string,
    options: {
      type: 'boolean' | 'string'
      default?: boolean | string
      description?: string
    },
  ) => Disposable
  getFlag: (name: string) => boolean | string | undefined
  addCommand: (command: {
    name: string
    description?: string
    argumentHint?: string
    handler: (context: CommandContext) => unknown
  }) => Disposable
  addShortcut: (
    keys: string,
    options: {
      description?: string
      handler: (context: CommandContext) => unknown
    },
  ) => Disposable
  on: (event: string, handler: (payload: EventPayload) => void) => Disposable
  hooks: (hooks: ModHooks) => Disposable
  exec: (options: ExecOptions) => Promise<ExecResult>
  getModel: () => string | undefined
  getEffort: () => string | undefined
  getSessionName: () => string | undefined
  getContextUsage: () => ContextUsage | undefined
  isIdle: () => boolean
}

export interface RenderInput {
  config: HudConfig
  cwd: string
  model?: string
  effort?: string
  sessionName?: string
  context?: ContextUsage
  stats: HudStats
  git?: GitStatus | null
  permissionMode?: string | null
  quota?: QuotaView
  activeAgents: ActiveAgent[]
  activeTool?: string | null
  isIdle: boolean
  now: number
  width: number
  color: boolean
  version: string
}
