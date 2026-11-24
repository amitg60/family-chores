import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import EmailActionPage from '../EmailActionPage'

const fetchMock = vi.fn()
const reply = (body: unknown) => Promise.resolve({ json: () => Promise.resolve(body) })

function renderAt(search: string) {
  return render(<MemoryRouter initialEntries={[`/email-action${search}`]}><EmailActionPage /></MemoryRouter>)
}

describe('EmailActionPage', () => {
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  it('opening the link only checks status and does not approve', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'pending', action: 'approve' }))
    renderAt('?token=abc')

    expect(await screen.findByRole('button', { name: '✅ אשר' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toBeUndefined() // GET, not POST
  })

  it('approves only after the parent clicks', async () => {
    fetchMock
      .mockReturnValueOnce(reply({ status: 'pending', action: 'approve' }))
      .mockReturnValueOnce(reply({ success: true, action: 'approve' }))
    renderAt('?token=abc')

    await userEvent.click(await screen.findByRole('button', { name: '✅ אשר' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('ההגשה אושרה'))
    expect(fetchMock.mock.calls[1][1]).toEqual({ method: 'POST' })
  })

  it('shows already handled without a button', async () => {
    fetchMock.mockReturnValueOnce(reply({ status: 'already_actioned' }))
    renderAt('?token=abc')
    expect(await screen.findByText(/כבר טופלה/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows an error for an invalid token', async () => {
    fetchMock.mockReturnValueOnce(reply({ error: 'invalid_token' }))
    renderAt('?token=bad')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('shows an error with no token and makes no request', () => {
    renderAt('')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
