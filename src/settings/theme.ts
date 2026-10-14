import { useSyncExternalStore } from 'react'
import { useApp } from '../store/app.ts'
import type { Theme } from './settings.ts'

/** The look actually shown: "system" resolved against the OS preference. */
export type ResolvedTheme = Exclude<Theme, 'system'>

/** Themes with their own palette class on <html> (on top of `.dark`). */
const PALETTE_THEMES = ['synthwave', 'terminal'] as const

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

export function resolveTheme(theme: Theme, systemIsDark: boolean): ResolvedTheme {
  if (theme === 'system') return systemIsDark ? 'dark' : 'light'
  return theme
}

/**
 * Sets the classes on <html> that the styles key off: `.dark` drives Tailwind's `dark:` variant
 * (every theme but light is dark), `.synthwave` / `.terminal` remap the palette and editor colors (index.css).
 */
export function applyTheme(resolved: ResolvedTheme): void {
  const cl = document.documentElement.classList
  cl.toggle('dark', resolved !== 'light')
  for (const t of PALETTE_THEMES) cl.toggle(t, resolved === t)
}

/** Apply a theme once, before React renders (avoids a light flash on dark startup). */
export function applyThemeNow(theme: Theme): void {
  applyTheme(resolveTheme(theme, systemDark()))
}

/** The current look, following the setting and (for "system") the OS preference live. */
export function useResolvedTheme(): ResolvedTheme {
  const theme = useApp((s) => s.settings.theme)
  const system = useSyncExternalStore(subscribeSystem, systemDark, () => false)
  return resolveTheme(theme, system)
}
