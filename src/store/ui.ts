import { create } from 'zustand'

const EXPANDED_KEY = 'wisp-notes:expanded'

function loadExpanded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

const WIDTH_KEY = 'wisp-notes:sidebar-width'
export const SIDEBAR_DEFAULT_WIDTH = 256
export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 600

/** Keep the sidebar within its limits, leaving room for the note. */
export function clampSidebarWidth(w: number): number {
  const roomy = typeof window !== 'undefined' ? window.innerWidth - 320 : SIDEBAR_MAX_WIDTH
  const max = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, roomy))
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, w)))
}

function loadWidth(): number {
  const w = Number(localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(w) && w > 0
    ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, w))
    : SIDEBAR_DEFAULT_WIDTH
}

const isSmallScreen = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches

/** Pure UI state (no repo data). */
export type QuickOpenMode = 'names' | 'contents'

export interface UiState {
  expanded: Record<string, boolean>
  sidebarOpen: boolean
  /** Sidebar width in px on wide screens (drag its edge to change; saved on this device). */
  sidebarWidth: number
  /** `persist: false` while dragging; the final width is saved when the drag ends. */
  setSidebarWidth: (width: number, persist?: boolean) => void
  quickOpen: boolean
  /** What the quick-open palette searches: page/folder names (Ctrl+K, \ff) or page contents (Ctrl+G, \fg). */
  quickOpenMode: QuickOpenMode
  vimMode: string | null
  toggleFolder: (path: string) => void
  setExpanded: (path: string, open: boolean) => void
  /** Expand all ancestors of a path (e.g. the open note). */
  expandTo: (path: string) => void
  setSidebarOpen: (open: boolean) => void
  /** Close the drawer after navigating, on small screens only. */
  closeSidebarOnMobile: () => void
  /** Open (in `mode`, default names) or close the palette. */
  setQuickOpen: (open: boolean, mode?: QuickOpenMode) => void
  /** Shortcut behavior: open in `mode`; switch to it if open in the other mode; close if already in it. */
  toggleQuickOpen: (mode: QuickOpenMode) => void
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
    sidebarWidth: loadWidth(),
    setSidebarWidth: (width, save = true) => {
      const sidebarWidth = clampSidebarWidth(width)
      set({ sidebarWidth })
      if (save) localStorage.setItem(WIDTH_KEY, String(sidebarWidth))
    },
    quickOpen: false,
    quickOpenMode: 'names',
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
    setQuickOpen: (quickOpen, mode = 'names') =>
      set(quickOpen ? { quickOpen, quickOpenMode: mode } : { quickOpen }),
    toggleQuickOpen: (mode) => {
      const { quickOpen, quickOpenMode } = get()
      if (quickOpen && quickOpenMode === mode) set({ quickOpen: false })
      else set({ quickOpen: true, quickOpenMode: mode })
    },
    setVimMode: (vimMode) => set({ vimMode }),
  }
})
