import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { isRealLink } from './links.ts'

/**
 * Obsidian-style live preview: Markdown syntax markers are hidden except on lines
 * touched by the selection, block elements get line classes, and task markers
 * render as clickable checkboxes. Styling of bold/italic/headings comes from the
 * highlight style (see theme.ts); this extension only hides syntax and adds widgets.
 *
 * Hidden ranges never contain the cursor (the cursor's line is always shown raw),
 * so vim motions operate on plain text exactly as in raw mode.
 */

export type DecoKind = 'hide' | 'checkbox' | 'bullet' | 'line'

/** Plain description of a decoration, for tests and debugging. */
export interface DecoSpec {
  from: number
  to: number
  kind: DecoKind
  /** Line class (kind=line) or checkbox state (kind=checkbox: 'checked' | 'unchecked'). */
  value?: string
}

class CheckboxWidget extends WidgetType {
  readonly checked: boolean
  constructor(checked: boolean) {
    super()
    this.checked = checked
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked
  }
  toDOM() {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.className = 'cm-lp-task'
    box.setAttribute('aria-label', this.checked ? 'Completed task' : 'Open task')
    return box
  }
  ignoreEvent() {
    return false
  }
}

class BulletWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-lp-bullet'
    s.textContent = '•'
    return s
  }
}

const hide = Decoration.replace({})
const bullet = Decoration.replace({ widget: new BulletWidget() })
const checkboxDeco = (checked: boolean) => Decoration.replace({ widget: new CheckboxWidget(checked) })
const lineDeco = (cls: string) => Decoration.line({ class: cls })

/** Line numbers (1-based) touched by any selection range. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number
    const b = state.doc.lineAt(r.to).number
    for (let n = a; n <= b; n++) lines.add(n)
  }
  return lines
}

/**
 * Compute live-preview decorations for the given ranges (the visible viewport in the
 * editor; the whole document in tests). Pure: depends only on state + ranges.
 */
