import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanUsageSamples, type TranscriptCache } from '../src/transcripts'

let root: string | undefined

async function writeProject(name: string, file: string, lines: string[]): Promise<void> {
  if (!root) return
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, file), `${lines.join('\n')}\n`, 'utf8')
}

function assistant(id: string, timestamp: string, cost: number): string {
  return JSON.stringify({ type: 'message', id, timestamp, usage: { costUsd: cost } })
}

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('scanUsageSamples', () => {
  it('reads cost samples, filters by time and dedupes ids', async () => {
    root = await mkdtemp(join(tmpdir(), 'command-code-hud-'))
    const since = Date.parse('2026-10-12T00:00:00Z')
    await writeProject('p1', 'one.jsonl', [
      assistant('a', '2026-10-19T00:00:00Z', 0.5),
      assistant('b', '2026-10-18T00:00:00Z', 0.25),
      assistant('old', '2026-10-01T00:00:00Z', 9),
      assistant('free', '2026-10-19T01:00:00Z', 0),
      '{"type":"message","id":"no-usage","timestamp":"2026-10-19T00:00:00Z"}',
      'not json',
    ])
    await writeProject('p2', 'two.jsonl', [
      assistant('a', '2026-10-19T00:00:00Z', 0.5),
    ])
    await writeProject('p1', 'one.checkpoints.jsonl', [
      assistant('checkpoint', '2026-10-19T00:00:00Z', 5),
    ])

    const cache: TranscriptCache = new Map()
    const samples = await scanUsageSamples(since, cache, root)
    expect(samples.map(sample => sample.id).sort()).toEqual(['a', 'b'])
    expect(samples.reduce((total, sample) => total + sample.cost, 0)).toBe(0.75)
    expect(cache.size).toBe(2)
  })

  it('returns an empty list when the transcript root is missing', async () => {
    const samples = await scanUsageSamples(0, new Map(), join(tmpdir(), 'does-not-exist-hud'))
    expect(samples).toEqual([])
  })
})
