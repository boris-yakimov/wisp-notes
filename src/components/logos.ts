import urls from 'virtual:logo-urls'
import { LOGO_LIST, LOGO_PREFIX, type LogoDef } from './logoList.ts'

const byId = new Map(LOGO_LIST.map((l) => [l.id, l]))

/** The logo for an icon value like `logo:kubernetes`, if it is one we ship. */
export function logoOf(icon: string | undefined): (LogoDef & { url: string }) | undefined {
  if (!icon?.startsWith(LOGO_PREFIX)) return undefined
  const def = byId.get(icon.slice(LOGO_PREFIX.length))
  const url = def && urls[def.id]
  return def && url ? { ...def, url } : undefined
}

export const logoIcon = (id: string) => LOGO_PREFIX + id

/** All logo icon values, in display order. */
export const LOGO_ICONS = LOGO_LIST.map((l) => logoIcon(l.id))

/** Logo icon values matching a search: label/id prefix first, then word prefix, then keyword/substring. */
export function filterLogos(query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return LOGO_ICONS
  const scored: [number, number, string][] = []
  LOGO_LIST.forEach((l, i) => {
    const label = l.label.toLowerCase()
    let score: number
    if (label === q || l.id === q) score = 0
    else if (label.startsWith(q) || l.id.startsWith(q)) score = 1
    else if (label.split(/[^a-z0-9+#]+/).some((w) => w.startsWith(q))) score = 2
    else if (l.keywords.some((k) => k.startsWith(q))) score = 3
    else if (label.includes(q) || l.id.includes(q)) score = 4
    else return
    scored.push([score, i, logoIcon(l.id)])
  })
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , v]) => v)
}
