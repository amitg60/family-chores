import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import InviteDialog from '../InviteDialog'

// qrcode.react renders a canvas/svg — stub it in tests
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <div data-testid="qrcode">{value}</div>,
}))

const mockGenerateInvite = vi.fn()
const mockShare = vi.fn()

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  generateInvite: mockGenerateInvite,
}

describe('InviteDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Stub window.location.origin used when VITE_APP_URL is undefined
    Object.defineProperty(window, 'location', {
      value: { origin: 'http://localhost:5173' },
      writable: true,
    })
    // Remove navigator.share by default (desktop fallback)
    Object.defineProperty(navigator, 'share', { value: undefined, writable: true, configurable: true })
  })

  it('renders role selection step with two role cards', () => {
    render(<InviteDialog {...defaultProps} />)
    expect(screen.getByText('שחקן')).toBeInTheDocument()
    expect(screen.getByText('מנהל משותף')).toBeInTheDocument()
    expect(screen.getByText('צור קישור')).toBeInTheDocument()
  })

  it('calls generateInvite with selected role on submit', async () => {
    mockGenerateInvite.mockResolvedValue('tok123')
    render(<InviteDialog {...defaultProps} />)

    fireEvent.click(screen.getByText('צור קישור'))
    expect(mockGenerateInvite).toHaveBeenCalledWith('player')
  })

  it('shows QR code and invite URL after successful generation', async () => {
    mockGenerateInvite.mockResolvedValue('tok123')
    render(<InviteDialog {...defaultProps} />)

    fireEvent.click(screen.getByText('צור קישור'))

    await waitFor(() => {
      expect(screen.getByTestId('qrcode')).toBeInTheDocument()
      expect(screen.getByText(/tok123/)).toBeInTheDocument()
      expect(screen.getByText('הקישור תקף ל-5 שעות')).toBeInTheDocument()
    })
  })

  it('renders admin role option when selected', async () => {
    mockGenerateInvite.mockResolvedValue('admintok')
    render(<InviteDialog {...defaultProps} />)

    fireEvent.click(screen.getByText('מנהל משותף'))
    fireEvent.click(screen.getByText('צור קישור'))

    expect(mockGenerateInvite).toHaveBeenCalledWith('admin')
  })

  it('resets to role step when "צור קישור חדש" is clicked', async () => {
    mockGenerateInvite.mockResolvedValue('tok999')
    render(<InviteDialog {...defaultProps} />)

    fireEvent.click(screen.getByText('צור קישור'))
    await waitFor(() => screen.getByText('צור קישור חדש'))

    fireEvent.click(screen.getByText('צור קישור חדש'))
    expect(screen.getByText('צור קישור')).toBeInTheDocument()
    expect(screen.queryByTestId('qrcode')).not.toBeInTheDocument()
  })

  it('shows error message when generateInvite throws', async () => {
    mockGenerateInvite.mockRejectedValue(new Error('permission denied'))
    render(<InviteDialog {...defaultProps} />)

    fireEvent.click(screen.getByText('צור קישור'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('permission denied')
    })
  })

  describe('share button', () => {
    it('does not show share button when navigator.share is unavailable', async () => {
      mockGenerateInvite.mockResolvedValue('tok123')
      render(<InviteDialog {...defaultProps} />)
      fireEvent.click(screen.getByText('צור קישור'))

      await waitFor(() => screen.getByTestId('qrcode'))

      expect(screen.queryByRole('button', { name: 'שתף קישור' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'העתק קישור' })).toBeInTheDocument()
    })

    it('shows share button when navigator.share is available', async () => {
      Object.defineProperty(navigator, 'share', { value: mockShare, writable: true, configurable: true })
      mockShare.mockResolvedValue(undefined)
      mockGenerateInvite.mockResolvedValue('tok123')
      render(<InviteDialog {...defaultProps} />)
      fireEvent.click(screen.getByText('צור קישור'))

      await waitFor(() => screen.getByRole('button', { name: 'שתף קישור' }))

      expect(screen.getByRole('button', { name: 'שתף קישור' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'העתק קישור' })).toBeInTheDocument()
    })

    it('calls navigator.share with invite URL when share button is clicked', async () => {
      Object.defineProperty(navigator, 'share', { value: mockShare, writable: true, configurable: true })
      mockShare.mockResolvedValue(undefined)
      mockGenerateInvite.mockResolvedValue('tok123')
      render(<InviteDialog {...defaultProps} />)
      fireEvent.click(screen.getByText('צור קישור'))

      await waitFor(() => screen.getByRole('button', { name: 'שתף קישור' }))
      fireEvent.click(screen.getByRole('button', { name: 'שתף קישור' }))

      await waitFor(() => {
        expect(mockShare).toHaveBeenCalledWith({
          title: 'הזמנה למשפחה',
          text: 'לחץ על הקישור כדי להצטרף למשפחה שלנו',
          url: 'http://localhost:5173/join?token=tok123',
        })
      })
    })

    it('silently ignores AbortError when user cancels the share sheet', async () => {
      const consoleSpy = vi.spyOn(console, 'error')
      Object.defineProperty(navigator, 'share', { value: mockShare, writable: true, configurable: true })
      const abortError = new DOMException('Share cancelled', 'AbortError')
      mockShare.mockRejectedValue(abortError)
      mockGenerateInvite.mockResolvedValue('tok123')
      render(<InviteDialog {...defaultProps} />)
      fireEvent.click(screen.getByText('צור קישור'))

      await waitFor(() => screen.getByRole('button', { name: 'שתף קישור' }))
      fireEvent.click(screen.getByRole('button', { name: 'שתף קישור' }))

      await waitFor(() => expect(mockShare).toHaveBeenCalled())
      expect(consoleSpy).not.toHaveBeenCalled()
    })
  })
})
