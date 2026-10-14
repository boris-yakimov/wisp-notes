import { useCallback } from 'react'
import type { ImportFile } from '../repo/ops.ts'
import { useTreeActions } from './useTreeActions.ts'

const TEXT_EXT = /\.(md|markdown|txt|json|csv)$/i

/**
 * Read picked files: text files as strings (searchable, cached), everything else as binary.
 * `dropTop` removes the picked folder's own name, so only its contents are imported.
 */
export async function readPickedFiles(files: File[], dropTop = false): Promise<ImportFile[]> {
  return Promise.all(
    files.map(async (f) => ({
      relativePath: dropTop
        ? (f.webkitRelativePath || f.name).replace(/^[^/]+\/(?=.)/, '')
        : f.webkitRelativePath || f.name,
      content: TEXT_EXT.test(f.name) ? await f.text() : f,
    })),
  )
}

/**
 * Opens the browser's file/folder picker and imports the selection into a folder.
 * `contents`: pick a folder and import what's inside it (used for a note's sub-notes).
 * Must be called from a click handler (browsers require a user gesture for pickers).
 */
export function useImportPicker() {
  const { importFiles } = useTreeActions()
  return useCallback(
    (folder: string, mode: 'files' | 'folder' | 'contents') => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      if (mode !== 'files') input.webkitdirectory = true
      input.onchange = async () => {
        const files = [...(input.files ?? [])]
        if (files.length) await importFiles(folder, await readPickedFiles(files, mode === 'contents'))
      }
      input.click()
    },
    [importFiles],
  )
}
