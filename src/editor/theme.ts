import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/** Markdown highlighting used in both raw and live-preview modes. */
export const markdownHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading1, fontSize: '1.6em', fontWeight: '700' },
    { tag: t.heading2, fontSize: '1.35em', fontWeight: '700' },
    { tag: t.heading3, fontSize: '1.15em', fontWeight: '600' },
    { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600' },
    { tag: t.strong, fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.link, color: '#4f46e5', textDecoration: 'underline' },
    { tag: t.url, color: '#6b7280' },
    { tag: t.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.9em' },
    { tag: t.quote, color: '#525252' },
    { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: '#a3a3a3' },
    { tag: t.keyword, color: '#7c3aed' },
    { tag: t.string, color: '#15803d' },
    { tag: t.comment, color: '#9ca3af', fontStyle: 'italic' },
    { tag: [t.number, t.bool], color: '#b45309' },
  ]),
)

export const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '16px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    lineHeight: '1.65',
  },
  '.cm-content': { maxWidth: '46rem', margin: '0 auto', padding: '24px 20px 40vh' },
  '.cm-line': { padding: '0 2px' },
  '.cm-lp-codeblock, .cm-lp-codeblock *': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.9em',
  },
  '.cm-lp-codeblock': { backgroundColor: '#f5f5f5' },
  '.cm-lp-quote': { borderLeft: '3px solid #d4d4d4', paddingLeft: '12px', color: '#525252' },
  '.cm-lp-hr': { borderBottom: '1px solid #d4d4d4' },
  '.cm-lp-h1, .cm-lp-h2': { paddingTop: '0.4em' },
  '.cm-lp-bullet': { color: '#737373', padding: '0 0.25em' },
  '.cm-lp-task': {
    margin: '0 0.35em 0 0',
    verticalAlign: 'middle',
    cursor: 'pointer',
    width: '1em',
    height: '1em',
  },
  '.cm-panels': { fontFamily: 'ui-monospace, monospace', fontSize: '14px' },
  '.cm-vim-panel input': { fontFamily: 'ui-monospace, monospace' },
})
