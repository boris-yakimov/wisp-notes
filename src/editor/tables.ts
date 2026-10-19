import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { COLOR_SPAN_SOURCE } from '../repo/textColors.ts'

/**
 * Live preview of GFM tables: a table is always drawn as a grid. Cells are rendered as DOM text (never
 * as HTML), with links, bold, italic, strikethrough and inline code. Clicking a cell edits its Markdown
 * in place (Enter or clicking away saves, Escape cancels, Tab / Shift+Tab move to the next / previous
 * cell, Tab in the last cell adds a row). The cursor never stops inside a table's Markdown.
 * Ctrl/Cmd+click on a link in a cell opens it.
 */

type SyntaxNode = ReturnType<typeof syntaxTree>['topNode']

export type Align = 'left' | 'center' | 'right' | null

export interface TableSpec {
  /** Start of the first line and end of the last line of the table. */
  from: number
  to: number
  startLine: number
  endLine: number
  header: string[]
  align: Align[]
  rows: string[][]
  /** Source of each row, header first: its line number and the `[from, to)` range of each cell. */
  source: { line: number; cells: [number, number][] }[]
}

/** Cell ranges of a header/body row, split at the parser's `|` delimiters (empty cells included). */
function rowSegments(row: SyntaxNode): [number, number][] {
  const delims = row.getChildren('TableDelimiter')
  const segments: [number, number][] = []
  let start = row.from
  for (const d of delims) {
    segments.push([start, d.from])
    start = d.to
  }
  segments.push([start, row.to])
  // A leading/trailing pipe leaves an empty segment outside the table.
  if (delims[0] && delims[0].from === row.from) segments.shift()
  const lastDelim = delims[delims.length - 1]
  if (lastDelim && lastDelim.to === row.to) segments.pop()
  return segments
}

const cellText = (state: EditorState, [a, b]: [number, number]) =>
  state.sliceDoc(a, b).trim().replace(/\\\|/g, '|')

function alignments(text: string): Align[] {
  return text
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => {
      const t = c.trim()
      const l = t.startsWith(':')
      const r = t.endsWith(':')
      return l && r ? 'center' : r ? 'right' : l ? 'left' : null
    })
}

/** All tables in the document. Pure: depends only on the state. */
export function findTables(state: EditorState): TableSpec[] {
  const out: TableSpec[] = []
  const doc = state.doc
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return
      const t = node.node
      const head = t.getChild('TableHeader')
      if (!head) return false
      const delimRow = t.getChildren('TableDelimiter').find((d) => d.from > head.to)
      const first = doc.lineAt(t.from)
      const last = doc.lineAt(t.to)
      const source = [head, ...t.getChildren('TableRow')].map((r) => ({
        line: doc.lineAt(r.from).number,
        cells: rowSegments(r),
      }))
      const [headSrc, ...bodySrc] = source.map((s) => s.cells.map((c) => cellText(state, c)))
      out.push({
        from: first.from,
        to: last.to,
        startLine: first.number,
        endLine: last.number,
        header: headSrc!,
        align: delimRow ? alignments(state.sliceDoc(delimRow.from, delimRow.to)) : [],
        rows: bodySrc,
        source,
      })
      return false
    },
  })
  return out
}

const columnCount = (t: TableSpec) => Math.max(t.header.length, ...t.rows.map((r) => r.length))

/** The text of cell `col` in row `row` (0 is the header row). */
const cellAt = (t: TableSpec, row: number, col: number) =>
  (row === 0 ? t.header[col] : t.rows[row - 1]?.[col]) ?? ''

/**
 * The change that sets cell `col` of row `row` (0 is the header) to `value`, or null if it is unchanged.
 * Only that cell's source is replaced; a cell the row doesn't have yet rewrites the row's line.
 */
export function cellChange(
  state: EditorState,
  t: TableSpec,
  row: number,
  col: number,
  value: string,
): { from: number; to: number; insert: string } | null {
  const text = value.replace(/\s*\n\s*/g, ' ').trim()
  const src = t.source[row]
  if (!src || text === cellAt(t, row, col)) return null
  const md = text.replace(/\\?\|/g, '\\|')
  const cell = src.cells[col]
  if (cell) return { from: cell[0], to: cell[1], insert: ` ${md} ` }
  const line = state.doc.line(src.line)
  const parts = src.cells.map(([a, b]) => state.sliceDoc(a, b).trim())
  while (parts.length < col) parts.push('')
  parts[col] = md
  return { from: line.from, to: line.to, insert: `| ${parts.join(' | ')} |` }
}

/** Markdown for an empty body row of `cols` cells, inserted at the end of the table. */
export const emptyRow = (cols: number) => `\n|${'  |'.repeat(cols)}`

// ---------------------------------------------------------------- inline Markdown → DOM (text only)

type Inline = { re: RegExp; make: (m: RegExpExecArray) => Node }

