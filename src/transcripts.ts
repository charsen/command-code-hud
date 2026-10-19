import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageSample } from './types'

export interface TranscriptCacheEntry {
  mtimeMs: number
  size: number
  samples: UsageSample[]
}

export type TranscriptCache = Map<string, TranscriptCacheEntry>

export function projectsDirectory(): string {
  return join(homedir(), '.commandcode', 'projects')
}

function isTranscript(name: string): boolean {
  return name.endsWith('.jsonl') && !name.endsWith('.checkpoints.jsonl')
}

function readSamples(content: string, file: string): UsageSample[] {
  const samples: UsageSample[] = []
  let index = 0
  for (const line of content.split('\n')) {
    index += 1
    if (!line.includes('"costUsd"')) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const timestamp =
      typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN
    if (!Number.isFinite(timestamp)) continue

    const usage = entry.usage
    if (!usage || typeof usage !== 'object') continue
    const cost = (usage as Record<string, unknown>).costUsd
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) continue

    const id =
      (typeof entry.id === 'string' && entry.id) ||
      (typeof entry.messageId === 'string' && entry.messageId) ||
      `${file}:${index}`
    samples.push({ id, at: timestamp, cost })
  }
  return samples
}

export async function scanUsageSamples(
  since: number,
  cache: TranscriptCache,
  root = projectsDirectory(),
): Promise<UsageSample[]> {
  let projects: string[]
  try {
    projects = await readdir(root)
  } catch {
    return []
  }

  const byId = new Map<string, UsageSample>()
  for (const project of projects) {
    const directory = join(root, project)
    let files: string[]
    try {
      files = await readdir(directory)
    } catch {
      continue
    }
    for (const file of files) {
      if (!isTranscript(file)) continue
      const path = join(directory, file)
      try {
        const info = await stat(path)
        if (info.mtimeMs < since) continue
        // Huge transcripts are skipped: the API is the primary quota source
        // and parsing a 50MB+ file every scan would block the event loop.
        if (info.size > 50 * 1024 * 1024) continue
        let cached = cache.get(path)
        if (!cached || cached.mtimeMs !== info.mtimeMs || cached.size !== info.size) {
          const content = await readFile(path, 'utf8')
          cached = {
            mtimeMs: info.mtimeMs,
            size: info.size,
            samples: readSamples(content, path),
          }
          cache.set(path, cached)
        }
        for (const sample of cached.samples) {
          if (sample.at < since) continue
          if (!byId.has(sample.id)) byId.set(sample.id, sample)
        }
      } catch {
        // A transcript being written can vanish or be replaced mid-scan.
      }
    }
  }

  return [...byId.values()]
}
