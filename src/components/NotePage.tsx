import { AlertCircle, Loader2 } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { EditorHandle } from '../editor/Editor.tsx'
import { loadPosition, savePosition, type ViewPosition } from '../editor/positions.ts'

// CodeMirror is the largest dependency: load it on demand, so the tree renders instantly.
const Editor = lazy(() => import('../editor/Editor.tsx').then((m) => ({ default: m.Editor })))
import { isImagePath, resolveLink, resolveRepoPath } from '../repo/links.ts'
import { fileName, notePathToUrl, noteTitle, urlToNotePath } from '../repo/paths.ts'
import { useSession } from '../repo/SessionContext.ts'
import { notify, useRepo } from '../repo/session.ts'
import { useResolvedTheme } from '../settings/theme.ts'
import { useApp } from '../store/app.ts'
import { useUi } from '../store/ui.ts'
import { SubPages } from './SubPages.tsx'

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; content: string }

/** Route /n/<path>: loads a note and edits it. */
export function NotePage() {
  // From the raw URL: the router's splat param would turn an encoded "/" in a name into a separator.
  const path = urlToNotePath(useLocation().pathname) ?? ''
  return <NoteView key={path} path={path} />
}

export interface NoteNavState {
  /** Text to highlight after opening (from search). */
  highlight?: string
}

function NoteView({ path }: { path: string }) {
  const session = useSession()
  const settings = useApp((s) => s.settings)
  const dark = useResolvedTheme() !== 'light'
  const setVimMode = useUi((s) => s.setVimMode)
  const expandTo = useUi((s) => s.expandTo)
  const location = useLocation()
  const navigate = useNavigate()
  const highlight = (location.state as NoteNavState | null)?.highlight
  const editor = useRef<EditorHandle>(null)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  // Content version of the note (hash, or temporary ID while it's being created); undefined = missing.
  const sha = useRepo((s) => {
    const e = s.snapshot?.entries.find((x) => x.path === path && !x.folder)
    return e ? (e.md5 ?? e.id) : undefined
  })
  const hasSnapshot = useRepo((s) => s.snapshot !== null)
  const exists = sha !== undefined

  useEffect(() => {
    expandTo(path)
    document.title = `${noteTitle(path)} · Wisp Notes`
    return () => {
      document.title = 'Wisp Notes'
    }
  }, [path, expandTo])

  // Initial load, and reload when the note changed remotely (no local edits pending).
  const ready = useRef(false)
  useEffect(() => {
    if (!hasSnapshot || !exists) return
    let cancelled = false
    session.readNote(path).then(
      (content) => {
        if (cancelled) return
        if (ready.current) {
          if (!session.hasDraft(path)) editor.current?.replaceContent(content)
          return
        }
        ready.current = true
        setLoad({ state: 'ready', content })
      },
      (e: Error) => {
        if (!cancelled && !ready.current) setLoad({ state: 'error', message: e.message })
      },
    )
    return () => {
      cancelled = true
    }
  }, [session, path, sha, exists, hasSnapshot])

  // Select a search match when opened from search.
  const initialSelection = useMemo(() => {
    if (load.state !== 'ready' || !highlight) return undefined
    const i = load.content.toLowerCase().indexOf(highlight.toLowerCase())
    return i >= 0 ? { from: i, to: i + highlight.length } : undefined
  }, [load, highlight])
  // Reopen where you left off (read once per note; NoteView remounts per path).
  const [initialPosition] = useState(() => loadPosition(path))
  const onPosition = useCallback((pos: ViewPosition) => savePosition(path, pos), [path])

  const onChange = useCallback((text: string) => void session.editNote(path, text), [session, path])
  const onSave = useCallback(() => void session.saver.saveNow(), [session])
  const onOpenLink = useCallback(
    (href: string) => {
      const target = resolveLink(href, path)
      if (target?.kind === 'note') navigate(notePathToUrl(target.path))
      else if (target?.kind === 'file') {
        // Open the tab now (still in the click), then point it at the downloaded file.
        const tab = window.open('', '_blank')
        if (tab) tab.opener = null
        session.fileUrl(target.path).then(
          (url) => tab?.location.replace(url),
          (e: Error) => {
            tab?.close()
            notify(`Could not open “${fileName(target.path)}”: ${e.message}`, 'error')
          },
        )
      } else if (target) window.open(target.url, '_blank', 'noopener,noreferrer')
    },
    [path, navigate, session],
  )
  const onPasteImage = useCallback(
    (image: File) => {
      try {
        const { markdown, done } = session.pasteImage(path, image)
        done.catch((e: Error) =>
          notify(`The pasted image could not be saved to Google Drive: ${e.message}`, 'error'),
        )
        return markdown
      } catch (e) {
        notify((e as Error).message, 'error')
        return null
      }
    },
    [path, session],
  )
  const onClipboardError = useCallback((message: string) => notify(message, 'error'), [])
  const resolveImage = useCallback(
    (src: string) => {
      const p = resolveRepoPath(src, path)
      return p && isImagePath(p) ? session.fileUrl(p) : null
    },
    [path, session],
  )

  if (load.state === 'loading' && hasSnapshot && !exists) {
    return <NoteError path={path} message="This note does not exist." />
  }
  if (load.state === 'loading') return <Loading />
  if (load.state === 'error') return <NoteError path={path} message={load.message} />
  return (
    <div className="flex h-full flex-col">
      {!exists && (
        <p className="border-b border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 px-4 py-1.5 text-sm text-amber-800 dark:text-amber-300">
          This note was moved or deleted.
        </p>
      )}
      <SubPages path={path} />
      <div className="min-h-0 flex-1">
        <Suspense fallback={<Loading />}>
          <Editor
            ref={editor}
            content={load.content}
            onChange={onChange}
            onSave={onSave}
            onOpenLink={onOpenLink}
            resolveImage={resolveImage}
            onPasteImage={onPasteImage}
            onClipboardError={onClipboardError}
            onVimMode={setVimMode}
            vimEnabled={settings.vim}
            livePreviewEnabled={settings.livePreview}
            dark={dark}
            readOnly={!exists}
            autoFocus
            initialSelection={initialSelection}
            initialPosition={initialPosition}
            onPosition={onPosition}
          />
        </Suspense>
      </div>
    </div>
  )
}

function NoteError({ path, message }: { path: string; message: string }) {
  return (
    <div
      role="alert"
      className="m-8 flex items-start gap-2 rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 p-3 text-sm text-red-800 dark:text-red-300"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">Could not open “{noteTitle(path)}”</p>
        <p>{message}</p>
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div className="flex items-center gap-2 p-8 text-sm text-neutral-500 dark:text-neutral-400" role="status">
      <Loader2 size={16} className="animate-spin" /> Loading note…
    </div>
  )
}
