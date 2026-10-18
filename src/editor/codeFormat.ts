import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { getCM, Vim } from '@replit/codemirror-vim'

/**
 * Mark selected text as code, so it is kept exactly as written (no Markdown formatting):
 * inline code (`argv[0]`) or a fenced code block on its own lines.
 */

interface Change {
  from: number
  to: number
  insert: string
}

/** Longest run of backticks in `text`. */
const longestTicks = (text: string) => Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))

/** `text` as inline code, with enough backticks (and padding) for backticks inside it. */
export function inlineCode(text: string): string {
  const fence = '`'.repeat(longestTicks(text) + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return fence + pad + text + pad + fence
}

/** The inline code span containing [from, to], if any. */
function inlineCodeAround(state: EditorState, from: number, to: number) {
  for (
    let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(
      from,
      1,
    );
    n;
    n = n.parent
  ) {
    if (n.name === 'InlineCode' && n.from <= from && to <= n.to) return n
  }
  return null
}

/**
 * Toggle inline code on each selection range: wrap it in backticks, or (inside inline code) remove
 * them. A selection over several lines becomes a code block instead.
 */
export function inlineCodeChanges(state: EditorState): Change[] {
  const changes: Change[] = []
  for (const r of state.selection.ranges) {
    const code = inlineCodeAround(state, r.from, r.to)
    if (code) {
      const marks = code.getChildren('CodeMark')
      const open = marks[0]
      const close = marks[marks.length - 1]
      if (!open || !close || open === close) continue
      const inner = state.sliceDoc(open.to, close.from)
      const padded = inner.length > 2 && inner.startsWith(' ') && inner.endsWith(' ')
      changes.push({ from: open.from, to: open.to + (padded ? 1 : 0), insert: '' })
      changes.push({ from: close.from - (padded ? 1 : 0), to: close.to, insert: '' })
      continue
    }
    if (r.empty) continue
    if (state.doc.lineAt(r.from).number !== state.doc.lineAt(r.to).number) {
      changes.push(...codeBlockChange(state, r.from, r.to))
      continue
    }
    changes.push({ from: r.from, to: r.to, insert: inlineCode(state.sliceDoc(r.from, r.to)) })
  }
  return changes
}

/** Put [from, to] in a fenced code block on its own lines (splitting the line around it if needed). */
function codeBlockChange(state: EditorState, from: number, to: number): Change[] {
  const first = state.doc.lineAt(from)
  const last = state.doc.lineAt(to)
  // Whole lines when only whitespace is outside the selection on them.
  if (!state.sliceDoc(first.from, from).trim()) from = first.from
  if (!state.sliceDoc(to, last.to).trim()) to = last.to
  const text = state.sliceDoc(from, to)
  if (!text.trim()) return []
  const fence = '`'.repeat(Math.max(3, longestTicks(text) + 1))
  const before = from > first.from ? '\n' : ''
  const after = to < last.to ? '\n' : ''
  // Splitting a line: drop the spaces that would be left at the split points.
  while (before && from > first.from && state.sliceDoc(from - 1, from) === ' ') from--
  while (after && to < last.to && state.sliceDoc(to, to + 1) === ' ') to++
  return [{ from, to, insert: `${before}${fence}\n${text}\n${fence}${after}` }]
}

/** Code block for each non-empty selection range. */
export function codeBlockChanges(state: EditorState): Change[] {
  return state.selection.ranges.filter((r) => !r.empty).flatMap((r) => codeBlockChange(state, r.from, r.to))
}

/** Apply code changes; collapses the selection after the result and leaves vim visual mode. */
export function applyCode(view: EditorView, block: boolean): boolean {
  const changes = block ? codeBlockChanges(view.state) : inlineCodeChanges(view.state)
  if (!changes.length) return false
  const set = view.state.changes(changes)
  view.dispatch({
    changes: set,
    selection: EditorSelection.cursor(set.mapPos(view.state.selection.main.to, 1)),
    userEvent: 'input.format',
    scrollIntoView: true,
  })
  const cm = getCM(view)
  if (cm?.state.vim?.visualMode) Vim.exitVisualMode(cm as Parameters<typeof Vim.exitVisualMode>[0], false)
  view.focus()
  return true
}
