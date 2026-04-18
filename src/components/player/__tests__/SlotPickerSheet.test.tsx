import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SlotPickerSheet from '../SlotPickerSheet'

const defaultProps = {
  open: true,
  choreTitle: 'כלי מטבח',
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
}

describe('SlotPickerSheet', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders chore title', () => {
    render(<SlotPickerSheet {...defaultProps} />)
    expect(screen.getByText('כלי מטבח')).toBeInTheDocument()
  })

  it('renders Hebrew day buttons', () => {
    render(<SlotPickerSheet {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'ראשון' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שבת' })).toBeInTheDocument()
  })

  it('renders slot options', () => {
    render(<SlotPickerSheet {...defaultProps} />)
    expect(screen.getByLabelText('בוקר-צהריים')).toBeInTheDocument()
    expect(screen.getByLabelText('צהריים-אחה"צ')).toBeInTheDocument()
    expect(screen.getByLabelText('אחה"צ-ערב')).toBeInTheDocument()
    expect(screen.getByLabelText('ללא שיוך')).toBeInTheDocument()
  })

  it('renders confirm and cancel buttons', () => {
    render(<SlotPickerSheet {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'שייך אליי' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ביטול' })).toBeInTheDocument()
  })

  it('calls onConfirm with selected day and slot', async () => {
    const onConfirm = vi.fn()
    render(<SlotPickerSheet {...defaultProps} onConfirm={onConfirm} />)

    // Select Wednesday (index 3)
    await userEvent.click(screen.getByRole('button', { name: 'רביעי' }))
    // Select morning slot
    await userEvent.click(screen.getByLabelText('בוקר-צהריים'))
    // Confirm
    await userEvent.click(screen.getByRole('button', { name: 'שייך אליי' }))

    expect(onConfirm).toHaveBeenCalledWith({ calendarDay: 3, calendarSlot: 'morning' })
  })

  it('calls onConfirm with null slot when "ללא שיוך" selected', async () => {
    const onConfirm = vi.fn()
    render(<SlotPickerSheet {...defaultProps} onConfirm={onConfirm} />)
    await userEvent.click(screen.getByLabelText('ללא שיוך'))
    await userEvent.click(screen.getByRole('button', { name: 'שייך אליי' }))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ calendarSlot: null }))
  })

  it('calls onCancel when cancel is clicked', async () => {
    const onCancel = vi.fn()
    render(<SlotPickerSheet {...defaultProps} onCancel={onCancel} />)
    await userEvent.click(screen.getByRole('button', { name: 'ביטול' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('renders nothing when open is false', () => {
    render(<SlotPickerSheet {...defaultProps} open={false} />)
    expect(screen.queryByText('כלי מטבח')).not.toBeInTheDocument()
  })
})
