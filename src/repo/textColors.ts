/**
 * Colored text, stored as `<span style="color: green">text</span>` (or red) so other Markdown apps
 * show it too. Only these two exact forms are recognized; the editor styles them with decorations
 * (editor/colors.ts) and never renders them as HTML.
 */

export type TextColor = 'green' | 'red'
export const TEXT_COLORS: readonly TextColor[] = ['green', 'red']

export const OPEN = (c: TextColor) => `<span style="color: ${c}">`
export const CLOSE = '</span>'
const SPAN = /<span style="color:\s*(green|red);?">(.*?)<\/span>/gi

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
