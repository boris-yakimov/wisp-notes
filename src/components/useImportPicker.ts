import { useCallback } from 'react'
import type { ImportFile } from '../repo/ops.ts'
import { useTreeActions } from './useTreeActions.ts'

const TEXT_EXT = /\.(md|markdown|txt|json|csv)$/i

/** Read picked files: text files as strings (searchable, cached), everything else as binary. */
export async function readPickedFiles(files: File[]): Promise<ImportFile[]> {
  return Promise.all(
    files.map(async (f) => ({
      relativePath: f.webkitRelativePath || f.name,
      content: TEXT_EXT.test(f.name) ? await f.text() : f,
    })),
  )
}

/**
 * Opens the browser's file/folder picker and imports the selection into a folder.
 * Must be called from a click handler (browsers require a user gesture for pickers).
 */
export function useImportPicker() {
  const { importFiles } = useTreeActions()
  return useCallback(
    (folder: string, mode: 'files' | 'folder') => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      if (mode === 'folder') input.webkitdirectory = true
      input.onchange = async () => {
        const files = [...(input.files ?? [])]
        if (files.length) await importFiles(folder, await readPickedFiles(files))
      }
      input.click()
    },
    [importFiles],
  )
}
