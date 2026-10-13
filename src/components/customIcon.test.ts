import { imageFileToIcon, isCustomIcon } from './customIcon.ts'

describe('custom icons', () => {
  it('accepts only small base64 raster data URLs', () => {
    expect(isCustomIcon('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(isCustomIcon('data:image/webp;base64,UklGRg==')).toBe(true)
    expect(isCustomIcon('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isCustomIcon('data:image/png,<svg onload=x>')).toBe(false)
    expect(isCustomIcon('https://example.com/a.png')).toBe(false)
    expect(isCustomIcon('star')).toBe(false)
    expect(isCustomIcon(undefined)).toBe(false)
    expect(isCustomIcon('data:image/png;base64,' + 'A'.repeat(100_000))).toBe(false)
  })

  it('rejects non-images and huge files before decoding', async () => {
    await expect(imageFileToIcon(new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toThrow(
      'Choose an image file',
    )
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' })
    await expect(imageFileToIcon(big)).rejects.toThrow('too large')
  })
})
