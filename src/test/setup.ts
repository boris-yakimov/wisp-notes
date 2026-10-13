import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { resetCacheInstance } from '../cache/instance.ts'
import { resetAuthForTests } from '../drive/auth.ts'

// jsdom lacks these; CodeMirror and the UI store touch them.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia
document.createRange = (() => {
  const range = new Range()
  range.getBoundingClientRect = () => new DOMRect()
  range.getClientRects = () =>
    ({ item: () => null, length: 0, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
  return range
}) as typeof document.createRange

afterEach(async () => {
  cleanup()
  localStorage.clear()
  await resetCacheInstance()
  resetAuthForTests()
  delete window.google
  globalThis.indexedDB = new IDBFactory()
})
