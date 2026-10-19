import type { MarkdownConfig } from '@lezer/markdown'

/**
 * A line of one or two dashes under a sentence is, in standard Markdown, a setext heading underline:
 * typing "-" to start a bullet would turn the sentence above into a heading until text follows.
 * This makes such a line end the paragraph instead, so it starts a list item. `---` (and `===`)
 * under text still make a heading, as in CommonMark.
 */
export const dashStartsList: MarkdownConfig = {
  parseBlock: [
    {
      name: 'DashListStart',
      endLeaf: (_cx, line) =>
        line.next === 45 /* '-' */ &&
        line.indent < line.baseIndent + 4 &&
        /^-{1,2}[ \t]*$/.test(line.text.slice(line.pos)),
    },
  ],
}
