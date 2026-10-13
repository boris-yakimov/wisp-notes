import { render } from '@testing-library/react'
import { getCM, Vim } from '@replit/codemirror-vim'
import { createRef } from 'react'
import { useUi } from '../store/ui.ts'
import { Editor, type EditorHandle } from './Editor.tsx'

beforeEach(() => useUi.setState({ quickOpen: false }))

function setup(vimEnabled: boolean) {
  const ref = createRef<EditorHandle>()
  render(<Editor ref={ref} content={'hello'} vimEnabled={vimEnabled} livePreviewEnabled={false} />)
  const view = ref.current!.view()!
  return { view, keys: (ks: string[]) => ks.forEach((k) => Vim.handleKey(getCM(view)!, k, 'user')) }
}

describe('vim \\ff', () => {
  it('opens search from normal mode', () => {
    const { view, keys } = setup(true)
    keys(['\\', 'f', 'f'])
    expect(useUi.getState().quickOpen).toBe(true)
    expect(view.state.doc.toString()).toBe('hello')
  })

  it('does not trigger in insert mode', () => {
    const { keys } = setup(true)
    keys(['i', '\\', 'f', 'f'])
    expect(useUi.getState().quickOpen).toBe(false)
  })
})
