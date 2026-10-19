import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/version'

describe('version', () => {
  it('matches package.json', () => {
    const path = fileURLToPath(new URL('../package.json', import.meta.url))
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version: string }
    expect(manifest.version).toBe(VERSION)
  })
})
