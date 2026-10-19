import type { ModApi } from './types'

const QUEUE_KEY = Symbol.for('command-code-hud.store-write-queue')

interface QueueState {
  tail: Promise<void>
}

function queueState(): QueueState {
  const scope = globalThis as typeof globalThis & {
    [QUEUE_KEY]?: QueueState
  }
  if (!scope[QUEUE_KEY]) scope[QUEUE_KEY] = { tail: Promise.resolve() }
  return scope[QUEUE_KEY]
}

// The host's mod store is a read-modify-write JSON file. Fire-and-forget
// writes from several hooks can interleave and corrupt it, so every write
// from this mod goes through one process-wide queue.
export function storeSet(cmd: ModApi, key: string, value: unknown): Promise<void> {
  const state = queueState()
  state.tail = state.tail.then(() => cmd.store.set(key, value)).catch(() => {})
  return state.tail
}

export function storeDelete(cmd: ModApi, key: string): Promise<void> {
  const state = queueState()
  state.tail = state.tail.then(() => cmd.store.delete(key)).catch(() => {})
  return state.tail
}
