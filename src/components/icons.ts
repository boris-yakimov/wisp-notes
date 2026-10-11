import { iconNames, type IconName } from 'lucide-react/dynamic'

const valid = new Set<string>(iconNames)

/** True if `name` is a known Lucide icon name (as stored in `_meta.json`). */
export function isIconName(name: string | undefined): name is IconName {
  return !!name && valid.has(name)
}
