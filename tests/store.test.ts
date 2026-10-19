import { describe, expect, it } from 'vitest'
import { storeDelete, storeSet } from '../src/store'
import type { ModApi } from '../src/types'

function mockStore(): {
  api: ModApi
  writes: Array<[string, unknown]>
  maxConcurrent: () => number
} {
  const writes: Array<[string, unknown]> = []
  let active = 0
  let max = 0
  const api = {
    store: {
      set: async (key: string, value: unknown) => {
        active += 1
        max = Math.max(max, active)
        await new Promise(resolve => setTimeout(resolve, 1))
        writes.push([key, value])
        active -= 1
      },
      delete: async (key: string) => {
        active += 1
        max = Math.max(max, active)
        await new Promise(resolve => setTimeout(resolve, 1))
        writes.push([`delete:${key}`, undefined])
        active -= 1
      },
    },
  } as unknown as ModApi
  return { api, writes, maxConcurrent: () => max }
}

describe('store write queue', () => {
  it('serializes concurrent writes', async () => {
    const { api, writes, maxConcurrent } = mockStore()
    await Promise.all(
      Array.from({ length: 8 }, (_, index) => storeSet(api, `key-${index}`, index)),
    )
    expect(maxConcurrent()).toBe(1)
    expect(writes.map(([key]) => key)).toEqual(
      Array.from({ length: 8 }, (_, index) => `key-${index}`),
    )
  })

  it('serializes deletes with writes', async () => {
    const { api, writes, maxConcurrent } = mockStore()
    await storeSet(api, 'a', 1)
    await storeDelete(api, 'a')
    await storeSet(api, 'b', 2)
    expect(maxConcurrent()).toBe(1)
    expect(writes.map(([key]) => key)).toEqual(['a', 'delete:a', 'b'])
  })
})
