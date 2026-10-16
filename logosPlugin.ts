import type { Plugin } from 'vite'
import { LOGO_LIST } from './src/components/logoList.ts'

const ID = 'virtual:logo-urls'
const RESOLVED = '\0' + ID

/**
 * `virtual:logo-urls`: id → URL of each logo in `LOGO_LIST`, imported from the `devicon` package so
 * only these SVGs end up in the build (as separate files, loaded when shown). Nothing is vendored.
 */
export function logosPlugin(): Plugin {
  return {
    name: 'wisp-logos',
    resolveId(id) {
      return id === ID ? RESOLVED : undefined
    },
    load(id) {
      if (id !== RESOLVED) return undefined
      const lines = LOGO_LIST.map((l, i) => `import u${i} from 'devicon/icons/${l.file}?url'`)
      const map = LOGO_LIST.map((l, i) => `  ${JSON.stringify(l.id)}: u${i},`)
      return `${lines.join('\n')}\nexport default {\n${map.join('\n')}\n}\n`
    },
  }
}

/** Keep logos out of the JS bundle (Vite would inline small files as data: URLs). */
export const inlineLimit = (file: string): boolean | undefined =>
  file.includes('/devicon/') ? false : undefined
