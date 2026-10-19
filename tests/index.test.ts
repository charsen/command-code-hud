import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, it } from 'vitest'
import commandCodeHud, { handleHudCommand } from '../src/index'
import type { CommandOutputProps, ModApi, Placement } from '../src/types'

interface Mock {
  api: ModApi
  store: Map<string, unknown>
  flags: Map<string, boolean | string>
  commands: string[]
  shortcuts: string[]
  widgetOptions: Array<{ placement: Placement; render: (props: { width: number }) => unknown[] }>
  overrides: Array<{
    component: string
    render: (props: CommandOutputProps, next: () => unknown[] | undefined) => unknown[] | undefined
  }>
  refreshed: () => number
}

function createMock(initial?: Map<string, unknown>): Mock {
  const store = initial ?? new Map<string, unknown>()
  const flags = new Map<string, boolean | string>([
    ['hud-transcripts', join(tmpdir(), 'command-code-hud-no-transcripts')],
  ])
  const commands: string[] = []
  const shortcuts: string[] = []
  const widgetOptions: Mock['widgetOptions'] = []
  const overrides: Mock['overrides'] = []
  let refreshCount = 0
  const disposable = { dispose: () => {} }

  const api = {
    name: 'command-code-hud',
    cwd: '/tmp/command-code-hud',
    session: undefined,
    ui: {
      setStatus: () => disposable,
      widget: (options: Mock['widgetOptions'][number]) => {
        widgetOptions.push(options)
        return disposable
      },
      refreshWidgets: () => {
        refreshCount += 1
      },
      override: (component: string, render: Mock['overrides'][number]['render']) => {
        overrides.push({ component, render })
        return disposable
      },
      capabilities: { status: true },
    },
    store: {
      get: <T>(key: string) => store.get(key) as T | undefined,
      set: async (key: string, value: unknown) => {
        store.set(key, value)
      },
      delete: async (key: string) => {
        store.delete(key)
      },
    },
    clock: {
      every: () => disposable,
      after: () => disposable,
    },
    addFlag: () => disposable,
    getFlag: (name: string) => flags.get(name),
    addCommand: (command: { name: string }) => {
      commands.push(command.name)
      return disposable
    },
    addShortcut: (keys: string) => {
      shortcuts.push(keys)
      return disposable
    },
    on: () => disposable,
    hooks: () => disposable,
    exec: async () => ({ stdout: '## main...origin/main\n', stderr: '', code: 0 }),
    getModel: () => 'glm-5.3',
    getEffort: () => 'high',
    getSessionName: () => 'HUD work',
    getContextUsage: () => ({ tokens: 210_000, contextWindow: 1_000_000, percent: 21 }),
    isIdle: () => true,
  } as unknown as ModApi

  return {
    api,
    store,
    flags,
    commands,
    shortcuts,
    widgetOptions,
    overrides,
    refreshed: () => refreshCount,
  }
}

