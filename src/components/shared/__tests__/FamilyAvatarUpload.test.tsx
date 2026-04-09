import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '../../../test/mocks/supabase'
import { mockFrom, mockStorageFrom } from '../../../test/mocks/supabase'
import type { Family } from '../../../types/database'

vi.mock('browser-image-compression', () => ({
  default: vi.fn().mockImplementation((file: File) => Promise.resolve(file)),
}))

const fakeFamily: Family = {
  id: 'fam1',
  name: 'משפחת כהן',
  team_name: 'כהן השולטים',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
}

function makeFile(name: string, type: string, sizeBytes: number): File {
  const buf = new ArrayBuffer(sizeBytes)
  return new File([buf], name, { type })
}

import FamilyAvatarUpload from '../FamilyAvatarUpload'

describe('FamilyAvatarUpload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders avatar and upload button', () => {
    render(<FamilyAvatarUpload family={fakeFamily} />)
    expect(screen.getByRole('button', { name: /שנה תמונה/i })).toBeInTheDocument()
  })

  it('shows error for unsupported file type', async () => {
    render(<FamilyAvatarUpload family={fakeFamily} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeFile('photo.gif', 'image/gif', 1000)
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('סוג קובץ לא נתמך')
    })
  })

  it('shows error for file over 5MB', async () => {
    render(<FamilyAvatarUpload family={fakeFamily} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeFile('big.jpg', 'image/jpeg', 6 * 1024 * 1024)
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('הקובץ גדול מדי')
    })
  })

  it('uploads file and calls onUploaded with public URL', async () => {
    const onUploaded = vi.fn()

    const storageObj = {
      upload: vi.fn().mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/fam1/avatar.jpg' } }),
    }
    mockStorageFrom.mockReturnValue(storageObj)

    mockFrom.mockReturnValueOnce({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    })

    render(<FamilyAvatarUpload family={fakeFamily} onUploaded={onUploaded} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeFile('photo.jpg', 'image/jpeg', 100_000)
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(onUploaded).toHaveBeenCalledWith('https://cdn.example.com/fam1/avatar.jpg')
    })
  })
})
