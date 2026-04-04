import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('browser-image-compression', () => ({
  default: vi.fn(async (file: File) => new File([file], 'compressed.webp', { type: 'image/webp' })),
}))

import imageCompression from 'browser-image-compression'
import { compressPhoto } from '../photoUtils'

describe('compressPhoto', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls imageCompression with the correct options', async () => {
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' })
    await compressPhoto(file)
    expect(imageCompression).toHaveBeenCalledWith(file, expect.objectContaining({
      maxSizeMB: 0.2,
      maxWidthOrHeight: 1280,
      fileType: 'image/webp',
      initialQuality: 0.75,
    }))
  })

  it('returns the compressed file', async () => {
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressPhoto(file)
    expect(result).toBeInstanceOf(File)
    expect(result.type).toBe('image/webp')
  })
})
