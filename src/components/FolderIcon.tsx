import { FileText, Folder, FolderOpen } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic'
import { isCustomIcon } from './customIcon.ts'
import { isIconName } from './icons.ts'
import { logoOf } from './logos.ts'

interface Props {
  name: string | undefined
  open?: boolean
  /** Note icon: falls back to a page icon instead of a folder. */
  note?: boolean
  size?: number
  className?: string
}

/**
 * Uploaded image (data URL), brand logo (`logo:<id>`) or Lucide icon by name, loaded lazily (one small
 * chunk or file per icon). Falls back to a folder (or page) icon.
 */
export function FolderIcon({ name, open = false, note = false, size = 16, className }: Props) {
  const Fallback = note ? FileText : open ? FolderOpen : Folder
  const logo = logoOf(name)
  if (logo)
    return (
      <img
        src={logo.url}
        alt=""
        width={size}
        height={size}
        className={`${className ?? ''} object-contain`}
        aria-hidden
        data-icon={name}
        data-logo-dark={logo.dark ? '' : undefined}
        draggable={false}
      />
    )
  if (isCustomIcon(name))
    return (
      <img
        src={name}
        alt=""
        width={size}
        height={size}
        className={`${className ?? ''} rounded-sm object-contain`}
        aria-hidden
        data-icon="custom"
        draggable={false}
      />
    )
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
