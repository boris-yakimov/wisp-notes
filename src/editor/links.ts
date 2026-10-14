import { syntaxTree } from '@codemirror/language'
import { Prec, type EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/**
 * The link target written in the document at `pos`, or null. Covers `[text](url)`, `<url>` and bare
 * URLs / e-mail addresses (GFM autolinks).
 */
export function linkAt(state: EditorState, pos: number): string | null {
  const tree = syntaxTree(state)
  for (const side of [1, -1] as const) {
    for (let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side); n; n = n.parent) {
      if (n.name === 'Link' || n.name === 'Autolink') {
        const url = n.getChild('URL')
        return url ? state.sliceDoc(url.from, url.to) : null
      }
      if (n.name === 'URL') return state.sliceDoc(n.from, n.to)
    }
  }
  return null
}

/** Ctrl+click (Cmd+click on macOS) on a link calls `onOpen` with its target instead of placing the cursor. */
export function linkClick(onOpen: (href: string) => void): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
        const href = pos === null ? null : linkAt(view.state, pos)
        if (!href) return false
        e.preventDefault()
        onOpen(href)
        return true
      },
    }),
  )
}
