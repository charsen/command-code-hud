import type { ExecOptions, ExecResult, GitStatus } from './types'

const GIT_TIMEOUT_MS = 2_000

export function parseGitStatus(stdout: string): GitStatus | undefined {
  const lines = stdout.split('\n').filter(line => line.length > 0)
  if (lines.length === 0) return undefined

  const header = lines.find(line => line.startsWith('## '))
  if (!header) return undefined

  let raw = header.slice(3).trim()
  if (raw.startsWith('No commits yet on ')) raw = raw.slice('No commits yet on '.length)
  let branch: string
  if (raw.startsWith('HEAD (no branch)')) branch = 'HEAD'
  else branch = raw.split('...')[0]?.split(' ')[0] ?? 'HEAD'

  let modified = 0
  let added = 0
  let deleted = 0
  let renamed = 0
  let copied = 0
  let typeChanged = 0
  let conflicted = 0
  let untracked = 0

  for (const line of lines) {
    if (line.startsWith('## ') || line.startsWith('!!')) continue
    if (line.startsWith('??')) {
      untracked += 1
      continue
    }

    const xy = line.slice(0, 2)
    const x = xy[0] ?? ' '
    const y = xy[1] ?? ' '
    if (x === 'U' || y === 'U' || xy === 'AA' || xy === 'DD') {
      conflicted += 1
      continue
    }
    const type = x !== ' ' && x !== '?' ? x : y
    if (type === 'A') added += 1
    else if (type === 'D') deleted += 1
    else if (type === 'R') renamed += 1
    else if (type === 'C') copied += 1
    else if (type === 'T') typeChanged += 1
    else if (type === 'M') modified += 1
  }

  return {
    branch,
    dirty:
      modified + added + deleted + renamed + copied + typeChanged + conflicted + untracked > 0,
    added,
    modified,
    deleted,
    renamed,
    copied,
    typeChanged,
    conflicted,
    untracked,
  }
}

export async function collectGitStatus(
  exec: (options: ExecOptions) => Promise<ExecResult>,
  cwd: string,
): Promise<GitStatus | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GIT_TIMEOUT_MS)
  try {
    const result = await exec({
      command: 'git',
      args: ['status', '--porcelain=v1', '-b', '--untracked-files=normal'],
      cwd,
      signal: controller.signal,
    })
    if (result.code !== 0) return undefined
    return parseGitStatus(result.stdout)
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}
