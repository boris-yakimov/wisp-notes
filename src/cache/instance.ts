import { Cache } from './db.ts'

let instance: Promise<Cache> | null = null

/** App-wide IndexedDB cache (opened once). */
export function getCache(): Promise<Cache> {
  instance ??= Cache.open()
  return instance
}

/** Tests only: close and forget the shared instance. */
export async function resetCacheInstance(): Promise<void> {
  const p = instance
  instance = null
  if (p) (await p).close()
}
