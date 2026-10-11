/**
 * Rank Lucide icon names for a query: exact > prefix > word prefix ("open" in "book-open") > substring.
 * Spaces in the query match dashes ("book open" → "book-open").
 */
export function filterIcons(names: readonly string[], query: string, limit = 160): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, '-')
  if (!q) return names.slice(0, limit)
  const scored: [number, string][] = []
  for (const n of names) {
    let score: number
    if (n === q) score = 0
    else if (n.startsWith(q)) score = 1
    else if (n.includes('-' + q)) score = 2
    else if (n.includes(q)) score = 3
    else continue
    scored.push([score, n])
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]))
  return scored.slice(0, limit).map(([, n]) => n)
}
