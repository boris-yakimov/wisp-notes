import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Prec, Transaction, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, keymap, placeholder } from '@codemirror/view'
import { getCM, Vim, vim } from '@replit/codemirror-vim'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useUi } from '../store/ui.ts'
import { inlineImages, type ImageResolver } from './images.ts'
import { linkClick } from './links.ts'
import { livePreview } from './livePreview.ts'
import { tablePreview } from './tables.ts'
import { editorTheme, markdownHighlight } from './theme.ts'

export interface EditorHandle {
  /** Replace the whole document (e.g. remote update), keeping the cursor where possible. */
  replaceContent: (text: string) => void
  getContent: () => string
  focus: () => void
  /** Select a range and scroll it into view (search results). */
  selectRange: (from: number, to: number) => void
  view: () => EditorView | null
}

export interface EditorProps {
  content: string
  onChange?: (text: string) => void
  onSave?: () => void
  onVimMode?: (mode: string | null) => void
  /** Object URL for an image written in the note (`![](src)`), or null if it can't be shown. */
  resolveImage?: ImageResolver
  /** An image was pasted: store it and return the Markdown to insert (null = not handled). */
  onPasteImage?: (image: File) => string | null
  /** Ctrl/Cmd+Shift+V could not read the clipboard (permission denied, unsupported). */
  onClipboardError?: (message: string) => void
  /** Ctrl/Cmd+click on a link; receives the link target as written. */
  onOpenLink?: (href: string) => void
  vimEnabled: boolean
  livePreviewEnabled: boolean
  /** Dark color scheme (CodeMirror's built-in panels/selection; our colors come from CSS variables). */
  dark?: boolean
  readOnly?: boolean
  autoFocus?: boolean
  /** Selected and scrolled into view on mount (search match). */
  initialSelection?: { from: number; to: number }
}

/** onSave handler per view, so the global `:w` ex command can find the right editor. */
const saveHandlers = new WeakMap<EditorView, () => void>()
let exDefined = false
function defineExCommands() {
  if (exDefined) return
  exDefined = true
  const save = (cm: { cm6: EditorView }) => saveHandlers.get(cm.cm6)?.()
  Vim.defineEx('write', 'w', save)
  Vim.defineEx('update', 'up', save)
  // \ff in normal mode opens search (like a <leader>ff finder in nvim)
  Vim.defineAction('openQuickOpen', () => useUi.getState().setQuickOpen(true))
  Vim.mapCommand('\\ff', 'action', 'openQuickOpen', {}, { context: 'normal' })
}

/** Is vim on and not in insert mode? Then a paste goes on a new line below, like vim's `p` for lines. */
function inVimCommandMode(view: EditorView): boolean {
  const vimState = (getCM(view)?.state as { vim?: { insertMode?: boolean } } | undefined)?.vim
  return !!vimState && !vimState.insertMode
}

/** Insert text: at the cursor, or (vim normal/visual mode) on new lines below the cursor's line. */
function insertPasted(view: EditorView, text: string, ownLine: boolean) {
  if (inVimCommandMode(view)) {
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    const insert = '\n' + text
    view.dispatch({
      changes: { from: line.to, insert },
      selection: { anchor: line.to + 1 },
      userEvent: 'input.paste',
      scrollIntoView: true,
    })
    return
  }
  const { from, to } = view.state.selection.main
  const before = ownLine && from > view.state.doc.lineAt(from).from ? '\n' : ''
  const after = ownLine && to < view.state.doc.lineAt(to).to ? '\n' : ''
  const insert = before + text + after
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: 'input.paste',
    scrollIntoView: true,
  })
}

/** Store pasted images and insert their Markdown, each on its own line (like a screenshot in Notion). */
function insertImages(view: EditorView, images: File[], onPaste: (f: File) => string | null) {
  const md = images.map((f) => onPaste(f)).filter((m): m is string => !!m)
  if (md.length) insertPasted(view, md.join('\n'), true)
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** Ctrl/Cmd+Shift+V: paste images from the clipboard, else its text (as plain text). */
async function pasteFromClipboard(view: EditorView, props: EditorProps) {
  try {
    if (props.onPasteImage && navigator.clipboard?.read) {
      const items = await navigator.clipboard.read()
      const images: File[] = []
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type) {
          const blob = await item.getType(type)
          images.push(new File([blob], `image.${EXT[type] ?? 'png'}`, { type }))
        }
      }
      if (images.length) {
        insertImages(view, images, props.onPasteImage)
        return
      }
    }
    const text = await navigator.clipboard.readText()
    if (text) insertPasted(view, text, false)
  } catch (e) {
    props.onClipboardError?.(
      e instanceof DOMException && e.name === 'NotAllowedError'
        ? 'The browser did not allow reading the clipboard. Allow clipboard access for this site, or use Ctrl+V in insert mode.'
        : `Could not read the clipboard: ${(e as Error).message}`,
    )
  }
}

const vimExt = (on: boolean): Extension => (on ? vim() : [])

const darkExt = (on: boolean): Extension => EditorView.darkTheme.of(on)
const readOnlyExt = (ro: boolean): Extension => [EditorState.readOnly.of(ro), EditorView.editable.of(!ro)]

