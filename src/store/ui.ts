import { create } from 'zustand'

const EXPANDED_KEY = 'wisp-notes:expanded'

function loadExpanded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

const isSmallScreen = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches

/** Pure UI state (no repo data). */
export interface UiState {
  expanded: Record<string, boolean>
  sidebarOpen: boolean
  quickOpen: boolean
  vimMode: string | null
  toggleFolder: (path: string) => void
  setExpanded: (path: string, open: boolean) => void
  /** Expand all ancestors of a path (e.g. the open note). */
  expandTo: (path: string) => void
  setSidebarOpen: (open: boolean) => void
  /** Close the drawer after navigating, on small screens only. */
  closeSidebarOnMobile: () => void
  setQuickOpen: (open: boolean) => void
  setVimMode: (mode: string | null) => void
}

export const useUi = create<UiState>((set, get) => {
  const persist = (expanded: Record<string, boolean>) => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(expanded))
    set({ expanded })
  }
  return {
    expanded: loadExpanded(),
    sidebarOpen: !isSmallScreen(),
    quickOpen: false,
    vimMode: null,
    toggleFolder: (path) => persist({ ...get().expanded, [path]: !get().expanded[path] }),
    setExpanded: (path, open) => persist({ ...get().expanded, [path]: open }),
    expandTo: (path) => {
      const parts = path.split('/').slice(0, -1)
      const expanded = { ...get().expanded }
      let changed = false
      for (let i = 1; i <= parts.length; i++) {
        const p = parts.slice(0, i).join('/')
        if (!expanded[p]) {
          expanded[p] = true
          changed = true
        }
      }
      if (changed) persist(expanded)
    },
    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    closeSidebarOnMobile: () => {
      if (isSmallScreen()) set({ sidebarOpen: false })
    },
    setQuickOpen: (quickOpen) => set({ quickOpen }),
    setVimMode: (vimMode) => set({ vimMode }),
  }
})
