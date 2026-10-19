import { describe, expect, it } from 'vitest'
import { parseGitStatus } from '../src/git'

describe('parseGitStatus', () => {
  it('parses branch, dirty counts and an ahead marker', () => {
    const status = parseGitStatus(
      [
        '## main...origin/main [ahead 1]',
        ' M src/a.ts',
        'A  src/new.ts',
        ' D src/gone.ts',
        'R  old.ts -> new.ts',
        '?? scratch.md',
      ].join('\n'),
    )
    expect(status).toBeDefined()
    expect(status?.branch).toBe('main')
    expect(status?.modified).toBe(1)
    expect(status?.added).toBe(1)
    expect(status?.deleted).toBe(1)
    expect(status?.renamed).toBe(1)
    expect(status?.untracked).toBe(1)
    expect(status?.dirty).toBe(true)
  })

  it('reports a clean tree', () => {
    const status = parseGitStatus('## main...origin/main')
    expect(status?.branch).toBe('main')
    expect(status?.dirty).toBe(false)
  })

  it('handles a repository without commits', () => {
    expect(parseGitStatus('## No commits yet on dev\n?? a.ts')?.branch).toBe('dev')
  })

  it('handles a detached head', () => {
    expect(parseGitStatus('## HEAD (no branch)')?.branch).toBe('HEAD')
  })

  it('counts conflicts', () => {
    const status = parseGitStatus('## main\nUU src/a.ts\nAA src/b.ts')
    expect(status?.conflicted).toBe(2)
    expect(status?.dirty).toBe(true)
  })

  it('rejects output without a branch header', () => {
    expect(parseGitStatus('')).toBeUndefined()
    expect(parseGitStatus(' M src/a.ts')).toBeUndefined()
  })
})