/** CodeMirror 6 Markdown editor with optional vim mode and live preview. Remount (key) per note. */
export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const previewRef = useRef<(on: boolean) => Extension>(() => [])
  const compartments = useRef({
    vim: new Compartment(),
    preview: new Compartment(),
    ro: new Compartment(),
    dark: new Compartment(),
  })

  useEffect(() => {
    defineExCommands()
    const c = compartments.current
    const p = propsRef.current
    const resolveImage: ImageResolver = (src) => propsRef.current.resolveImage?.(src) ?? null
    const openLink = (href: string) => propsRef.current.onOpenLink?.(href)
    const previewExt = (on: boolean): Extension => [
      on ? [livePreview(), tablePreview(openLink)] : [],
      inlineImages(resolveImage, on),
    ]
    previewRef.current = previewExt
    const save = () => {
      propsRef.current.onSave?.()
      return true
    }
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: p.content,
        extensions: [
          c.vim.of(vimExt(p.vimEnabled)), // must precede other keymaps
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
          markdownHighlight,
          linkClick((href) => propsRef.current.onOpenLink?.(href)),
          EditorView.domEventHandlers({
            paste(e, view) {
              const onPaste = propsRef.current.onPasteImage
              if (!onPaste || view.state.readOnly) return false
              const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
              if (!images.length) return false
              e.preventDefault()
              insertImages(view, images, onPaste)
              return true
            },
          }),
          // Ctrl/Cmd+Shift+V reads the clipboard itself, so it also works in vim normal/visual mode
          // (where vim takes Ctrl+V and no paste event happens). Runs before vim's key handling.
          Prec.highest(
            EditorView.domEventHandlers({
              keydown(e, view) {
                if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== 'v')
                  return false
                if (view.state.readOnly) return false
                e.preventDefault()
                void pasteFromClipboard(view, propsRef.current)
                return true
              },
            }),
          ),
          editorTheme,
          c.dark.of(darkExt(!!p.dark)),
          search({ top: true }),
          highlightSelectionMatches(),
          placeholder('Start writing…'),
          keymap.of([
            { key: 'Mod-s', run: save, preventDefault: true },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
          c.preview.of(previewExt(p.livePreviewEnabled)),
          c.ro.of(readOnlyExt(!!p.readOnly)),
          EditorView.contentAttributes.of({
            'aria-label': 'Note editor',
            spellcheck: 'true',
            autocapitalize: 'sentences',
          }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return
            if (u.transactions.every((tr) => tr.isUserEvent('remote'))) return
            propsRef.current.onChange?.(u.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    saveHandlers.set(view, () => propsRef.current.onSave?.())
    if (p.initialSelection) {
      const len = view.state.doc.length
      const from = Math.min(p.initialSelection.from, len)
      view.dispatch({
        selection: { anchor: from, head: Math.min(p.initialSelection.to, len) },
        effects: EditorView.scrollIntoView(from, { y: 'center' }),
      })
    }
    if (p.autoFocus) view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // Vim mode indicator
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: compartments.current.vim.reconfigure(vimExt(props.vimEnabled)) })
    if (!props.vimEnabled) {
      propsRef.current.onVimMode?.(null)
      return
    }
    const cm = getCM(view)
    if (!cm) return
    propsRef.current.onVimMode?.('normal')
    const onMode = (e: { mode: string; subMode?: string }) =>
      propsRef.current.onVimMode?.(e.subMode ? `${e.mode} ${e.subMode}` : e.mode)
    cm.on('vim-mode-change', onMode)
    return () => cm.off('vim-mode-change', onMode)
  }, [props.vimEnabled])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.preview.reconfigure(previewRef.current(props.livePreviewEnabled)),
    })
  }, [props.livePreviewEnabled])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.current.ro.reconfigure(readOnlyExt(!!props.readOnly)) })
  }, [props.readOnly])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.current.dark.reconfigure(darkExt(!!props.dark)) })
  }, [props.dark])

  useImperativeHandle(ref, () => ({
    replaceContent(text) {
      const view = viewRef.current
      if (!view) return
      const old = view.state.doc.toString()
      if (old === text) return
      // Minimal change: common prefix/suffix, so the cursor stays put.
      let start = 0
      while (start < old.length && start < text.length && old[start] === text[start]) start++
      let endOld = old.length
      let endNew = text.length
      while (endOld > start && endNew > start && old[endOld - 1] === text[endNew - 1]) {
        endOld--
        endNew--
      }
      view.dispatch({
        changes: { from: start, to: endOld, insert: text.slice(start, endNew) },
        annotations: Transaction.addToHistory.of(false),
        userEvent: 'remote',
      })
    },
    getContent: () => viewRef.current?.state.doc.toString() ?? '',
    focus: () => viewRef.current?.focus(),
    selectRange(from, to) {
      const view = viewRef.current
      if (!view) return
      const len = view.state.doc.length
      view.dispatch({
        selection: { anchor: Math.min(from, len), head: Math.min(to, len) },
        effects: EditorView.scrollIntoView(Math.min(from, len), { y: 'center' }),
      })
      view.focus()
    },
    view: () => viewRef.current,
  }))

  return <div ref={host} className="h-full" data-testid="editor" />
})
