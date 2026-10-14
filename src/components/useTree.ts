import { useMemo } from 'react'
import { useRepo } from '../repo/session.ts'
import { buildTree, type FolderNode } from '../repo/tree.ts'

/** Folder tree of the current snapshot (with icons from `_meta.json`). */
export function useTree(): FolderNode {
  const snapshot = useRepo((s) => s.snapshot)
  const metas = useRepo((s) => s.metas)
  return useMemo(() => {
    const entries = snapshot?.entries ?? []
    return buildTree(
      entries.filter((e) => !e.folder).map((e) => e.path),
      metas,
      entries.filter((e) => e.folder).map((e) => e.path),
    )
  }, [snapshot, metas])
}
