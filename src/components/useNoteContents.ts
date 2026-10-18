import { useEffect, useRef, useState } from 'react'
import { dirname, displayPath } from '../repo/paths.ts'
import { useSession } from '../repo/SessionContext.ts'
import { useRepo } from '../repo/session.ts'
import type { FolderNode } from '../repo/tree.ts'
import type { GrepNote } from '../search/grep.ts'
import { listItems } from '../search/names.ts'

export interface NoteContents {
  notes: GrepNote[]
  /** Notes not downloaded to this device yet (their contents can't be searched). */
  missing: number
}

/**
 * Contents of all notes available on this device (drafts and cached files; no downloads), for
 * content search. Reloads changed notes when the tree, drafts or cache change (e.g. the background
 * prefetch finished).
 */
export function useNoteContents(root: FolderNode, enabled = true): NoteContents | null {
  const session = useSession()
  const entries = useRepo((s) => s.snapshot?.entries)
  const dirty = useRepo((s) => s.dirty)
  const [changes, setChanges] = useState(0)
  const [result, setResult] = useState<NoteContents | null>(null)
  const cache = useRef(new Map<string, { version: string; content: string | undefined }>())
  const loadedOnce = useRef(false)

  useEffect(() => session.subscribe(() => setChanges((n) => n + 1)), [session])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = async () => {
      const versions = new Map((entries ?? []).map((e) => [e.path, e.md5 ?? e.id]))
      const notes = listItems(root).filter((n) => n.kind === 'note')
      await Promise.all(
        notes.map(async (n) => {
          const version = `${versions.get(n.path) ?? ''}:${session.draftVersion(n.path) ?? ''}`
          const c = cache.current.get(n.path)
          if (c && c.version === version && c.content !== undefined) return
          cache.current.set(n.path, { version, content: await session.readCached(n.path) })
        }),
      )
      if (cancelled) return
      const out: GrepNote[] = []
      let missing = 0
      for (const n of notes) {
        const content = cache.current.get(n.path)?.content
        if (content === undefined) missing++
        else
          out.push({
            path: n.path,
            name: n.name,
            icon: n.icon,
            parent: displayPath(dirname(n.path)),
            content,
          })
      }
      loadedOnce.current = true
      setResult({ notes: out, missing })
    }
    // First load at once; later reloads batched (several changes often arrive together).
    const timer = setTimeout(() => void load(), loadedOnce.current ? 200 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled, session, root, entries, dirty, changes])

  return result
}
