/** Settings persisted per device in localStorage. */

export interface Settings {
  token: string
  owner: string
  repo: string
  branch: string
  vim: boolean
  livePreview: boolean
}

const KEY = 'wisp-notes:settings'

export const defaultSettings: Settings = {
  token: '',
  owner: '',
  repo: '',
  branch: 'main',
  vim: true,
  livePreview: true,
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaultSettings }
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}

export function isConfigured(s: Settings): boolean {
  return Boolean(s.token && s.owner && s.repo && s.branch)
}

/** Identifies a repo+branch; used as the cache namespace. */
export function repoKey(s: Pick<Settings, 'owner' | 'repo' | 'branch'>): string {
  return `${s.owner}/${s.repo}@${s.branch}`
}
