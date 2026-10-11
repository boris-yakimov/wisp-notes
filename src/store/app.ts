import { create } from 'zustand'
import { loadSettings, saveSettings, type Settings } from '../settings/settings.ts'

export interface AppState {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
}

export const useApp = create<AppState>((set, get) => ({
  settings: loadSettings(),
  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    saveSettings(settings)
    set({ settings })
  },
}))
