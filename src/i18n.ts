import type { Language } from './types'

const MESSAGES = {
  en: {
    context: 'Context',
    cache: 'cache',
    quota: 'Quota',
    quotaHint: 'run /usage once for auto capture, or /hud quota set 5h=.. 1w=..',
    localEstimate: 'local',
    fiveHour: '5h',
    weekly: '1w',
    month: 'month',
    rolling30: '30d',
    mode: 'mode',
    tools: 'tools',
    agents: 'agents',
    turns: 'turns',
    tokens: 'tokens',
    compactions: 'compactions',
    in: 'in',
    out: 'out',
    hit: 'hit',
    running: 'running',
    idle: 'idle',
    errors: 'errors',
    hud: 'HUD',
    on: 'on',
    off: 'off',
  },
  'zh-Hans': {
    context: '上下文',
    cache: '缓存',
    quota: '配额',
    quotaHint: '运行一次 /usage 自动捕获，或 /hud quota set 5h=.. 1w=..',
    localEstimate: '本地',
    fiveHour: '5小时',
    weekly: '周',
    month: '月',
    rolling30: '30天',
    mode: '模式',
    tools: '工具',
    agents: '子代理',
    turns: '轮次',
    tokens: 'Token',
    compactions: '压缩',
    in: '输入',
    out: '输出',
    hit: '命中',
    running: '运行中',
    idle: '空闲',
    errors: '错误',
    hud: 'HUD',
    on: '开',
    off: '关',
  },
} as const

export type MessageKey = keyof typeof MESSAGES.en

export function message(language: Language, key: MessageKey): string {
  return MESSAGES[language][key]
}
