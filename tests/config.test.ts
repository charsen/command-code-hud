import { describe, expect, it } from 'vitest'
import {
  applyPreset,
  DEFAULT_CONFIG,
  disableItems,
  enableItems,
  normalizeConfig,
  normalizeLanguage,
  normalizePosition,
  normalizePreset,
  parseItems,
  PRESETS,
} from '../src/config'

describe('normalizeConfig', () => {
  it('falls back to defaults', () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(normalizeConfig({})).toEqual(DEFAULT_CONFIG)
  })

  it('normalizes aliases and drops unknown items', () => {
    const config = normalizeConfig({
      enabled: false,
      preset: 'minimal',
      position: 'above',
      language: 'zh-cn',
      color: false,
      footer: true,
      items: ['model', 'git', 'nope', 'ctx', 'model'],
    })
    expect(config.enabled).toBe(false)
    expect(config.preset).toBe('minimal')
    expect(config.position).toBe('above-editor')
    expect(config.language).toBe('zh-Hans')
    expect(config.color).toBe(false)
    expect(config.footer).toBe(true)
    expect(config.items).toEqual(['identity', 'project', 'context'])
  })

  it('keeps a custom preset marker', () => {
    expect(normalizeConfig({ preset: 'custom' }).preset).toBe('custom')
  })

  it('defaults to the slim bar and accepts the other styles', () => {
    expect(normalizeConfig(undefined).barStyle).toBe('half')
    expect(normalizeConfig({ barStyle: 'block' }).barStyle).toBe('block')
    expect(normalizeConfig({ barStyle: 'none' }).barStyle).toBe('none')
    expect(normalizeConfig({ barStyle: 'huge' }).barStyle).toBe('half')
  })

  it('accepts the manual quota source', () => {
    expect(normalizeConfig({ quotaSource: 'manual' }).quotaSource).toBe('manual')
    expect(normalizeConfig({ quotaSource: 'nope' }).quotaSource).toBe('auto')
  })

  it('migrates old default cycle days to a rolling 30d window', () => {
    expect(normalizeConfig({ version: 1, cycleDay: 1 }).cycleDay).toBe(0)
    expect(normalizeConfig({ version: 2, cycleDay: 1 }).cycleDay).toBe(0)
    expect(normalizeConfig({ version: 3, cycleDay: 1 }).cycleDay).toBe(1)
    expect(normalizeConfig({ version: 3, cycleDay: 0 }).cycleDay).toBe(0)
  })
})

describe('presets and items', () => {
  it('applies a preset', () => {
    const config = applyPreset(DEFAULT_CONFIG, 'minimal')
    expect(config.preset).toBe('minimal')
    expect(config.items).toEqual([...PRESETS.minimal])
  })

  it('marks manual changes as custom', () => {
    const enabled = enableItems(applyPreset(DEFAULT_CONFIG, 'minimal'), ['turns'])
    expect(enabled.preset).toBe('custom')
    expect(enabled.items).toContain('turns')

    const disabled = disableItems(enabled, ['context'])
    expect(disabled.items).not.toContain('context')
  })

  it('parses comma and space separated aliases', () => {
    expect(parseItems(['model, git', 'ctx', 'nope'])).toEqual([
      'identity',
      'project',
      'context',
    ])
  })
})

describe('normalizers', () => {
  it('normalizes language and position', () => {
    expect(normalizeLanguage('EN')).toBe('en')
    expect(normalizeLanguage('zh-Hans')).toBe('zh-Hans')
    expect(normalizeLanguage('fr')).toBeUndefined()
    expect(normalizePosition('below')).toBe('below-editor')
    expect(normalizePosition('above-editor')).toBe('above-editor')
    expect(normalizePosition('left')).toBeUndefined()
  })

  it('accepts only known presets', () => {
    expect(normalizePreset('full')).toBe('full')
    expect(normalizePreset('tiny')).toBeUndefined()
  })
})
