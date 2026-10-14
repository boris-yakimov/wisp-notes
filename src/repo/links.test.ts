import { resolveLink } from './links.ts'

describe('resolveLink', () => {
  const from = 'Work/Plan.md'

  it('keeps http(s) and mailto links external', () => {
    expect(resolveLink('https://example.com/a?b#c', from)).toEqual({
      kind: 'external',
      url: 'https://example.com/a?b#c',
    })
    expect(resolveLink('mailto:me@example.com', from)).toEqual({
      kind: 'external',
      url: 'mailto:me@example.com',
    })
    expect(resolveLink('www.example.com', from)).toEqual({ kind: 'external', url: 'https://www.example.com' })
    expect(resolveLink('me@example.com', from)).toEqual({ kind: 'external', url: 'mailto:me@example.com' })
  })

  it('refuses other schemes', () => {
    expect(resolveLink('javascript:alert(1)', from)).toBeNull()
    expect(resolveLink('JavaScript:alert(1)', from)).toBeNull()
    expect(resolveLink('data:text/html,x', from)).toBeNull()
    expect(resolveLink('//evil.example/x.md', from)).toBeNull()
  })

  it('resolves relative note links against the note folder (Notion export style)', () => {
    expect(resolveLink('Plan/Tasks%20abc123.md', from)).toEqual({
      kind: 'note',
      path: 'Work/Plan/Tasks abc123.md',
    })
    expect(resolveLink('./Other.md#heading', from)).toEqual({ kind: 'note', path: 'Work/Other.md' })
    expect(resolveLink('../Inbox.md', from)).toEqual({ kind: 'note', path: 'Inbox.md' })
    expect(resolveLink('/Inbox.md', from)).toEqual({ kind: 'note', path: 'Inbox.md' })
  })

  it('ignores non-note files and paths outside the repo', () => {
    expect(resolveLink('image.png', from)).toBeNull()
    expect(resolveLink('../../x.md', from)).toBeNull()
    expect(resolveLink('', from)).toBeNull()
  })

  it('treats an encoded slash as part of a note name', () => {
    expect(resolveLink('CI%2FCD.md', from)).toEqual({ kind: 'note', path: 'Work/CI\uE000CD.md' })
    expect(resolveLink('../Ops/CI%2FCD.md', from)).toEqual({ kind: 'note', path: 'Ops/CI\uE000CD.md' })
  })
})
