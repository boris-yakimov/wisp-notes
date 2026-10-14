import { syntaxTree } from '@codemirror/language'
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

/** Object URL for an image written in the note (`src` as written), or null if it can't be shown. */
export type ImageResolver = (src: string) => Promise<string> | null

export interface ImageSpec {
  from: number
  to: number
  src: string
  alt: string
  /** Replace the Markdown with the image (live preview, cursor elsewhere) or show it after the text. */
  replace: boolean
}

/** Images (`![alt](src)`) in the given ranges. Pure: depends only on state + ranges. */
export function findImages(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  hideSyntax: boolean,
  focused = true,
): ImageSpec[] {
  const out: ImageSpec[] = []
  const doc = state.doc
  const activeLines = new Set<number>()
  if (focused)
    for (const r of state.selection.ranges)
      for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) activeLines.add(n)
  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'Image') return
        const url = node.node.getChild('URL')
        if (!url) return false
        const marks = node.node.getChildren('LinkMark')
        const altEnd = marks[1]?.from ?? node.from + 2
        out.push({
          from: node.from,
          to: node.to,
          src: doc.sliceString(url.from, url.to),
          alt: doc.sliceString(node.from + 2, altEnd),
          replace: hideSyntax && !activeLines.has(doc.lineAt(node.from).number),
        })
        return false
      },
    })
  }
  return out
}

class ImageWidget extends WidgetType {
  readonly src: string
  readonly alt: string
  readonly resolve: ImageResolver
  constructor(src: string, alt: string, resolve: ImageResolver) {
    super()
    this.src = src
    this.alt = alt
    this.resolve = resolve
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt
  }
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-image'
    const img = document.createElement('img')
    img.alt = this.alt || this.src
    img.draggable = false
    const url = this.resolve(this.src)
    if (url) {
      void url.then(
        (u) => (img.src = u),
        () => this.fail(wrap),
      )
      img.onerror = () => this.fail(wrap)
      wrap.append(img)
    } else this.fail(wrap)
    return wrap
  }
  private fail(wrap: HTMLElement) {
    wrap.replaceChildren(`🖼 ${this.alt || this.src} (image not available)`)
    wrap.classList.add('cm-image-missing')
  }
  ignoreEvent() {
    return false
  }
}

/**
 * Show images inline. With live preview, the `![…](…)` text is replaced by the image except on the
 * cursor's line; otherwise the image appears after the text.
 */
export function inlineImages(resolve: ImageResolver, hideSyntax: boolean): Extension {
  const build = (view: EditorView): DecorationSet => {
    const b = new RangeSetBuilder<Decoration>()
    for (const img of findImages(view.state, view.visibleRanges, hideSyntax, view.hasFocus)) {
      const widget = new ImageWidget(img.src, img.alt, resolve)
      if (img.replace) b.add(img.from, img.to, Decoration.replace({ widget }))
      else b.add(img.to, img.to, Decoration.widget({ widget, side: 1 }))
    }
    return b.finish()
  }
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.selectionSet ||
          u.focusChanged ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        )
          this.decorations = build(u.view)
      }
    },
    { decorations: (v) => v.decorations },
  )
}
