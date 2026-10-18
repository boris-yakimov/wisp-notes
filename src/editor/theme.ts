import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import { TEXT_COLORS } from '../repo/textColors.ts'

/** Markdown highlighting used in both raw and live-preview modes. */
export const markdownHighlight = syntaxHighlighting(
  HighlightStyle.define([
    {
      tag: t.heading1,
      fontSize: '1.6em',
      fontWeight: '700',
      color: 'var(--md-heading)',
      textShadow: 'var(--md-glow)',
    },
    {
      tag: t.heading2,
      fontSize: '1.35em',
      fontWeight: '700',
      color: 'var(--md-heading)',
      textShadow: 'var(--md-glow)',
    },
    {
      tag: t.heading3,
      fontSize: '1.15em',
      fontWeight: '600',
      color: 'var(--md-heading)',
      textShadow: 'var(--md-glow)',
    },
    {
      tag: [t.heading4, t.heading5, t.heading6],
      fontWeight: '600',
      color: 'var(--md-heading)',
      textShadow: 'var(--md-glow)',
    },
    { tag: t.strong, fontWeight: '700' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.link, color: 'var(--md-link)', textDecoration: 'underline' },
    { tag: t.url, color: 'var(--md-muted)' },
    {
      tag: t.monospace,
      fontFamily: 'var(--mono-font)',
      fontSize: '0.9em',
      backgroundColor: 'var(--md-code-bg)',
      borderRadius: '3px',
    },
    { tag: t.quote, color: 'var(--md-quote)' },
    { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: 'var(--md-syntax)' },
    { tag: t.keyword, color: 'var(--md-keyword)' },
    // Keys in YAML/JSON/TOML code blocks
    { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--md-link)' },
    { tag: t.string, color: 'var(--md-string)' },
    { tag: t.comment, color: 'var(--md-comment)', fontStyle: 'italic' },
    { tag: [t.number, t.bool], color: 'var(--md-number)' },
  ]),
)

export const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '16px' },
  '&.cm-focused': { outline: 'none' },
  '&, & .cm-content': { caretColor: 'var(--md-cursor)' },
  // `.cm-cursorLayer` adds specificity over the vim plugin's own (higher-precedence) theme.
  '.cm-cursorLayer .cm-fat-cursor': { background: 'var(--md-vim-cursor)' },
  '&:not(.cm-focused) .cm-cursorLayer .cm-fat-cursor': {
    background: 'none',
    outline: 'solid 1px var(--md-vim-cursor)',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--md-cursor)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, & ::selection':
    { backgroundColor: 'var(--md-selection)' },
  '.cm-scroller': {
    fontFamily: 'var(--app-font)',
    lineHeight: '1.65',
  },
  '.cm-content': { maxWidth: '46rem', margin: '0 auto', padding: '24px 20px 40vh' },
  '.cm-line': { padding: '0 2px' },
  '.cm-lp-codeblock, .cm-lp-codeblock *': {
    fontFamily: 'var(--mono-font)',
    fontSize: '0.9em',
  },
  // Notion-style block: text inset from the background's edges, rounded corners.
  // Padding (not margin) so CodeMirror's line-height measurement stays correct.
  '.cm-line.cm-lp-codeblock': { backgroundColor: 'var(--md-code-bg)', padding: '0 16px 0 20px' },
  '.cm-line.cm-lp-codeblock-first': {
    paddingTop: '12px',
    borderTopLeftRadius: '6px',
    borderTopRightRadius: '6px',
  },
  '.cm-line.cm-lp-codeblock-last': {
    paddingBottom: '12px',
    borderBottomLeftRadius: '6px',
    borderBottomRightRadius: '6px',
  },
  // `[…]` that isn't a link (e.g. `argv[0]`): plain text, not link-styled (see links.ts).
  '.cm-nolink, .cm-nolink *': { color: 'inherit', textDecoration: 'none' },
  '.cm-lp-quote': { borderLeft: '3px solid var(--md-rule)', paddingLeft: '12px', color: 'var(--md-quote)' },
  '.cm-lp-hr': { borderBottom: '1px solid var(--md-rule)' },
  '.cm-lp-h1, .cm-lp-h2': { paddingTop: '0.4em' },
  '.cm-lp-bullet': { color: 'var(--md-bullet)', padding: '0 0.25em' },
  '.cm-lp-task': {
    margin: '0 0.35em 0 0',
    verticalAlign: 'middle',
    cursor: 'pointer',
    width: '1em',
    height: '1em',
  },
  '.cm-image': { display: 'inline-block', maxWidth: '100%', verticalAlign: 'top', margin: '4px 0' },
  '.cm-image img': {
    display: 'block',
    maxWidth: '100%',
    maxHeight: '70vh',
    borderRadius: '4px',
    border: '1px solid var(--md-rule)',
  },
  '.cm-image-missing': { color: 'var(--md-muted)', fontSize: '0.9em' },
  '.cm-table-wrap': { overflowX: 'auto', margin: '6px 0' },
  '.cm-table': { borderCollapse: 'collapse', fontSize: '0.92em', lineHeight: '1.45' },
  '.cm-table th, .cm-table td': {
    border: '1px solid var(--md-rule)',
    padding: '4px 10px',
    verticalAlign: 'top',
    textAlign: 'left',
    // CodeMirror's content wraps anywhere; in cells, wrap only at spaces (wide tables scroll instead).
    whiteSpace: 'normal',
    overflowWrap: 'normal',
    wordBreak: 'normal',
    minWidth: '4ch',
    maxWidth: '28rem',
  },
  '.cm-table th': { backgroundColor: 'var(--md-code-bg)', fontWeight: '600' },
  '.cm-table code': { fontFamily: 'var(--mono-font)', fontSize: '0.9em' },
  '.cm-table-link': { color: 'var(--md-link)', textDecoration: 'underline' },
  ...Object.fromEntries(TEXT_COLORS.map((c) => [`.cm-color-${c}`, { color: `var(--md-${c})` }])),
  '.cm-tooltip.cm-color-toolbar': {
    display: 'flex',
    flexWrap: 'wrap', // phones: wrap instead of running off the screen
    maxWidth: 'calc(100vw - 16px)',
    gap: '2px',
    padding: '3px',
    borderRadius: '6px',
    border: '1px solid var(--md-rule)',
    backgroundColor: 'var(--md-code-bg)',
    fontFamily: 'var(--app-font)',
    fontSize: '13px',
  },
  '.cm-color-btn': {
    border: 'none',
    background: 'none',
    font: 'inherit',
    fontWeight: '600',
    padding: '2px 8px',
    borderRadius: '4px',
    cursor: 'pointer',
    color: 'var(--md-muted)',
  },
  '.cm-format-sep': { width: '1px', margin: '2px 3px', backgroundColor: 'var(--md-rule)' },
  '.cm-format-code': { fontFamily: 'var(--mono-font)', fontWeight: '500', color: 'inherit' },
  '.cm-color-btn:hover, .cm-color-btn:focus-visible': { backgroundColor: 'var(--md-selection)' },
  ...Object.fromEntries(TEXT_COLORS.map((c) => [`.cm-color-btn.cm-color-${c}`, { color: `var(--md-${c})` }])),
  '.cm-panels': { fontFamily: 'ui-monospace, monospace', fontSize: '14px' },
  '.cm-vim-panel input': { fontFamily: 'ui-monospace, monospace' },
})
