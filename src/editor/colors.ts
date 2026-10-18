import { EditorSelection, EditorState, StateField, Transaction, type Extension } from '@codemirror/state'
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
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos)
      for (const s of findColorSpans(line.text, line.from)) {
        if (hideTags) ranges.push(hide.range(s.from, s.textFrom))
        if (s.textTo > s.textFrom) ranges.push(mark(s.color).range(s.textFrom, s.textTo))
        if (hideTags) ranges.push(hide.range(s.textTo, s.to))
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
        if (u.docChanged || u.viewportChanged) this.decorations = decorations(u.view, hideTags)
      }
    },
    { decorations: (v) => v.decorations },
  )
}

// ------------------------------------------------------------------ editing around hidden tags
//
// With the tags hidden, every position from `<span …>` to the first colored character looks like
// one spot, and so does everything from the last colored character to the end of `</span>`. The
// cursor is kept on one position per spot, so motions (incl. vim's, which work on the raw text)
// never stop invisibly inside a tag, and deletions never cut a tag in half.

/** Spans with text on the lines from `from` to `to`. */
function spansIn(state: EditorState, from: number, to: number) {
  const out = []
  for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) {
    const line = state.doc.line(n)
    out.push(...findColorSpans(line.text, line.from).filter((s) => s.textTo > s.textFrom))
  }
  return out
}

/**
 * Where a cursor that moved from `prev` to `pos` should be. The spot before a span's text is
 * represented by its first character (`textFrom`), the spot after it by the end of `</span>` (`to`),
 * so vim's block cursor always sits on a visible character. Moving left out of such a spot steps
 * over the hidden tag to the previous character (not for clicks, which land on either side of it).
 */
export function snapCursor(state: EditorState, pos: number, prev: number, pointer = false): number {
  for (const s of spansIn(state, pos, pos)) {
    const atStart = pos >= s.from && pos <= s.textFrom
    if (!atStart && !(pos >= s.textTo && pos <= s.to)) continue
    const spot = atStart ? s.textFrom : s.to
    const leftOf = atStart ? s.from - 1 : s.textTo - 1 // the visible character before the spot
    if (!pointer && prev === spot && pos < prev && leftOf >= state.doc.lineAt(pos).from) return leftOf
    return spot
  }
  return pos
}

type Range = [number, number]

function subtract(ranges: Range[], [a, b]: Range): Range[] {
  return ranges.flatMap(([f, t]): Range[] => {
    if (b <= f || a >= t) return [[f, t]]
    const left: Range = [f, Math.min(t, a)]
    const right: Range = [Math.max(f, b), t]
    return [left, right].filter(([x, y]) => x < y)
  })
}

/**
 * What deleting [from, to) should delete so color tags stay whole: tags are kept unless their whole
 * span is deleted, and a span whose text is all deleted is removed with its tags. A deletion of only
 * tag characters (Backspace right after a hidden tag) deletes the character before the tag instead.
 */
export function protectedDeletion(state: EditorState, from: number, to: number): Range[] {
  const spans = spansIn(state, from, to)
  const tags = (s: (typeof spans)[number]): Range[] => [
    [s.from, s.textFrom],
    [s.textTo, s.to],
  ]
  const inTag = spans.find((s) => tags(s).some(([a, b]) => a <= from && to <= b))
  if (inTag) {
    const before = from < inTag.textFrom ? inTag.from - 1 : inTag.textTo - 1
    if (before < state.doc.lineAt(from).from) return []
    // The character before a span's open tag can itself be the end of another span's close tag.
    if (spans.some((s) => tags(s).some(([a, b]) => a <= before && before < b))) return []
    return protectedDeletion(state, before, before + 1)
  }
  let ranges: Range[] = [[from, to]]
  for (const s of spans) {
    if (from <= s.from && s.to <= to) continue // the whole span goes
    for (const tag of tags(s)) ranges = subtract(ranges, tag)
    if (ranges.some(([a, b]) => a <= s.textFrom && s.textTo <= b))
      ranges = [...subtract(ranges, [s.from, s.to]), [s.from, s.to]] // its text goes: so does it
  }
  return ranges.sort((a, b) => a[0] - b[0])
}

/** Edits that change tags on purpose. */
const RAW_EDITS = ['undo', 'redo', 'remote', 'input.color']

/** Keeps the cursor off hidden tags and deletions from breaking them (live preview only). */
const tagGuard = EditorState.transactionFilter.of((tr) => {
  if (RAW_EDITS.some((e) => tr.isUserEvent(e))) return tr
  const start = tr.startState
  if (!tr.docChanged) {
    if (!tr.selection) return tr
    const prev = start.selection.main.head
    const pointer = tr.isUserEvent('select.pointer')
    const sel = tr.selection
    const ranges = sel.ranges.map((r) =>
      r.empty ? EditorSelection.cursor(snapCursor(tr.state, r.head, prev, pointer)) : r,
    )
    if (ranges.every((r, i) => r.head === sel.ranges[i]!.head)) return tr
    return [tr, { selection: EditorSelection.create(ranges, sel.mainIndex), sequential: true }]
  }
  const changes: Change[] = []
  let adjusted = false
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
    const insert = text.toString()
    const parts = fromA === toA ? [] : protectedDeletion(start, fromA, toA)
    if (fromA !== toA && (parts.length !== 1 || parts[0]![0] !== fromA || parts[0]![1] !== toA))
      adjusted = true
    if (!parts.length) changes.push({ from: fromA, to: fromA, insert })
    else parts.forEach(([from, to], i) => changes.push({ from, to, insert: i ? '' : insert }))
  })
  if (!adjusted) return tr
  const set = start.changes(changes)
  return {
    changes: set,
    selection: EditorSelection.cursor(set.mapPos(changes[0]!.from, 1)),
    effects: tr.effects,
    scrollIntoView: tr.scrollIntoView,
    userEvent: tr.annotation(Transaction.userEvent),
  }
})

// ------------------------------------------------------------------ toolbar on selection

const LABELS: Record<TextColor, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  gray: 'Gray',
}

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
  return [colorDisplay(hideTags), hideTags ? tagGuard : [], toolbarField]
}
