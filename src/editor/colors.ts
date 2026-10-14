import { EditorSelection, StateField, type EditorState, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  showTooltip,
  type DecorationSet,
  type Tooltip,
  type ViewUpdate,
} from '@codemirror/view'
import { getCM, Vim } from '@replit/codemirror-vim'
import { CLOSE, findColorSpans, OPEN, TEXT_COLORS, type TextColor } from '../repo/textColors.ts'

export type { TextColor }

interface Change {
  from: number
  to: number
  insert: string
}

/**
 * Changes that color the selection (or remove its color with `null`), per selected line:
 * - inside an existing colored span: recolor or unwrap that span;
 * - otherwise: color spans inside the selection are unwrapped, then the selected text is wrapped.
 */
export function colorChanges(state: EditorState, color: TextColor | null): Change[] {
  const changes: Change[] = []
  for (const r of state.selection.ranges) {
    if (r.empty && color) continue
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      const line = state.doc.line(n)
      const from = Math.max(r.from, line.from)
      const to = Math.min(r.to, line.to)
      const spans = findColorSpans(line.text, line.from)
      const around = spans.find((s) => s.textFrom <= from && to <= s.textTo && (from < to || !color))
      if (around) {
        if (color) changes.push({ from: around.from, to: around.textFrom, insert: OPEN(color) })
        else {
          changes.push({ from: around.from, to: around.textFrom, insert: '' })
          changes.push({ from: around.textTo, to: around.to, insert: '' })
        }
        continue
      }
      // Spans overlapping the selection: unwrap them (their text stays where it is).
      let a = from
      let b = to
      for (const s of spans) {
        if (s.to <= from || s.from >= to) continue
        a = Math.min(a, s.from)
        b = Math.max(b, s.to)
        changes.push({ from: s.from, to: s.textFrom, insert: '' })
        changes.push({ from: s.textTo, to: s.to, insert: '' })
      }
      if (!color || a === b || !state.doc.sliceString(from, to).trim()) continue
      changes.push({ from: a, to: a, insert: OPEN(color) }, { from: b, to: b, insert: CLOSE })
    }
  }
  return changes
}

/** Apply a color to the selection. Returns false if nothing changed. */
export function applyColor(view: EditorView, color: TextColor | null): boolean {
  const changes = colorChanges(view.state, color)
  if (!changes.length) return false
  const set = view.state.changes(changes)
  view.dispatch({
    changes: set,
    // Collapse to the end of the change, so the toolbar closes and the color is visible.
    selection: EditorSelection.cursor(set.mapPos(view.state.selection.main.to, 1)),
    userEvent: 'input.color',
  })
  const cm = getCM(view)
  // Leave vim visual mode, as after any visual-mode command.
  if (cm?.state.vim?.visualMode) Vim.exitVisualMode(cm as Parameters<typeof Vim.exitVisualMode>[0], false)
  view.focus()
  return true
}

// ------------------------------------------------------------------ display

const mark = (c: TextColor) => Decoration.mark({ class: `cm-color-${c}` })
const hide = Decoration.replace({})

function decorations(view: EditorView, hideTags: boolean): DecorationSet {
  const ranges = []
  const active = new Set<number>()
  if (view.hasFocus)
    for (const r of view.state.selection.ranges)
      for (let n = view.state.doc.lineAt(r.from).number; n <= view.state.doc.lineAt(r.to).number; n++)
        active.add(n)
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos)
      const hideHere = hideTags && !active.has(line.number)
      for (const s of findColorSpans(line.text, line.from)) {
        if (hideHere) ranges.push(hide.range(s.from, s.textFrom))
        if (s.textTo > s.textFrom) ranges.push(mark(s.color).range(s.textFrom, s.textTo))
        if (hideHere) ranges.push(hide.range(s.textTo, s.to))
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(ranges, true)
}

function colorDisplay(hideTags: boolean): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = decorations(view, hideTags)
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged)
          this.decorations = decorations(u.view, hideTags)
      }
    },
    { decorations: (v) => v.decorations },
  )
}

// ------------------------------------------------------------------ toolbar on selection

const LABELS: Record<TextColor, string> = { green: 'Green', red: 'Red' }

function toolbar(state: EditorState): Tooltip | null {
  const r = state.selection.main
  if (r.empty || state.readOnly) return null
  return {
    pos: r.head,
    above: r.head <= r.anchor,
    strictSide: false,
    arrow: false,
    create: (view) => {
      const dom = document.createElement('div')
      dom.className = 'cm-color-toolbar'
      dom.setAttribute('role', 'toolbar')
      dom.setAttribute('aria-label', 'Text color')
      const button = (label: string, cls: string, color: TextColor | null) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = cls
        b.textContent = label
        b.setAttribute('aria-label', color ? `Color text ${label.toLowerCase()}` : 'Remove text color')
        b.title = b.getAttribute('aria-label')!
        // Keep the editor's selection and focus.
        b.addEventListener('mousedown', (e) => e.preventDefault())
        b.addEventListener('click', () => applyColor(view, color))
        return b
      }
      for (const c of TEXT_COLORS) dom.append(button(LABELS[c], `cm-color-btn cm-color-${c}`, c))
      dom.append(button('Clear', 'cm-color-btn', null))
      return { dom }
    },
  }
}

const toolbarField = StateField.define<Tooltip | null>({
  create: toolbar,
  update: (value, tr) => (tr.docChanged || tr.selection ? toolbar(tr.state) : value),
  provide: (f) => showTooltip.from(f),
})

/** Colored text display (tags hidden with live preview) and the color toolbar on selections. */
export function textColors(hideTags: boolean): Extension {
  return [colorDisplay(hideTags), toolbarField]
}