/** Render a cell's inline Markdown as DOM nodes. Text is only ever set via text nodes. */
export function renderInline(text: string): DocumentFragment {
  const frag = document.createDocumentFragment()
  const rules: Inline[] = [
    {
      re: /`([^`]+)`/,
      make: (m) => {
        const c = document.createElement('code')
        c.textContent = m[1]!
        return c
      },
    },
    {
      re: /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/,
      make: (m) => {
        if (m[0].startsWith('!')) return document.createTextNode(m[1] || m[2]!)
        return link(m[1] || m[2]!, m[2]!)
      },
    },
    { re: /<((?:https?:\/\/|mailto:)[^>\s]+)>/, make: (m) => link(m[1]!.replace(/^mailto:/, ''), m[1]!) },
    {
      re: new RegExp(COLOR_SPAN_SOURCE, 'i'),
      make: (m) => {
        const el = document.createElement('span')
        el.className = `cm-color-${m[1]!.toLowerCase()}`
        el.append(renderInline(m[2]!))
        return el
      },
    },
    { re: /\*\*(.+?)\*\*|__(.+?)__/, make: (m) => wrap('strong', m[1] ?? m[2]!) },
    { re: /~~(.+?)~~/, make: (m) => wrap('del', m[1]!) },
    {
      re: /(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)|(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/,
      make: (m) => wrap('em', m[1] ?? m[2]!),
    },
  ]
  let rest = text
  while (rest) {
    let best: { m: RegExpExecArray; rule: Inline } | null = null
    for (const rule of rules) {
      const m = rule.re.exec(rest)
      if (m && (!best || m.index < best.m.index)) best = { m, rule }
    }
    if (!best) {
      frag.append(rest)
      break
    }
    if (best.m.index) frag.append(rest.slice(0, best.m.index))
    frag.append(best.rule.make(best.m))
    rest = rest.slice(best.m.index + best.m[0].length)
  }
  return frag
}

function wrap(tag: string, inner: string): Node {
  const el = document.createElement(tag)
  el.append(renderInline(inner))
  return el
}

function link(label: string, href: string): Node {
  const a = document.createElement('span')
  a.className = 'cm-table-link'
  a.dataset.href = href
  a.title = `${href} (Ctrl/Cmd+click to open)`
  a.append(renderInline(label))
  return a
}

// ---------------------------------------------------------------- widget + in-place cell editing

/** The table whose widget is `wrap`, read from the current state (the widget's own copy may be stale). */
function tableOf(view: EditorView, wrap: HTMLElement): TableSpec | null {
  if (!wrap.isConnected) return null
  const pos = view.posAtDOM(wrap)
  return findTables(view.state).find((t) => t.from <= pos && pos <= t.to) ?? null
}

/** The widget element of the table at `pos`, after a possible redraw. */
function wrapAt(view: EditorView, pos: number): HTMLElement | null {
  for (const w of view.contentDOM.querySelectorAll<HTMLElement>('.cm-table-wrap')) {
    if (tableOf(view, w)?.from === pos) return w
  }
  return null
}

/** Replace cell (`row`, `col`) of the drawn table `wrap` (row 0 is the header) with a text box. */
function editCell(view: EditorView, wrap: HTMLElement, row: number, col: number): void {
  const t = tableOf(view, wrap)
  const cell = wrap.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`)
  if (!t || !cell || view.state.readOnly) return
  const original = cellAt(t, row, col)
  const input = document.createElement('textarea')
  input.className = 'cm-table-input'
  input.rows = 1
  input.value = original
  input.setAttribute('aria-label', row === 0 ? 'Edit header cell' : 'Edit cell')
  cell.style.minWidth = `${cell.getBoundingClientRect().width}px` // don't let the column jump
  cell.classList.add('cm-table-editing')
  cell.replaceChildren(input)
  const fit = () => {
    input.style.height = 'auto'
    input.style.height = `${input.scrollHeight}px`
  }
  fit()
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)

  let done = false
  /** Save (or drop) the edit; then optionally open the next (1) / previous (-1) cell. */
  const finish = (save: boolean, step?: 1 | -1) => {
    if (done) return
    done = true
    const cur = tableOf(view, wrap) ?? t
    const change = save ? cellChange(view.state, cur, row, col, input.value) : null
    if (change) view.dispatch({ changes: change, userEvent: 'input' })
    else {
      cell.classList.remove('cm-table-editing')
      cell.style.minWidth = ''
      cell.replaceChildren(renderInline(original))
    }
    if (!step) return
    const now = tableOf(view, wrapAt(view, cur.from) ?? wrap) ?? cur
    const cols = columnCount(now)
    let i = row * cols + col + step
    // Header cells the header row doesn't have can't be added (the delimiter row would no longer match).
    while (i >= 0 && i < cols && i >= now.header.length) i += step
    if (i < 0) return view.focus()
    if (i >= (now.rows.length + 1) * cols) {
      view.dispatch({ changes: { from: now.to, insert: emptyRow(cols) }, userEvent: 'input' })
    }
    const next = wrapAt(view, now.from)
    if (next) editCell(view, next, Math.floor(i / cols), i % cols)
  }
  input.addEventListener('input', fit)
  input.addEventListener('blur', () => finish(true))
  input.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault()
      finish(e.key === 'Enter')
      view.focus()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      finish(true, e.shiftKey ? -1 : 1)
    }
  })
}

