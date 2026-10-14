import { syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  EditorState,
  StateField,
  Transaction,
  type Extension,
  type Range,
} from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

/**
 * Live preview of GFM tables: a table is drawn as a grid unless the cursor is on one of its lines,
 * where it shows as Markdown for editing. Cells are rendered as DOM text (never as HTML), with links,
 * bold, italic, strikethrough and inline code. Ctrl/Cmd+click on a link in a cell opens it.
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
}

/** Cell texts of a header/body row, split at the parser's `|` delimiters (empty cells included). */
function rowCells(state: EditorState, row: SyntaxNode): string[] {
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
  return segments.map(([a, b]) => state.sliceDoc(a, b).trim().replace(/\\\|/g, '|'))
}

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
      out.push({
        from: first.from,
        to: last.to,
        startLine: first.number,
        endLine: last.number,
        header: rowCells(state, head),
        align: delimRow ? alignments(state.sliceDoc(delimRow.from, delimRow.to)) : [],
        rows: t.getChildren('TableRow').map((r) => rowCells(state, r)),
      })
      return false
    },
  })
  return out
}

/** Is the cursor (any selection range) on one of the table's lines? Then it is shown as Markdown. */
export function isEditing(state: EditorState, t: TableSpec): boolean {
  return state.selection.ranges.some((r) => r.from <= t.to && r.to >= t.from)
}

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
      re: /<span style="color:\s*(green|red);?">(.*?)<\/span>/i,
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

// ---------------------------------------------------------------- widget + extension

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
  toDOM() {
    const wrapEl = document.createElement('div')
    wrapEl.className = 'cm-table-wrap'
    const table = document.createElement('table')
    table.className = 'cm-table'
    const cols = Math.max(this.t.header.length, ...this.t.rows.map((r) => r.length))
    const row = (cells: string[], tag: 'th' | 'td') => {
      const tr = document.createElement('tr')
      for (let i = 0; i < cols; i++) {
        const c = document.createElement(tag)
        const a = this.t.align[i]
        if (a) c.style.textAlign = a
        c.append(renderInline(cells[i] ?? ''))
        tr.append(c)
      }
      return tr
    }
    const thead = document.createElement('thead')
    thead.append(row(this.t.header, 'th'))
    const tbody = document.createElement('tbody')
    for (const r of this.t.rows) tbody.append(row(r, 'td'))
    table.append(thead, tbody)
    wrapEl.append(table)
    // Ctrl/Cmd+click on a link opens it; a plain click falls through to the editor, which puts
    // the cursor into the table (shown as Markdown then).
    wrapEl.addEventListener('mousedown', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>('.cm-table-link')
      if (!target || e.button !== 0 || !(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      e.stopPropagation()
      this.open(target.dataset.href!)
    })
    return wrapEl
  }
  ignoreEvent() {
    return false
  }
}

interface TableState {
  tables: TableSpec[]
  /** Tables currently drawn as grids (cursor elsewhere). */
  shown: TableSpec[]
  deco: DecorationSet
}

/**
 * Arrow keys move over a drawn table as one block. When the cursor would jump from the line right
 * above a table to below it (or the reverse), put it on the table's first (last) line instead, so the
 * table opens for editing, as it does with vim's j/k.
 */
function enterTables(field: StateField<TableState>) {
  return EditorState.transactionFilter.of((tr) => {
    if (tr.docChanged || !tr.selection || tr.isUserEvent('select.pointer')) return tr
    const sel = tr.selection
    const old = tr.startState.selection.main
    if (sel.ranges.length !== 1 || !sel.main.empty || !old.empty) return tr
    const doc = tr.startState.doc
    const oldLine = doc.lineAt(old.head)
    const newLine = doc.lineAt(sel.main.head).number
    const col = old.head - oldLine.from
    for (const t of tr.startState.field(field, false)?.shown ?? []) {
      let line: number | null = null
      if (oldLine.number === t.startLine - 1 && newLine > t.endLine) line = t.startLine
      else if (oldLine.number === t.endLine + 1 && newLine < t.startLine) line = t.endLine
      if (line === null) continue
      const l = doc.line(line)
      return {
        selection: EditorSelection.cursor(l.from + Math.min(col, l.length)),
        effects: tr.effects,
        scrollIntoView: tr.scrollIntoView,
        annotations: Transaction.userEvent.of(tr.annotation(Transaction.userEvent) ?? 'select'),
      }
    }
    return tr
  })
}

/** Table preview (part of live preview). `open` receives the href of a Ctrl/Cmd+clicked link. */
export function tablePreview(open: (href: string) => void): Extension {
  const build = (state: EditorState, tables: TableSpec[]): TableState => {
    const shown = tables.filter((t) => !isEditing(state, t))
    const ranges: Range<Decoration>[] = shown.map((t) =>
      Decoration.replace({ widget: new TableWidget(t, open), block: true }).range(t.from, t.to),
    )
    return { tables, shown, deco: Decoration.set(ranges) }
  }
  const field = StateField.define<TableState>({
    create: (state) => build(state, findTables(state)),
    update(value, tr) {
      const reparsed = tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state)
      if (!reparsed && !tr.selection) return value
      return build(tr.state, reparsed ? findTables(tr.state) : value.tables)
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })
  return [field, enterTables(field)]
}
