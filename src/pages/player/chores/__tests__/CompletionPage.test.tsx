import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '../../../../test/mocks/supabase'
import { mockFrom, mockRpc, mockStorageFrom } from '../../../../test/mocks/supabase'

vi.mock('../../../../lib/photoUtils', () => ({
  compressPhoto: vi.fn(async (f: File) => f),
}))

let mockTrustLevel = 1
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'p1', family_id: 'f1', trust_level: mockTrustLevel } }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

import CompletionPage from '../CompletionPage'

function renderPage(assignmentId = 'a1') {
  return render(
    <MemoryRouter initialEntries={[`/player/chores/${assignmentId}/complete`]}>
      <Routes>
        <Route path="/player/chores/:assignmentId/complete" element={<CompletionPage />} />
      </Routes>
    </MemoryRouter>
  )
}

// Returns a mock for: supabase.storage.from('completion-photos')
function makeStorageMock(uploadResult: unknown) {
  return {
    upload: vi.fn().mockResolvedValue(uploadResult),
    createSignedUrl: vi.fn(),
    remove: vi.fn(),
  }
}

// Returns a mock for the insert().select().single() chain
function makeInsertChain(resolvedValue: unknown) {
  const chain: Record<string, unknown> = {}
  chain.insert = vi.fn().mockReturnValue(chain)
  chain.select = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue(resolvedValue)
  return chain
}

describe('CompletionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTrustLevel = 1
  })

  it('renders file input and disabled submit button', () => {
    renderPage()
    expect(screen.getByLabelText('תמונת הוכחה')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שלח הוכחה' })).toBeDisabled()
  })

  it('enables submit button after file is selected', async () => {
    renderPage()
    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('תמונת הוכחה'), file)
    expect(screen.getByRole('button', { name: 'שלח הוכחה' })).toBeEnabled()
  })

  it('uploads photo, creates completion record, and navigates to /player', async () => {
    mockStorageFrom.mockReturnValue(makeStorageMock({ error: null }))
    mockFrom.mockReturnValue(makeInsertChain({ data: { id: 'comp1' }, error: null }))
    renderPage()

    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('תמונת הוכחה'), file)
    await userEvent.click(screen.getByRole('button', { name: 'שלח הוכחה' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/player'))
  })

  it('shows error when photo upload fails', async () => {
    mockStorageFrom.mockReturnValue(makeStorageMock({ error: { message: 'upload failed' } }))
    renderPage()

    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('תמונת הוכחה'), file)
    await userEvent.click(screen.getByRole('button', { name: 'שלח הוכחה' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בהעלאת התמונה')
    )
  })

  it('shows error when insert fails', async () => {
    mockStorageFrom.mockReturnValue(makeStorageMock({ error: null }))
    mockFrom.mockReturnValue(makeInsertChain({ data: null, error: { message: 'db error' } }))
    renderPage()

    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('תמונת הוכחה'), file)
    await userEvent.click(screen.getByRole('button', { name: 'שלח הוכחה' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('שגיאה בשמירת ההשלמה')
    )
  })

  it('calls approve_completion RPC for trust level 4+ players', async () => {
    mockTrustLevel = 4
    mockStorageFrom.mockReturnValue(makeStorageMock({ error: null }))
    mockFrom.mockReturnValue(makeInsertChain({ data: { id: 'comp1' }, error: null }))
    mockRpc.mockResolvedValue({ error: null })
    renderPage()

    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('תמונת הוכחה'), file)
    await userEvent.click(screen.getByRole('button', { name: 'שלח הוכחה' }))

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('approve_completion', { completion_id: 'comp1' })
    )
  })

  it('does NOT call approve_completion RPC for trust level 1 players', async () => {
    mockTrustLevel = 1
    mockStorageFrom.mockReturnValue(makeStorageMock({ error: null }))
    mockFrom.mockReturnValue(makeInsertChain({ data: { id: 'comp1' }, error: null }))
    renderPage()

    const file = new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('תמונת הוכחה'), file)
    await userEvent.click(screen.getByRole('button', { name: 'שלח הוכחה' }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/player'))
    expect(mockRpc).not.toHaveBeenCalled()
  })
})