describe('command-code-hud mod', () => {
  let mock: Mock

  beforeEach(() => {
    mock = createMock()
    commandCodeHud(mock.api)
  })

  it('registers the widget, command and shortcut', () => {
    expect(mock.commands).toEqual(['hud'])
    expect(mock.shortcuts).toEqual(['alt+h'])
    expect(mock.widgetOptions).toHaveLength(1)
    expect(mock.widgetOptions[0]?.placement).toBe('below-editor')
    const lines = mock.widgetOptions[0]?.render({ width: 120 }) ?? []
    expect(lines.length).toBeGreaterThan(0)
    expect(String(lines[0])).toContain('glm-5.3')
  })

  it('applies and persists presets', async () => {
    const result = await handleHudCommand(mock.api, 'preset minimal')
    expect(result.message).toContain('minimal')
    const stored = mock.store.get('config') as { preset: string; items: string[] }
    expect(stored.preset).toBe('minimal')
    expect(stored.items).toEqual(['project', 'context'])
    expect(mock.widgetOptions.at(-1)?.render({ width: 120 })).toHaveLength(2)
  })

  it('switches language and toggles visibility', async () => {
    await handleHudCommand(mock.api, 'lang zh')
    let lines = mock.widgetOptions.at(-1)?.render({ width: 120 }) ?? []
    expect(lines.join('\n')).toContain('上下文')

    await handleHudCommand(mock.api, 'off')
    lines = mock.widgetOptions.at(-1)?.render({ width: 120 }) ?? []
    expect(lines).toEqual([])

    const result = await handleHudCommand(mock.api, 'toggle')
    expect(result.message).toContain('on')
    lines = mock.widgetOptions.at(-1)?.render({ width: 120 }) ?? []
    expect(lines.length).toBeGreaterThan(0)
  })

  it('enables and disables individual items', async () => {
    await handleHudCommand(mock.api, 'preset minimal')
    await handleHudCommand(mock.api, 'enable tools turns')
    const stored = mock.store.get('config') as { preset: string; items: string[] }
    expect(stored.preset).toBe('custom')
    expect(stored.items).toEqual(expect.arrayContaining(['tools', 'turns']))

    await handleHudCommand(mock.api, 'disable tools')
    const after = mock.store.get('config') as { items: string[] }
    expect(after.items).not.toContain('tools')
  })

  it('switches the progress-bar style', async () => {
    await handleHudCommand(mock.api, 'bar block')
    let stored = mock.store.get('config') as { barStyle: string }
    expect(stored.barStyle).toBe('block')

    await handleHudCommand(mock.api, 'bar none')
    stored = mock.store.get('config') as { barStyle: string }
    expect(stored.barStyle).toBe('none')

    const invalid = await handleHudCommand(mock.api, 'bar wide')
    expect(invalid.message).toContain('block, half or none')
  })

  it('re-registers the widget when the position changes', async () => {
    await handleHudCommand(mock.api, 'position above')
    expect(mock.widgetOptions.at(-1)?.placement).toBe('above-editor')
  })

  it('reports status and debug data', async () => {
    const status = await handleHudCommand(mock.api, 'status')
    expect(status.message).toContain('HUD v0.1.0')
    expect(status.message).toContain('ctx 21%')

    const debug = await handleHudCommand(mock.api, 'debug')
    const parsed = JSON.parse(debug.message) as { version: string; config: { language: string } }
    expect(parsed.version).toBe('0.1.0')
    expect(parsed.config.language).toBe('en')
  })

  it('sets a quota plan and renders local meters', async () => {
    const result = await handleHudCommand(mock.api, 'plan go')
    expect(result.message).toContain('Go')
    const stored = mock.store.get('config') as {
      plan: string
      monthlyCap: number
      fiveHourCap: number
      weeklyCap: number
    }
    expect(stored.plan).toBe('go')
    expect(stored.monthlyCap).toBe(10)
    expect(stored.fiveHourCap).toBe(2)
    expect(stored.weeklyCap).toBe(5)

    const lines = mock.widgetOptions.at(-1)?.render({ width: 200 }) ?? []
    const text = lines.join('\n')
    expect(text).toContain('Quota')
    expect(text).toContain('local')
  })

  it('configures the quota source and monthly cycle day', async () => {
    await handleHudCommand(mock.api, 'quota local')
    await handleHudCommand(mock.api, 'quota cycle 15')
    let stored = mock.store.get('config') as { quotaSource: string; cycleDay: number }
    expect(stored.quotaSource).toBe('local')
    expect(stored.cycleDay).toBe(15)

    await handleHudCommand(mock.api, 'quota cycle auto')
    stored = mock.store.get('config') as { quotaSource: string; cycleDay: number }
    expect(stored.cycleDay).toBe(0)

    const invalid = await handleHudCommand(mock.api, 'quota cycle 40')
    expect(invalid.message).toContain('1-28')
  })

  it('rejects invalid manual quota values', async () => {
    const result = await handleHudCommand(mock.api, 'quota set nope nope')
    expect(result.message).toContain('usage: /hud quota set')
  })

  it('accepts a manual quota snapshot', async () => {
    const result = await handleHudCommand(
      mock.api,
      'quota set 5h=32 1w=41 month=29 used=23.4 cap=80 reset5h=3h12m',
    )
    expect(result.message).toContain('32%')
    const stored = mock.store.get('quota.exact') as {
      fiveHourPercent: number
      weeklyPercent: number
    }
    expect(stored.fiveHourPercent).toBe(32)
    expect(stored.weeklyPercent).toBe(41)
    const savedConfig = mock.store.get('config') as { quotaSource: string }
    expect(savedConfig.quotaSource).toBe('manual')

    const text = (mock.widgetOptions.at(-1)?.render({ width: 200 }) ?? []).join('\n')
    expect(text).toContain('32%')
    expect(text).toContain('41%')
    expect(text).toContain('3h12m')
    expect(text).toContain('$23.4/$80')
  })

  it('captures /usage output and prefers exact meters', async () => {
    await handleHudCommand(mock.api, 'plan goat')
    const capture = mock.overrides.find(entry => entry.component === 'command_output')
    expect(capture).toBeDefined()
    capture?.render(
      {
        message: [
          'Usage limits',
          '5-hour ███░░░░░░░ 32% · resets in 3h 12m',
          'Weekly ████░░░░░░ 41% · resets in 2d 4h',
        ].join('\n'),
      },
      () => undefined,
    )
    await new Promise(resolve => setTimeout(resolve, 0))

    const exact = mock.store.get('quota.exact') as { fiveHourPercent: number }
    expect(exact.fiveHourPercent).toBe(32)

    const lines = mock.widgetOptions.at(-1)?.render({ width: 200 }) ?? []
    const text = lines.join('\n')
    expect(text).toContain('Quota')
    expect(text).toContain('32%')
    expect(text).toContain('41%')
    expect(text).toContain('3h 12m')
    expect(text).not.toContain('(local)')
  })

  it('resets configuration and explains unknown subcommands', async () => {
    await handleHudCommand(mock.api, 'preset minimal')
    await handleHudCommand(mock.api, 'reset')
    const stored = mock.store.get('config') as { preset: string }
    expect(stored.preset).toBe('full')

    const help = await handleHudCommand(mock.api, 'nonsense')
    expect(help.message).toContain('usage: /hud')
  })
})
