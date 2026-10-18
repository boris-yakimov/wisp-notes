import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { isImagePath, resolveRepoPath } from '../repo/links.ts'
import { useSession } from '../repo/SessionContext.ts'
import { useRepo } from '../repo/session.ts'
import { findContainer, findNote, type FolderNode } from '../repo/tree.ts'
import type { NameHit } from '../search/names.ts'
import { useResolvedTheme } from '../settings/theme.ts'
import { useApp } from '../store/app.ts'
import { FolderIcon } from './FolderIcon.tsx'

// Same lazily loaded chunk as the note page's editor.
const Editor = lazy(() => import('../editor/Editor.tsx').then((m) => ({ default: m.Editor })))

/** Wait this long before downloading an uncached note, so scrolling through results stays cheap. */
const DOWNLOAD_DELAY = 150

type Loaded = { path: string; version: string; content: string } | { path: string; error: string }

/**
 * Preview of the focused quick-open result, like Telescope's preview pane: the note rendered as in
 * the editor (read-only, with live preview: headings, code, colors, tables, images), or a folder's
 * contents.
 */
export function QuickOpenPreview({ hit, root }: { hit: NameHit | undefined; root: FolderNode }) {
  return (
    <section
      aria-label="Preview"
      data-testid="preview"
      className="flex h-full min-w-0 flex-col bg-neutral-50 dark:bg-neutral-950/40"
    >
      {!hit ? null : hit.kind === 'folder' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <FolderPreview folder={findContainer(root, hit.path)} />
        </div>
      ) : (
        <NotePreview path={hit.path} subPages={findNote(root, hit.path)?.children} />
      )}
    </section>
  )
}

function NotePreview({ path, subPages }: { path: string; subPages: FolderNode | undefined }) {
  const session = useSession()
  const livePreview = useApp((s) => s.settings.livePreview)
  const dark = useResolvedTheme() !== 'light'
  // Re-read when the note changes (sync, edits): version = content hash or draft timestamp.
  const version = useRepo((s) => {
    const e = s.snapshot?.entries.find((x) => x.path === path && !x.folder)
    return `${e?.md5 ?? e?.id ?? ''}:${session.draftVersion(path) ?? ''}`
  })
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = (content: string) => !cancelled && setLoaded({ path, version, content })
    const fail = (e: Error) => !cancelled && setLoaded({ path, error: e.message })
    void session.readCached(path).then((cached) => {
      if (cancelled) return
      if (cached !== undefined) return done(cached)
      timer = setTimeout(() => session.readNote(path).then(done, fail), DOWNLOAD_DELAY)
    }, fail)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [session, path, version])

  // Images are resolved relative to the previewed note, as in the editor.
  const notePath = loaded?.path
  const resolveImage = useCallback(
    (src: string) => {
      const p = notePath && resolveRepoPath(src, notePath)
      return p && isImagePath(p) ? session.fileUrl(p) : null
    },
    [notePath, session],
  )

  // While the next note loads, keep showing the previous one (dimmed) instead of flashing empty.
  const current = loaded?.path === path
  if (!loaded) return null
  if ('error' in loaded)
    return current ? (
      <p className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400">{loaded.error}</p>
    ) : null

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${current ? '' : 'opacity-50'}`}>
      {current && subPages && subPages.items.length > 0 && (
        <div className="border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <p className="mb-1 text-xs text-neutral-500 dark:text-neutral-400">Sub-pages</p>
          <ItemList folder={subPages} />
        </div>
      )}
      {!loaded.content.trim() ? (
        <p className="px-4 py-3 text-sm italic text-neutral-500 dark:text-neutral-400">Empty page</p>
      ) : (
        // Slightly smaller text than the editor, so more of the note fits.
        <div className="min-h-0 flex-1 [&_.cm-editor]:!text-sm">
          <Suspense fallback={null}>
            <Editor
              // A fresh read-only editor per note version (the editor reads `content` on mount only).
              key={`${loaded.path}\n${loaded.version}`}
              content={loaded.content}
              readOnly
              vimEnabled={false}
              livePreviewEnabled={livePreview}
              dark={dark}
              resolveImage={resolveImage}
              ariaLabel="Note preview"
            />
          </Suspense>
        </div>
      )}
    </div>
  )
}

function FolderPreview({ folder }: { folder: FolderNode | undefined }) {
  if (!folder || folder.items.length === 0)
    return <p className="text-sm italic text-neutral-500 dark:text-neutral-400">Empty folder</p>
  return <ItemList folder={folder} />
}

function ItemList({ folder }: { folder: FolderNode }) {
  return (
    <ul className="space-y-0.5 text-sm" aria-label={`Contents of ${folder.name || 'folder'}`}>
      {folder.items.map((item) => (
        <li key={item.path} className="flex items-center gap-1.5 text-neutral-700 dark:text-neutral-300">
          <FolderIcon
            name={item.icon}
            note={item.kind === 'note'}
            size={14}
            className="shrink-0 text-neutral-400 dark:text-neutral-500"
          />
          <span className="truncate">{item.name}</span>
          {item.kind === 'note' && item.children && item.children.items.length > 0 && (
            <span className="text-xs text-neutral-400">({item.children.items.length})</span>
          )}
        </li>
      ))}
    </ul>
  )
}
