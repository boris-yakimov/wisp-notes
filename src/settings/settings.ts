/** Settings persisted per device in localStorage. */

export type Theme = 'system' | 'light' | 'dark' | 'synthwave'

export const THEMES: readonly Theme[] = ['system', 'light', 'dark', 'synthwave']

export interface Account {
  email: string
  name: string
}

export interface Settings {
  /** Google account the local data belongs to; null = signed out. */
  account: Account | null
  vim: boolean
  livePreview: boolean
  theme: Theme
}

const KEY = 'wisp-notes:settings'

export const defaultSettings: Settings = {
  account: null,
  vim: true,
  livePreview: true,
  theme: 'system',
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaultSettings }
    const s = { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) }
    // Settings from the GitHub version have no account.
    if (!s.account || typeof s.account.email !== 'string') s.account = null
    if (!THEMES.includes(s.theme)) s.theme = defaultSettings.theme
    return { account: s.account, vim: s.vim, livePreview: s.livePreview, theme: s.theme }
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}

export function isConfigured(s: Settings): boolean {
  return s.account !== null
}

/** Cache namespace for an account. */
export function repoKey(account: Account): string {
  return `gdrive:${account.email}`
}
