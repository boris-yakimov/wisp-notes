import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Transaction, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, keymap, placeholder } from '@codemirror/view'
import { getCM, Vim, vim } from '@replit/codemirror-vim'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useUi } from '../store/ui.ts'
import { linkClick } from './links.ts'
import { livePreview } from './livePreview.ts'
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

const vimExt = (on: boolean): Extension => (on ? vim() : [])
const previewExt = (on: boolean): Extension => (on ? livePreview() : [])
const darkExt = (on: boolean): Extension => EditorView.darkTheme.of(on)
const readOnlyExt = (ro: boolean): Extension => [EditorState.readOnly.of(ro), EditorView.editable.of(!ro)]

/** CodeMirror 6 Markdown editor with optional vim mode and live preview. Remount (key) per note. */
export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
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
      effects: compartments.current.preview.reconfigure(previewExt(props.livePreviewEnabled)),
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
