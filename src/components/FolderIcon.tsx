import { FileText, Folder, FolderOpen } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic'
import { isIconName } from './icons.ts'

interface Props {
  name: string | undefined
  open?: boolean
  /** Note icon: falls back to a page icon instead of a folder. */
  note?: boolean
  size?: number
  className?: string
}

/** Lucide icon by name, loaded lazily (one small chunk per icon). Falls back to a folder (or page) icon. */
export function FolderIcon({ name, open = false, note = false, size = 16, className }: Props) {
  const Fallback = note ? FileText : open ? FolderOpen : Folder
  if (!isIconName(name))
    return <Fallback size={size} className={className} aria-hidden data-icon={note ? 'note' : 'folder'} />
  return (
    <DynamicIcon
      name={name}
      size={size}
      className={className}
      aria-hidden
      data-icon={name}
      fallback={() => <span style={{ width: size, height: size }} className="inline-block" />}
    />
  )
}