class TableWidget extends WidgetType {
  readonly t: TableSpec
  readonly open: (href: string) => void
  constructor(t: TableSpec, open: (href: string) => void) {
    super()
    this.t = t
    this.open = open
  }
  eq(other: TableWidget) {
    return (
      JSON.stringify([other.t.header, other.t.align, other.t.rows]) ===
      JSON.stringify([this.t.header, this.t.align, this.t.rows])
    )
  }
  toDOM(view: EditorView) {
    const wrapEl = document.createElement('div')
    wrapEl.className = 'cm-table-wrap'
    const table = document.createElement('table')
    table.className = 'cm-table'
    const cols = columnCount(this.t)
    const row = (cells: string[], tag: 'th' | 'td', r: number) => {
      const tr = document.createElement('tr')
      for (let i = 0; i < cols; i++) {
        const c = document.createElement(tag)
        const a = this.t.align[i]
        if (a) c.style.textAlign = a
        c.dataset.row = String(r)
        c.dataset.col = String(i)
        c.append(renderInline(cells[i] ?? ''))
        tr.append(c)
      }
      return tr
    }
    const thead = document.createElement('thead')
    thead.append(row(this.t.header, 'th', 0))
    const tbody = document.createElement('tbody')
    this.t.rows.forEach((r, i) => tbody.append(row(r, 'td', i + 1)))
    table.append(thead, tbody)
    wrapEl.append(table)
    // Ctrl/Cmd+click on a link opens it; a plain click on a cell edits that cell.
    wrapEl.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement
      if (e.button !== 0 || target.closest('.cm-table-input')) return
      const link = target.closest<HTMLElement>('.cm-table-link')
      if (link && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        this.open(link.dataset.href!)
        return
      }
      const cell = target.closest<HTMLElement>('th, td')
      if (!cell || view.state.readOnly) return
      e.preventDefault()
      editCell(view, wrapEl, Number(cell.dataset.row), Number(cell.dataset.col))
    })
    return wrapEl
  }
  /** The editor never handles events in the grid, so clicks and typing in a cell stay in the cell. */
  ignoreEvent() {
    return true
  }
}

interface TableState {
  tables: TableSpec[]
  deco: DecorationSet
}

/**
 * Keep the cursor off a table's Markdown: a cursor that would land in a table (arrow keys, vim j/k,
 * clicks beside it) goes to the line after it, or before it when moving up. A selection may still span
 * a whole table (e.g. select all).
 */
function keepCursorOut(field: StateField<TableState>) {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.selection && !tr.docChanged) return tr
    const tables = tr.startState.field(field, false)?.tables ?? []
    if (!tables.length) return tr
    const doc = tr.newDoc
    const sel = tr.newSelection
    const oldHead = tr.startState.selection.main.head
    const col = oldHead - tr.startState.doc.lineAt(oldHead).from
    const oldPos = tr.changes.mapPos(oldHead)
    const at = (pos: number) => {
      const l = doc.lineAt(pos)
      return l.from + Math.min(col, l.length)
    }
    let changed = false
    const ranges = sel.ranges.map((r) => {
      for (const t of tables) {
        const from = tr.changes.mapPos(t.from, 1)
        const to = tr.changes.mapPos(t.to, -1)
        const inside = r.empty ? r.head >= from && r.head <= to : r.head > from && r.head < to
        if (from > to || !inside) continue
        const before = from > 0 ? at(from - 1) : null
        const after = to < doc.length ? at(to + 1) : null
        const head = oldPos > to ? (before ?? after) : (after ?? before)
        if (head === null) return r
        changed = true
        return r.empty ? EditorSelection.cursor(head) : EditorSelection.range(r.anchor, head)
      }
      return r
    })
    if (!changed) return tr
    return [tr, { selection: EditorSelection.create(ranges, sel.mainIndex), sequential: true }]
  })
}

/** Table preview (part of live preview). `open` receives the href of a Ctrl/Cmd+clicked link. */
export function tablePreview(open: (href: string) => void): Extension {
  const build = (tables: TableSpec[]): TableState => ({
    tables,
    deco: Decoration.set(
      tables.map((t) =>
        Decoration.replace({ widget: new TableWidget(t, open), block: true }).range(t.from, t.to),
      ),
    ),
  })
  const field = StateField.define<TableState>({
    create: (state) => build(findTables(state)),
    update(value, tr) {
      const reparsed = tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)
      return reparsed ? build(findTables(tr.state)) : value
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })
  return [field, keepCursorOut(field)]
}
