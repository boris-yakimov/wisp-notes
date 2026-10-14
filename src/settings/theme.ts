import { useSyncExternalStore } from 'react'
import { useApp } from '../store/app.ts'
import type { Theme } from './settings.ts'

const QUERY = '(prefers-color-scheme: dark)'

function systemDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches
}

function subscribeSystem(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

export function isDark(theme: Theme, system: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && system)
}

/** Toggles the `.dark` class on <html> that Tailwind's `dark:` variant and the editor colors key off. */
export function applyDark(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark)
}

/** Apply a theme once, before React renders (avoids a light flash on dark startup). */
export function applyThemeNow(theme: Theme): void {
  applyDark(isDark(theme, systemDark()))
}

/** Whether the app is currently dark, following the setting and (for "system") the OS preference. */
export function useIsDark(): boolean {
  const theme = useApp((s) => s.settings.theme)
  const system = useSyncExternalStore(subscribeSystem, systemDark, () => false)
  return isDark(theme, system)
}
