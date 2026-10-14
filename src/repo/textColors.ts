/**
 * Colored text, stored as `<span style="color: green">text</span>` (or another of TEXT_COLORS) so other Markdown
 * apps show it too. Only these exact forms are recognized; the editor styles them with decorations
 * (editor/colors.ts) and never renders them as HTML.
 */

/** In toolbar order. Each needs a `--md-<color>` CSS variable per theme (index.css). */
export const TEXT_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const
export type TextColor = (typeof TEXT_COLORS)[number]

export const OPEN = (c: TextColor) => `<span style="color: ${c}">`
export const CLOSE = '</span>'
/** Source of the span pattern: group 1 is the color, group 2 the text. Also used by editor/tables.ts. */
export const COLOR_SPAN_SOURCE = `<span style="color:\\s*(${TEXT_COLORS.join('|')});?">(.*?)<\\/span>`
const SPAN = new RegExp(COLOR_SPAN_SOURCE, 'gi')

export interface ColorSpan {
  /** Whole span including tags. */
  from: number
  to: number
  /** Text between the tags. */
  textFrom: number
  textTo: number
  color: TextColor
}

/** Colored spans in `text` (one line), with positions offset by `offset`. */
export function findColorSpans(text: string, offset = 0): ColorSpan[] {
  const out: ColorSpan[] = []
  for (const m of text.matchAll(SPAN)) {
    const from = offset + m.index
    const openLen = m[0].length - m[2]!.length - CLOSE.length
    out.push({
      from,
      to: from + m[0].length,
      textFrom: from + openLen,
      textTo: from + openLen + m[2]!.length,
      color: m[1]!.toLowerCase() as TextColor,
    })
  }
  return out
}

/** Text without color tags (search index, snippets). */
export function stripColors(text: string): string {
  return text.replace(SPAN, '$2')
}
