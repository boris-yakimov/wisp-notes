import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { isInside, noteTitle, notePathToUrl } from '../repo/paths.ts'
import {
  countNotes,
  createFolderOp,
  createNoteOp,
  deleteFolderOp,
  deleteNoteOp,
  OpError,
  renameFolderOp,
  renameNoteOp,
  setFolderIconOp,
  type Op,
} from '../repo/ops.ts'
import { useSession } from '../repo/SessionContext.ts'
import { notify, useRepo } from '../repo/session.ts'
import type { FolderNode, NoteNode } from '../repo/tree.ts'
import { confirmDialog, iconDialog, promptDialog } from '../store/dialog.ts'
import { useUi } from '../store/ui.ts'

/** Path of the note open in the editor, if any. */
function currentNote(pathname: string): string | null {
  if (!pathname.startsWith('/n/')) return null
  return pathname
    .slice(3)
    .split('/')
    .map((s) => decodeURIComponent(s))
    .join('/')
}

/** Note & folder operations with dialogs, optimistic UI and navigation. */
export function useTreeActions() {
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const open = currentNote(location.pathname)
  const setExpanded = useUi((s) => s.setExpanded)

  const entries = () => useRepo.getState().snapshot?.entries ?? []

  /** Run an op: save affected drafts first, commit optimistically, follow moved/deleted open note. */
  const run = useCallback(
    async (build: () => Op, verb: string, afterApply?: (op: Op) => void) => {
      let op: Op
      try {
        op = build()
      } catch (e) {
        notify(e instanceof OpError ? e.message : String(e), 'error')
        return false
      }
      if (!op.changes.length) return true
      const dirty = useRepo.getState().dirty
      if (op.changes.some((c) => dirty[c.path])) {
        try {
          await session.flushPending()
        } catch (e) {
          notify(
            `Could not ${verb}: unsaved changes could not be saved first (${(e as Error).message})`,
            'error',
          )
          return false
        }
      }
      try {
        await session.applyOptimistic(op.changes, op.message, () => {
          if (open && op.moved?.[open]) navigate(notePathToUrl(op.moved[open]!), { replace: true })
          else if (open && op.changes.some((c) => c.path === open && c.content === null))
            navigate('/', { replace: true })
          afterApply?.(op)
        })
        return true
      } catch (e) {
        notify(`Could not ${verb}: ${(e as Error).message}`, 'error')
        return false
      }
    },
    [session, navigate, open],
  )

  const newNote = useCallback(
    async (folder: string) => {
      const name = await promptDialog({ title: 'New note', label: 'Name', confirmLabel: 'Create' })
      if (!name) return
      await run(
        () => createNoteOp(folder, name, (p) => session.exists(p)),
        'create the note',
        (op) => {
          if (folder) setExpanded(folder, true)
          navigate(notePathToUrl(op.target!))
        },
      )
    },
    [run, session, navigate, setExpanded],
  )

  const newFolder = useCallback(
    async (parent: string) => {
      const name = await promptDialog({ title: 'New folder', label: 'Name', confirmLabel: 'Create' })
      if (!name) return
      await run(
        () => createFolderOp(parent, name, entries()),
        'create the folder',
        (op) => {
          if (parent) setExpanded(parent, true)
          setExpanded(op.target!, true)
        },
      )
    },
    [run, setExpanded],
  )

  const rename = useCallback(
    async (node: FolderNode | NoteNode) => {
      const isNote = node.kind === 'note'
      const name = await promptDialog({
        title: isNote ? 'Rename note' : 'Rename folder',
        label: 'New name',
        initial: node.name,
        confirmLabel: 'Rename',
      })
      if (!name || name === node.name) return
      await run(
        () =>
          isNote ? renameNoteOp(node.path, name, entries()) : renameFolderOp(node.path, name, entries()),
        'rename',
        (op) => {
          if (!isNote && useUi.getState().expanded[node.path]) setExpanded(op.target!, true)
        },
      )
    },
    [run, setExpanded],
  )

  const remove = useCallback(
    async (node: FolderNode | NoteNode) => {
      const isNote = node.kind === 'note'
      const n = isNote ? 1 : countNotes(node.path, entries())
      const ok = await confirmDialog({
        title: isNote ? 'Delete note?' : 'Delete folder?',
        message: isNote
          ? `“${noteTitle(node.path)}” will be deleted. It stays recoverable from the Git history on GitHub.`
          : `“${node.name}” and the ${n} note${n === 1 ? '' : 's'} inside will be deleted. They stay recoverable from the Git history on GitHub.`,
        confirmLabel: 'Delete',
        danger: true,
      })
      if (!ok) return
      await run(
        () => (isNote ? deleteNoteOp(node.path, entries()) : deleteFolderOp(node.path, entries())),
        'delete',
      )
      if (!isNote && open && isInside(open, node.path)) navigate('/', { replace: true })
    },
    [run, navigate, open],
  )

  const changeIcon = useCallback(
    async (folder: FolderNode) => {
      const meta = useRepo.getState().metas[folder.path] ?? {}
      const icon = await iconDialog({ title: `Icon for “${folder.name}”`, current: meta.icon })
      if (icon === undefined) return
      await run(() => setFolderIconOp(folder.path, icon ?? undefined, meta), 'change the icon')
    },
    [run],
  )

  return { newNote, newFolder, rename, remove, changeIcon }
}
