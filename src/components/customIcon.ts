/**
 * Uploaded icons are stored inline in `_meta.json` as small PNG data URLs, so they sync and cache
 * like named icons. Only base64 raster data URLs are accepted (no SVG), and the size is capped.
 */

/** Edge length of stored icons (2× the largest displayed size, for sharp HiDPI rendering). */
export const CUSTOM_ICON_SIZE = 64
/** Upper bound for a stored icon (64×64 PNGs are usually 1–8 KB). */
const MAX_DATA_URL_LENGTH = 100_000
/** Larger source files are rejected before decoding. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

const DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/

/** True if `value` is an uploaded icon we are willing to render. */
export function isCustomIcon(value: string | undefined): value is string {
  return !!value && value.length <= MAX_DATA_URL_LENGTH && DATA_URL.test(value)
}

export class IconUploadError extends Error {}

/** Decode an image file and scale it to a square PNG data URL (centered, aspect ratio kept). */
export async function imageFileToIcon(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new IconUploadError('Choose an image file (PNG, JPEG, SVG, …).')
  if (file.size > MAX_UPLOAD_BYTES) throw new IconUploadError('The image is too large (max 5 MB).')
  // A data: URL rather than a blob: URL: the CSP allows `img-src 'self' data:` only.
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new IconUploadError('This image could not be read.'))
    reader.readAsDataURL(file)
  })
  const img = new Image()
  img.src = source
  try {
    await img.decode()
  } catch {
    throw new IconUploadError('This image could not be read.')
  }
  const w = img.naturalWidth || CUSTOM_ICON_SIZE
  const h = img.naturalHeight || CUSTOM_ICON_SIZE
  const scale = CUSTOM_ICON_SIZE / Math.max(w, h)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = CUSTOM_ICON_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new IconUploadError('This browser cannot process images.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(
    img,
    (CUSTOM_ICON_SIZE - w * scale) / 2,
    (CUSTOM_ICON_SIZE - h * scale) / 2,
    w * scale,
    h * scale,
  )
  const data = canvas.toDataURL('image/png')
  if (!isCustomIcon(data)) throw new IconUploadError('This image could not be converted.')
  return data
}
