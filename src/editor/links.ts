import { syntaxTree } from '@codemirror/language'
import { Prec, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/** A syntax tree node (from @lezer/common, which isn't a direct dependency). */
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>

const normalizeLabel = (s: string) => s.slice(1, -1).trim().replace(/\s+/g, ' ').toLowerCase()

/** `[label]: url` definitions in the document, per state. */
const definitionsCache = new WeakMap<EditorState, Set<string>>()
function definitions(state: EditorState): Set<string> {
  let defs = definitionsCache.get(state)
  if (!defs) {
    defs = new Set()
    for (const ref of syntaxTree(state).topNode.getChildren('LinkReference')) {
      const label = ref.getChild('LinkLabel')
      if (label) defs.add(normalizeLabel(state.sliceDoc(label.from, label.to)))
    }
    definitionsCache.set(state, defs)
  }
  return defs
}

/**
 * Is this `Link` node really a link? The parser makes every `[…]` a link node, but in Markdown
 * `argv[0]` or `a[i][j]` are plain text unless there's a `(url)` or a matching `[label]: url`.
 */
export function isRealLink(state: EditorState, link: SyntaxNode): boolean {
  if (link.getChild('URL')) return true
  const label = link.getChild('LinkLabel') // [text][label]
  const marks = link.getChildren('LinkMark')
  const text = label ?? (marks.length >= 2 ? { from: marks[0]!.from, to: marks[1]!.to } : null) // [label] / [label][]
  return !!text && definitions(state).has(normalizeLabel(state.sliceDoc(text.from, text.to)))
}

const noLinkMark = Decoration.mark({ class: 'cm-nolink' })

function noLinkDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (n) => {
        if (n.name !== 'Link') return
        if (!isRealLink(view.state, n.node)) ranges.push(noLinkMark.range(n.from, n.to))
        return false
      },
    })
  }
  return Decoration.set(ranges, true)
}

/**
 * Show `[…]` that isn't a link (e.g. `argv[0]`) as plain text instead of link-styled. Default
 * precedence, so the mark wraps the syntax-highlighting spans and `.cm-nolink *` can reset them.
 */
export const plainBrackets: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = noLinkDecorations(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state))
        this.decorations = noLinkDecorations(u.view)
    }
  },
  { decorations: (v) => v.decorations },
)

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