export function computeDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  focused = true,
): DecoSpec[] {
  const out: DecoSpec[] = []
  const active = focused ? activeLines(state) : new Set<number>()
  const doc = state.doc
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number)
  const cursorIn = (from: number, to: number) =>
    focused && state.selection.ranges.some((r) => r.from <= to && r.to >= from)
  const tree = syntaxTree(state)
  const seenLines = new Set<string>()
  const addLine = (pos: number, cls: string) => {
    const line = doc.lineAt(pos)
    const key = `${line.from}:${cls}` // de-dupe per line+class
    if (seenLines.has(key)) return
    seenLines.add(key)
    out.push({ from: line.from, to: line.from, kind: 'line', value: cls })
  }

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name
        if (/^ATXHeading\d$/.test(name)) {
          addLine(node.from, `cm-lp-h${name.slice(-1)}`)
          return
        }
        switch (name) {
          case 'HeaderMark': {
            if (node.node.parent?.name.startsWith('SetextHeading')) return
            if (isActive(node.from)) return
            // Hide "# " including the following space.
            const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
            out.push({ from: node.from, to: end, kind: 'hide' })
            return
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!isActive(node.from)) out.push({ from: node.from, to: node.to, kind: 'hide' })
            return
          case 'CodeMark':
            // Inline code backticks only; fenced code keeps its fences.
            if (node.node.parent?.name === 'InlineCode' && !isActive(node.from)) {
              out.push({ from: node.from, to: node.to, kind: 'hide' })
            }
            return
          case 'Link': {
            // `argv[0]` is not a link: keep its brackets (links.ts shows it unstyled).
            if (!isRealLink(state, node.node)) return false
            if (isActive(node.from)) return false
            const marks = node.node.getChildren('LinkMark')
            const open = marks[0]
            const close = marks[1]
            if (!open || !close || doc.sliceString(open.from, open.to) !== '[') return false
            out.push({ from: open.from, to: open.to, kind: 'hide' })
            out.push({ from: close.from, to: node.to, kind: 'hide' })
            return false
          }
          case 'Escape':
            // `\[` → `[`: the backslash only keeps the character from being formatted.
            if (!isActive(node.from)) out.push({ from: node.from, to: node.from + 1, kind: 'hide' })
            return
          case 'Blockquote':
            for (let p = node.from; p <= node.to;) {
              const line = doc.lineAt(p)
              addLine(line.from, 'cm-lp-quote')
              p = line.to + 1
            }
            return
          case 'QuoteMark':
            if (!isActive(node.from)) {
              const end = doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
              out.push({ from: node.from, to: end, kind: 'hide' })
            }
            return
          case 'FencedCode': {
            const first = doc.lineAt(node.from).number
            const last = doc.lineAt(node.to).number
            for (let n = first; n <= last; n++) {
              const line = doc.line(n)
              addLine(line.from, 'cm-lp-codeblock')
              // First/last lines get the block's rounded corners and vertical padding.
              if (n === first) addLine(line.from, 'cm-lp-codeblock-first')
              if (n === last) addLine(line.from, 'cm-lp-codeblock-last')
            }
            return false
          }
          case 'ListMark': {
            if (isActive(node.from)) return
            const text = doc.sliceString(node.from, node.to)
            const item = node.node.parent
            const isTask = item?.getChild('Task') != null
            if (isTask) {
              // "- [ ] x" → hide "- ", the checkbox widget replaces "[ ]"
              out.push({ from: node.from, to: node.to + 1, kind: 'hide' })
            } else if (text === '-' || text === '*' || text === '+') {
              out.push({ from: node.from, to: node.to, kind: 'bullet' })
            }
            return
          }
          case 'TaskMarker': {
            if (cursorIn(node.from, node.to)) return
            const checked = /x/i.test(doc.sliceString(node.from, node.to))
            out.push({
              from: node.from,
              to: node.to,
              kind: 'checkbox',
              value: checked ? 'checked' : 'unchecked',
            })
            return
          }
          case 'HorizontalRule':
            if (!isActive(node.from)) addLine(node.from, 'cm-lp-hr')
            return
        }
        return undefined
      },
    })
  }
  return out
}

function toDecorationSet(specs: DecoSpec[]): DecorationSet {
  const ranges: Range<Decoration>[] = specs.map((s) => {
    switch (s.kind) {
      case 'hide':
        return hide.range(s.from, s.to)
      case 'bullet':
        return bullet.range(s.from, s.to)
      case 'checkbox':
        return checkboxDeco(s.value === 'checked').range(s.from, s.to)
      case 'line':
        return lineDeco(s.value!).range(s.from)
    }
  })
  return Decoration.set(ranges, true)
}

/** Toggle the task marker `[ ]` ↔ `[x]` at the given document position. Returns true if toggled. */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  let marker: { from: number; to: number } | null = null
  syntaxTree(view.state).iterate({
    from: pos,
    to: pos,
    enter: (n) => {
      if (n.name === 'TaskMarker') marker = { from: n.from, to: n.to }
    },
  })
  if (!marker) return false
  const { from, to } = marker
  const checked = /x/i.test(view.state.sliceDoc(from, to))
  view.dispatch({ changes: { from, to, insert: checked ? '[ ]' : '[x]' }, userEvent: 'input.toggle-task' })
  return true
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = toDecorationSet(computeDecorations(view.state, view.visibleRanges, view.hasFocus))
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        u.focusChanged ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.decorations = toDecorationSet(computeDecorations(u.state, u.view.visibleRanges, u.view.hasFocus))
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(e, view) {
        const t = e.target as HTMLElement
        if (t instanceof HTMLInputElement && t.classList.contains('cm-lp-task')) {
          e.preventDefault()
          return toggleTaskAt(view, view.posAtDOM(t))
        }
        return false
      },
    },
  },
)

export function livePreview(): Extension {
  return [livePreviewPlugin, EditorView.editorAttributes.of({ class: 'cm-live-preview' })]
}
