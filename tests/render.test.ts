import { describe, expect, it } from 'vitest'
import { applyPreset, DEFAULT_CONFIG } from '../src/config'
import { renderHud } from '../src/render'
import { addTurn, createStats, recordTool } from '../src/stats'
import type { HudConfig, RenderInput } from '../src/types'

const NOW = 1_800_000_000_000

function buildInput(overrides: Partial<RenderInput> = {}): RenderInput {
  let stats = createStats(NOW - 3 * 3_600_000 - 14 * 60_000)
  stats = addTurn(stats, {
    input_tokens: 7_600_000,
    output_tokens: 32_400,
    cache_read_input_tokens: 7_200_000,
  })
  stats = recordTool(stats, 'shell_command', false)
  stats = recordTool(stats, 'shell_command', false)
  stats = recordTool(stats, 'read_file', false)

  return {
    config: { ...DEFAULT_CONFIG, items: [...DEFAULT_CONFIG.items] } as HudConfig,
    cwd: '/tmp/command-code-hud',
    model: 'glm-5.3',
    effort: 'high',
    sessionName: 'HUD work',
    context: { tokens: 210_000, contextWindow: 1_000_000, percent: 21 },
    stats,
    git: {
      branch: 'main',
      dirty: true,
      added: 1,
      modified: 2,
      deleted: 0,
      renamed: 0,
      copied: 0,
      typeChanged: 0,
      conflicted: 0,
      untracked: 1,
    },
    permissionMode: 'default',
    quota: {
      source: 'local',
      fiveHour: { used: 7, cap: 14, percent: 50, resetAt: NOW + 3 * 3_600_000 },
      weekly: { used: 17, cap: 35, percent: 49, resetAt: NOW + 2 * 86_400_000 },
      monthly: { used: 23.4, cap: 70, percent: 33, resetAt: NOW + 20 * 86_400_000 },
    },
    activeAgents: [{ type: 'explorer', since: NOW - 60_000 }],
    activeTool: null,
    isIdle: true,
    now: NOW,
    width: 160,
    color: false,
    version: '0.1.0',
    ...overrides,
  }
}

describe('renderHud', () => {
  it('renders identity, context, quota, activity and session rows', () => {
    const lines = renderHud(buildInput())
    expect(lines).toHaveLength(5)
    expect(lines[0]).toContain('[glm-5.3 high]')
    expect(lines[0]).toContain('command-code-hud')
    expect(lines[0]).toContain('git:(main*)')
    expect(lines[0]).toContain('M2 A1 ?1')
    expect(lines[0]).toContain('HUD work')

    expect(lines[1]).toContain('Context')
    expect(lines[1]).toContain('▄▄▁▁▁▁▁▁▁▁')
    expect(lines[1]).toContain('21%')
    expect(lines[1]).toContain('210K/1M')
    expect(lines[1]).toContain('cache 7.2M · 95%')

    expect(lines[2]).toContain('Quota (local)')
    expect(lines[2]).toContain('30d')
    expect(lines[2]).toContain('50%')
    expect(lines[2]).toContain('49%')
    expect(lines[2]).toContain('33%')
    expect(lines[2]).toContain('$23.4/$70')

    expect(lines[3]).toContain('mode: default')
    expect(lines[3]).toContain('shell_command ×2')
    expect(lines[3]).toContain('read_file ×1')
    expect(lines[3]).toContain('explorer×1')

    expect(lines[4]).toContain('3h 14m')
    expect(lines[4]).toContain('turns 1')
    expect(lines[4]).toContain('tokens 7.6M')
    const footer = lines[4] ?? ''
    expect(footer).toContain('HUD 0.1.0')
    expect(footer.trimEnd().endsWith('HUD 0.1.0')).toBe(true)
  })

  it('compacts provider prefixes and hides a 100% cache rate', () => {
    let stats = createStats(NOW)
    stats = addTurn(stats, {
      input_tokens: 1_000,
      output_tokens: 10,
      cache_read_input_tokens: 1_000,
    })
    const lines = renderHud(
      buildInput({ model: 'deepseek/deepseek-v4.1-flash', stats, quota: undefined }),
    )
    expect(lines[0]).toContain('[deepseek-v4.1-flash high]')
    expect(lines[0]).not.toContain('deepseek/deepseek')
    expect(lines[1]).toContain('cache 1K')
    expect(lines[1]).not.toContain('100%')
    expect(lines[4]).not.toContain('100%')
  })

  it('shows a quota hint until data is available', () => {
    const lines = renderHud(buildInput({ quota: undefined }))
    expect(lines.join('\n')).toContain('run /usage')
  })

  it('honors the minimal preset', () => {
    const config = applyPreset(DEFAULT_CONFIG, 'minimal')
    const lines = renderHud(buildInput({ config }))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('command-code-hud')
    expect(lines[1]).toContain('Context')
  })

  it('omits unavailable telemetry', () => {
    const lines = renderHud(
      buildInput({
        context: undefined,
        model: undefined,
        effort: undefined,
        sessionName: undefined,
        git: undefined,
        permissionMode: null,
        activeAgents: [],
        activeTool: null,
        stats: createStats(NOW),
      }),
    )
    expect(lines.join('\n')).not.toContain('undefined')
    expect(lines.join('\n')).not.toContain('mode:')
    expect(lines[0]).toContain('[model]')
    expect(lines[1]).toContain('Context —')
  })

  it('truncates long rows to the terminal width', () => {
    const lines = renderHud(buildInput({ width: 40 }))
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(40)
    expect(lines.join('\n')).toContain('…')
  })

  it('emits ANSI colors when enabled', () => {
    const lines = renderHud(buildInput({ color: true }))
    expect(lines.join('\n')).toContain('\u001B[')
  })
})
